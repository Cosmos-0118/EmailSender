param([string]$RepositoryUrl = $env:EMAILSENDER_REPO_URL)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RepositoryUrl)) {
  $RepositoryUrl = 'https://github.com/Cosmos-0118/EmailSender.git'
}

function Start-SetupStep([int]$Number, [string]$Message) {
  Write-Host "`n[$Number/4] $Message" -NoNewline -ForegroundColor Cyan
  if ([Environment]::UserInteractive) {
    1..3 | ForEach-Object { Start-Sleep -Milliseconds 120; Write-Host '.' -NoNewline -ForegroundColor Cyan }
  }
  Write-Host ''
}

Write-Host "`n  E M A I L S E N D E R`n  Local setup for Windows" -ForegroundColor Cyan

function Test-Tool([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { return $false }
  try {
    & $Name --version *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Install-Tool([string]$Name, [string]$PackageId) {
  if (Test-Tool $Name) { return }
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id $PackageId --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Could not install $Name with winget. Fix the error above and rerun setup." }
  } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
    choco install $Name -y
    if ($LASTEXITCODE -ne 0) { throw "Could not install $Name with Chocolatey. Fix the error above and rerun setup." }
  } else {
    throw "$Name is required. Install Git and Node.js LTS, then rerun this installer."
  }
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Test-Tool $Name)) {
    throw "$Name was installed. Open a new PowerShell window and rerun this installer."
  }
}

Start-SetupStep 1 'Checking tools'
Install-Tool 'git' 'Git.Git'
Install-Tool 'node' 'OpenJS.NodeJS.LTS'
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js is installed but npm is missing. Reinstall Node.js LTS and retry.' }

Start-SetupStep 2 'Downloading EmailSender'
$appRoot = Join-Path $env:LOCALAPPDATA 'EmailSender'
$checkout = Join-Path $appRoot 'app'
$binDir = Join-Path $appRoot 'bin'
New-Item -ItemType Directory -Force -Path $appRoot, $binDir | Out-Null
if (Test-Path (Join-Path $checkout '.git')) {
  $currentOrigin = git -C $checkout remote get-url origin
  if ($LASTEXITCODE -ne 0) { throw "Cannot read the existing checkout at $checkout" }
  if ($currentOrigin -ne $RepositoryUrl) { throw "The existing checkout at $checkout points to $currentOrigin. Move it aside before installing." }
} else {
  if (Test-Path $checkout) { throw "Refusing to replace an existing non-Git directory: $checkout" }
  $tempCheckout = Join-Path $appRoot ('app-download-' + [guid]::NewGuid().ToString('N'))
  try {
    git clone --depth 1 $RepositoryUrl $tempCheckout
    if ($LASTEXITCODE -ne 0) { throw 'Could not download EmailSender. Check your connection and rerun setup.' }
    Move-Item -Path $tempCheckout -Destination $checkout
  } finally {
    if (Test-Path $tempCheckout) { Remove-Item -Recurse -Force $tempCheckout }
  }
}

Start-SetupStep 3 'Adding the launcher'
$wrapper = Join-Path $binDir 'emailsender.cmd'
@'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\EmailSender\app\scripts\start.ps1" %*
'@ | Set-Content -Encoding ASCII $wrapper

$userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $binDir) {
  [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $binDir).Trim(';')), 'User')
  $env:Path += ";$binDir"
}
Start-SetupStep 4 'Preparing and opening the app'
Write-Host 'EmailSender is installed. Keep this terminal open while using the app.'
& $wrapper start
if ($LASTEXITCODE -ne 0) { throw 'EmailSender did not start. Fix the error above and run emailsender start again.' }
