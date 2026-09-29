param([string]$RepositoryUrl = $env:EMAILSENDER_REPO_URL)
$ErrorActionPreference = 'Stop'
$placeholder = 'https://github.com/OWNER/REPOSITORY.git'
if ([string]::IsNullOrWhiteSpace($RepositoryUrl) -or $RepositoryUrl -eq $placeholder) {
  $RepositoryUrl = Read-Host 'Public EmailSender Git URL'
}
if ([string]::IsNullOrWhiteSpace($RepositoryUrl) -or $RepositoryUrl -eq $placeholder) {
  throw 'Pass -RepositoryUrl or set EMAILSENDER_REPO_URL to the public repository URL.'
}

function Install-Tool([string]$Name, [string]$PackageId) {
  if (Get-Command $Name -ErrorAction SilentlyContinue) { return }
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id $PackageId --exact --accept-package-agreements --accept-source-agreements
  } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
    choco install $Name -y
  } else {
    throw "$Name is required. Install Git and Node.js LTS, then rerun this installer."
  }
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was installed. Open a new PowerShell window and rerun this installer."
  }
}

Install-Tool 'git' 'Git.Git'
Install-Tool 'node' 'OpenJS.NodeJS.LTS'

$appRoot = Join-Path $env:LOCALAPPDATA 'EmailSender'
$checkout = Join-Path $appRoot 'app'
$binDir = Join-Path $appRoot 'bin'
New-Item -ItemType Directory -Force -Path $appRoot, $binDir | Out-Null
if (Test-Path (Join-Path $checkout '.git')) {
  git -C $checkout remote set-url origin $RepositoryUrl
} else {
  if (Test-Path $checkout) { throw "Refusing to replace an existing non-Git directory: $checkout" }
  git clone $RepositoryUrl $checkout
}

$wrapper = Join-Path $binDir 'emailsender.cmd'
@"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$checkout\scripts\start.ps1" %*
"@ | Set-Content -Encoding ASCII $wrapper

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $binDir) {
  [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $binDir).Trim(';')), 'User')
  $env:Path += ";$binDir"
}
Write-Host 'Installed EmailSender. Starting the local website now.'
& $wrapper start
