param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$')]
  [string]$Version,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$BuildNumber,

  [string]$InstallerPath,

  [string]$DownloadBaseUrl = 'http://60.205.218.90:8787/releases',

  [string]$ServerReleaseDir = '/opt/imusic-desktop/releases',

  [string]$Changelog = '',

  [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-UnderPath([string]$Path, [string]$ParentPath) {
  $full = Get-FullPath $Path
  $parent = (Get-FullPath $ParentPath).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  if (-not $full.StartsWith($parent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside '$parent': $full"
  }
}

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  Write-Host "> $Command $($Arguments -join ' ')"
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command"
  }
}

function Set-PubspecVersion([string]$PubspecPath, [string]$VersionText) {
  $content = Get-Content -LiteralPath $PubspecPath -Raw
  $versionPattern = '(?m)^version:\s*.+$'
  if (-not [regex]::IsMatch($content, $versionPattern)) {
    throw "Could not find a top-level version line in $PubspecPath"
  }
  $updated = [regex]::Replace($content, $versionPattern, "version: $VersionText", 1)
  [System.IO.File]::WriteAllText(
    $PubspecPath,
    $updated,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Copy-CleanDirectory([string]$Source, [string]$Destination, [string]$AllowedParent) {
  Assert-UnderPath -Path $Destination -ParentPath $AllowedParent
  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force
}

function Get-InstallerExtension([string]$Path) {
  $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  if ($ext -ne '.exe' -and $ext -ne '.msi') {
    throw "InstallerPath must point to a .exe or .msi file: $Path"
  }
  return $ext
}

$repoRoot = Get-FullPath (Join-Path $PSScriptRoot '..')
$pubspecPath = Join-Path $repoRoot 'pubspec.yaml'
$distRoot = Join-Path $repoRoot 'dist'
$localReleasesDir = Join-Path $distRoot 'releases'
$releaseBuildDir = Join-Path $repoRoot 'build\windows\x64\runner\Release'
$versionText = "$Version+$BuildNumber"
$packageName = "imusic-$versionText-windows-x64"
$packageDir = Join-Path $distRoot $packageName
$zipPath = Join-Path $distRoot "$packageName.zip"

Write-Host "Packaging IMusic Windows release $versionText"
Set-PubspecVersion -PubspecPath $pubspecPath -VersionText $versionText

Push-Location $repoRoot
try {
  $runningRelease = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq (Join-Path $releaseBuildDir 'imusic.exe') }
  if ($runningRelease) {
    $ids = ($runningRelease | ForEach-Object { $_.Id }) -join ', '
    throw "Close the running release app before packaging. PID(s): $ids"
  }

  Invoke-Checked -Command 'flutter' -Arguments @('pub', 'get')

  if (-not $SkipBuild) {
    Invoke-Checked -Command 'flutter' -Arguments @(
      'build',
      'windows',
      '--release',
      '--build-name',
      $Version,
      '--build-number',
      $BuildNumber.ToString()
    )
  }

  if (-not (Test-Path -LiteralPath $releaseBuildDir)) {
    throw "Windows release output not found: $releaseBuildDir"
  }

  New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
  Copy-CleanDirectory -Source $releaseBuildDir -Destination $packageDir -AllowedParent $distRoot

  if (Test-Path -LiteralPath $zipPath) {
    Assert-UnderPath -Path $zipPath -ParentPath $distRoot
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -Path (Join-Path $packageDir '*') -DestinationPath $zipPath -Force

  $output = [ordered]@{
    version = $Version
    buildNumber = $BuildNumber
    buildVersion = $versionText
    packageDir = $packageDir
    zip = $zipPath
  }

  if ($InstallerPath) {
    $resolvedInstaller = Get-FullPath $InstallerPath
    if (-not (Test-Path -LiteralPath $resolvedInstaller)) {
      throw "InstallerPath not found: $resolvedInstaller"
    }
    Get-InstallerExtension $resolvedInstaller | Out-Null

    New-Item -ItemType Directory -Force -Path $localReleasesDir | Out-Null
    $installerName = [System.IO.Path]::GetFileName($resolvedInstaller)
    $publishedInstaller = Join-Path $localReleasesDir $installerName
    Copy-Item -LiteralPath $resolvedInstaller -Destination $publishedInstaller -Force

    $sha256 = (Get-FileHash -LiteralPath $publishedInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    $downloadUrl = $DownloadBaseUrl.TrimEnd('/') + '/' + [uri]::EscapeDataString($installerName)
    $manifest = [ordered]@{
      version = $Version
      downloadUrl = $downloadUrl
      sha256 = $sha256
      changelog = $Changelog
    }

    $manifestPath = Join-Path $localReleasesDir "update-manifest-$Version.json"
    $latestManifestPath = Join-Path $localReleasesDir 'desktop-update.json'
    $manifestJson = $manifest | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText(
      $manifestPath,
      $manifestJson + [Environment]::NewLine,
      [System.Text.UTF8Encoding]::new($false)
    )
    [System.IO.File]::WriteAllText(
      $latestManifestPath,
      $manifestJson + [Environment]::NewLine,
      [System.Text.UTF8Encoding]::new($false)
    )

    $output.installer = $publishedInstaller
    $output.manifest = $manifestPath
    $output.latestManifest = $latestManifestPath
    $output.sha256 = $sha256
    $output.downloadUrl = $downloadUrl
  }

  if (Test-Path -LiteralPath $localReleasesDir) {
    $uploadGuidePath = Join-Path $localReleasesDir 'UPLOAD_TO_SERVER.txt'
    $uploadGuide = @(
      'Upload every file in this folder to the server release directory:',
      '',
      "  $ServerReleaseDir",
      '',
      'The desktop app reads the update manifest from:',
      '',
      "  $($DownloadBaseUrl.TrimEnd('/'))/desktop-update.json",
      '',
      'Example Linux server setup:',
      '',
      "  sudo mkdir -p $ServerReleaseDir",
      "  sudo chown -R `$USER:`$USER $ServerReleaseDir",
      '',
      'Example upload command from your local machine:',
      '',
      "  scp .\dist\releases\* root@60.205.218.90:$ServerReleaseDir/",
      '',
      'Nginx or the backend server must expose that directory as /releases.'
    ) -join [Environment]::NewLine
    [System.IO.File]::WriteAllText(
      $uploadGuidePath,
      $uploadGuide + [Environment]::NewLine,
      [System.Text.UTF8Encoding]::new($false)
    )
    $output.serverReleaseDir = $ServerReleaseDir
    $output.uploadGuide = $uploadGuidePath
  }

  Write-Host ''
  Write-Host 'Package complete:'
  $output.GetEnumerator() | ForEach-Object {
    Write-Host ("  {0}: {1}" -f $_.Key, $_.Value)
  }
}
finally {
  Pop-Location
}
