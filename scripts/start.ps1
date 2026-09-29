param([string]$Action = 'start')
$ErrorActionPreference = 'Stop'
if ($Action -ne 'start') { throw 'Usage: emailsender start' }

$checkout = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataDir = if ($env:EMAILSENDER_DATA_DIR) { $env:EMAILSENDER_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'EmailSender\data' }
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$env:EMAILSENDER_DATA_DIR = $dataDir
if (-not (Test-Path (Join-Path $checkout '.git'))) { throw "Managed checkout is missing Git metadata: $checkout" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'EmailSender needs Node.js 22 or newer. Install Node.js and run emailsender start again.' }
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 22) { throw 'EmailSender needs Node.js 22 or newer. Update Node.js and run emailsender start again.' }

Push-Location $checkout
$server = $null
try {
  Write-Host "`n[1/3] Checking for updates..." -ForegroundColor Cyan
  git fetch --prune origin
  if ($LASTEXITCODE -ne 0) { throw 'Could not check for updates. Check your connection and retry.' }
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

  Write-Host "`n[2/3] Preparing the app..." -ForegroundColor Cyan
  if (Test-Path 'package-lock.json') { npm ci } else { npm install }
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

  $launchFile = Join-Path $dataDir 'launch.json'
  if (Test-Path $launchFile) { Remove-Item -Force $launchFile }
  $errorLog = Join-Path $dataDir 'startup-error.log'
  if (Test-Path $errorLog) { Remove-Item -Force $errorLog }
  Write-Host "`n[3/3] Starting EmailSender..." -ForegroundColor Cyan
  $server = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server/index.js' -WorkingDirectory $checkout -NoNewWindow -PassThru -RedirectStandardError $errorLog
  $url = $null
  for ($i = 0; $i -lt 240; $i++) {
    if ($server.HasExited) { break }
    if (Test-Path $launchFile) {
      try {
        $launch = Get-Content -Raw $launchFile | ConvertFrom-Json
        if ($launch.pid -eq $server.Id -and $launch.url -match '^http://127\.0\.0\.1:43871/#session=[0-9a-f]{64}$') {
          $url = $launch.url
          break
        }
      } catch { }
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $url) {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
    if (Test-Path $errorLog) {
      $details = (Get-Content -Path $errorLog -Tail 30 -ErrorAction SilentlyContinue) -join "`n"
      if ($details) { Write-Host $details -ForegroundColor Red }
    }
    throw "The local service did not become ready. See $errorLog for startup errors."
  }
  if (-not $env:EMAILSENDER_NO_OPEN) {
    try { Start-Process $url } catch { Write-Warning "Could not open the browser automatically. Open this private link: $url" }
  } else {
    Write-Host "Open this private link: $url"
  }
  Write-Host 'EmailSender is ready. Keep this terminal open while using it.'
  Wait-Process -Id $server.Id
  if ($server.ExitCode -ne 0) { throw 'EmailSender server exited with an error.' }
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
  Pop-Location
}
