param(
  [string]$Server = 'root@60.205.218.90',

  [string]$ServerReleaseDir = '/opt/imusic-desktop/releases',

  [string]$LocalReleaseDir = (Join-Path $PSScriptRoot '..\dist\releases'),

  [string]$PublicManifestUrl = 'http://60.205.218.90:8787/releases/desktop-update.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  Write-Host "> $Command $($Arguments -join ' ')"
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command"
  }
}

if ($Server -notmatch '^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$') {
  throw "Invalid Server value: $Server"
}

if ($ServerReleaseDir -notmatch '^/[A-Za-z0-9._/-]+$') {
  throw "Invalid ServerReleaseDir value: $ServerReleaseDir"
}

$releaseDir = [System.IO.Path]::GetFullPath($LocalReleaseDir)
if (-not (Test-Path -LiteralPath $releaseDir -PathType Container)) {
  throw "Local release directory not found: $releaseDir"
}

$manifestPath = Join-Path $releaseDir 'desktop-update.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "desktop-update.json not found. Run scripts\package_windows.ps1 first."
}

Invoke-Checked -Command 'ssh' -Arguments @($Server, "mkdir -p '$ServerReleaseDir'")
$releaseFiles = @(Get-ChildItem -LiteralPath $releaseDir -File)
if ($releaseFiles.Count -eq 0) {
  throw "No files found in local release directory: $releaseDir"
}
Invoke-Checked -Command 'scp' -Arguments @($releaseFiles.FullName) + @("${Server}:$ServerReleaseDir/")

Write-Host "> Verify $PublicManifestUrl"
$response = Invoke-WebRequest -Uri $PublicManifestUrl -UseBasicParsing -TimeoutSec 20
Write-Host "Manifest reachable: HTTP $($response.StatusCode)"
Write-Host $response.Content
