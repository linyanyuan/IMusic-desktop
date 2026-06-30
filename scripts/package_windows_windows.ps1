$script = Join-Path $PSScriptRoot 'package_windows.ps1'
& $script @args
$success = $?
if (-not $success) {
  exit 1
}

if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
