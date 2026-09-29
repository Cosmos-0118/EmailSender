param([string]$Action = 'start')
$ErrorActionPreference = 'Stop'
if ($Action -ne 'start') { throw 'Usage: emailsender start' }

$checkout = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataDir = if ($env:EMAILSENDER_DATA_DIR) { $env:EMAILSENDER_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'EmailSender\data' }
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$env:EMAILSENDER_DATA_DIR = $dataDir
if (-not (Test-Path (Join-Path $checkout '.git'))) { throw "Managed checkout is missing Git metadata: $checkout" }

Push-Location $checkout
try {
  git fetch --prune origin
  git remote set-head origin -a 2>$null | Out-Null
  $branchRef = git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>$null
  $branch = if ($LASTEXITCODE -eq 0 -and $branchRef) { $branchRef -replace '^origin/', '' } else { '' }
  if (-not $branch) {
    foreach ($candidate in @('main', 'master')) {
      git show-ref --verify --quiet "refs/remotes/origin/$candidate"
      if ($LASTEXITCODE -eq 0) { $branch = $candidate; break }
    }
  }
  if (-not $branch) { throw "Could not determine the repository's default branch." }

  # This checkout contains managed app code only; user records live under dataDir.
  git reset --hard HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Could not reset local changes.' }
  git clean -fd
  if ($LASTEXITCODE -ne 0) { throw 'Could not clean local changes.' }
  git checkout -B $branch "origin/$branch"
  if ($LASTEXITCODE -ne 0) { throw 'Could not switch to the latest default branch.' }
  git reset --hard "origin/$branch"
  if ($LASTEXITCODE -ne 0) { throw 'Could not reset the managed checkout.' }
  git clean -fd
  if ($LASTEXITCODE -ne 0) { throw 'Could not clean the managed checkout.' }

  if (Test-Path 'package-lock.json') { npm ci } else { npm install }
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

  $launchFile = Join-Path $dataDir 'launch.json'
  if (Test-Path $launchFile) { Remove-Item -Force $launchFile }
  $server = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server/index.js' -WorkingDirectory $checkout -NoNewWindow -PassThru
  $url = $null
  for ($i = 0; $i -lt 40; $i++) {
    if (Test-Path $launchFile) {
      try { $url = (Get-Content -Raw $launchFile | ConvertFrom-Json).url; break } catch { }
    }
    if ($server.HasExited) { throw 'EmailSender server exited before becoming ready.' }
    Start-Sleep -Milliseconds 250
  }
  if (-not $url) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue; throw 'The local service did not become ready.' }
  Start-Process $url
  Wait-Process -Id $server.Id
  if ($server.ExitCode -ne 0) { throw 'EmailSender server exited with an error.' }
} finally {
  Pop-Location
}
