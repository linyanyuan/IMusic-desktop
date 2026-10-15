/**
 * 绿色包（.zip）更新器脚本 —— 逐行移植自 Flutter 端
 * lib/services/update_service.dart 里的 `_zipUpdaterScript`。
 *
 * 为什么是内嵌字符串而不是单独的 .ps1 资源文件：打包后脚本位于 app.asar 内，
 * 用文件路径读取会多一层 asar 解包/路径判断；内嵌字符串没有打包差异，
 * 与 Dart 端（同样内嵌）保持一致，写入临时目录再执行。
 *
 * 与 Dart 版的唯一差异：目标可执行文件名由 `-ExeName` 参数传入
 * （Dart 版硬编码 'imusic.exe'，Electron 版实际是 'IMusic.exe'）。
 */
export const ZIP_UPDATER_SCRIPT = String.raw`
param(
  [Parameter(Mandatory = $true)]
  [string]$ZipPath,

  [Parameter(Mandatory = $true)]
  [string]$TargetDir,

  [Parameter(Mandatory = $true)]
  [string]$ExePath,

  [Parameter(Mandatory = $true)]
  [int]$CurrentPid,

  [Parameter(Mandatory = $true)]
  [string]$ExeName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$logPath = Join-Path ([System.IO.Path]::GetTempPath()) 'imusic-update.log'

function Write-Log([string]$Message) {
  $line = ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $Message)
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

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

function Wait-ForTargetProcesses([string]$Exe) {
  $deadline = (Get-Date).AddSeconds(60)
  do {
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
      try {
        $_.Path -eq $Exe
      } catch {
        $false
      }
    })
    if ($running.Count -eq 0) {
      return
    }
    Write-Log ("Waiting for target process(es): " + (($running | ForEach-Object { $_.Id }) -join ', '))
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for running app to exit: $Exe"
}

function Copy-WithRetry([string]$SourceRoot, [string]$Target) {
  $lastError = $null
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    try {
      Write-Log "Copy attempt $attempt"
      Copy-Item -Path (Join-Path $SourceRoot '*') -Destination $Target -Recurse -Force
      return
    } catch {
      $lastError = $_
      Write-Log "Copy attempt $attempt failed: $($_.Exception.Message)"
      Start-Sleep -Milliseconds 500
    }
  }
  throw $lastError
}

function Start-UpdatedApp([string]$Exe, [string]$WorkingDirectory) {
  Write-Log "Starting updated app"
  $process = Start-Process -FilePath $Exe -WorkingDirectory $WorkingDirectory -PassThru
  if ($null -eq $process) {
    throw "Start-Process did not return a process handle: $Exe"
  }

  Write-Log "Started updated app PID=$($process.Id)"
  Start-Sleep -Milliseconds 1500
  $process.Refresh()
  if ($process.HasExited) {
    throw "Updated app exited immediately. PID=$($process.Id) ExitCode=$($process.ExitCode)"
  }
  Write-Log "Updated app is running. PID=$($process.Id)"
}

function Remove-DownloadedZip([string]$Zip) {
  try {
    Assert-UnderPath -Path $Zip -ParentPath ([System.IO.Path]::GetTempPath())
  } catch {
    Write-Log "Skip downloaded ZIP cleanup outside temp: $Zip"
    return
  }

  if (-not $Zip.ToLowerInvariant().EndsWith('.zip')) {
    Write-Log "Skip downloaded ZIP cleanup for non-ZIP file: $Zip"
    return
  }

  if (Test-Path -LiteralPath $Zip -PathType Leaf) {
    try {
      Write-Log "Removing downloaded ZIP: $Zip"
      Remove-Item -LiteralPath $Zip -Force -ErrorAction Stop
    } catch {
      Write-Log "Failed to remove downloaded ZIP: $($_.Exception.Message)"
    }
  }
}

$zip = Get-FullPath $ZipPath
$target = Get-FullPath $TargetDir
$exe = Get-FullPath $ExePath
$staging = $null
Write-Log "Start ZIP update. Zip=$zip Target=$target Exe=$exe CurrentPid=$CurrentPid"

try {
  if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) {
    throw "Update ZIP not found: $zip"
  }
  if (-not $zip.ToLowerInvariant().EndsWith('.zip')) {
    throw "Update asset must be a ZIP file: $zip"
  }
  if (-not (Test-Path -LiteralPath $target -PathType Container)) {
    throw "Target directory not found: $target"
  }
  Assert-UnderPath -Path $exe -ParentPath $target

  Wait-Process -Id $CurrentPid -Timeout 60 -ErrorAction SilentlyContinue
  Wait-ForTargetProcesses -Exe $exe

  $staging = Join-Path ([System.IO.Path]::GetTempPath()) ("imusic-update-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  Write-Log "Expand archive to $staging"
  Expand-Archive -LiteralPath $zip -DestinationPath $staging -Force

  $payloadRoot = $staging
  if (-not (Test-Path -LiteralPath (Join-Path $payloadRoot $ExeName) -PathType Leaf)) {
    $children = @(Get-ChildItem -LiteralPath $staging -Directory)
    if ($children.Count -eq 1 -and (Test-Path -LiteralPath (Join-Path $children[0].FullName $ExeName) -PathType Leaf)) {
      $payloadRoot = $children[0].FullName
    } else {
      throw "Update ZIP does not contain $ExeName at the package root"
    }
  }

  Write-Log "Payload root: $payloadRoot"
  Copy-WithRetry -SourceRoot $payloadRoot -Target $target
  Start-UpdatedApp -Exe $exe -WorkingDirectory $target
  Remove-DownloadedZip -Zip $zip
  Write-Log "Update complete"
} catch {
  Write-Log "Update failed: $($_.Exception.Message)"
  throw
}
finally {
  if ($staging -and (Test-Path -LiteralPath $staging)) {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}
`
