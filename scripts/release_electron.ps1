<#
.SYNOPSIS
    IMusic Desktop（Electron）一键发布：改版本号 → 自检 → 提交推送 → 打 tag 触发 GitHub Actions。

.DESCRIPTION
    对应 README「B. 发布 Electron 重构版」的 B1-B4。做完之后 GitHub Actions 会自动
    打包并发布到 GitHub Releases，不需要手动上传文件或算 sha256。

    本脚本只负责「推 tag」这一步之前的全部本地操作；发布本身由
    .github/workflows/release-windows.yml 完成。

    流程：
      1. 校验版本号格式，并与 electron-app/package.json 的当前版本比较
      2. 写入新版本号
      3. 本地自检（npm run release:check：类型检查 + 单元测试）
      4. 提交（chore(electron): bump <version>）并推送
      5. 打 tag v<version> 并推送 —— 这一步触发 workflow

.PARAMETER Version
    新版本号，形如 2.3.3 或 2.3.3+7（build 号可选）。
    必须大于当前版本，否则拒绝执行。

.PARAMETER Changelog
    本次更新说明（会写进 commit message、tag 说明，并作为 GitHub Release 的正文）。
    可以用 \n 表示换行，例如：
      -Changelog "新功能\n- 支持 xx\n\n修复\n- 修了 yy"
    内容较长时建议改用 -ChangelogFile 指向一个 Markdown 文件。

.PARAMETER ChangelogFile
    从文件读取更新说明（UTF-8），适合写多行、带小标题的 Markdown。
    与 -Changelog 二选一；同时给时以本参数为准。

.PARAMETER SkipTests
    跳过本地自检。仅在「只改版本号、代码无变化」时使用。

.PARAMETER NoPush
    只做到打本地 tag，不推送。用于先在本地确认改动。

.PARAMETER Force
    允许版本号不大于当前版本（例如重新发布同一版本）。
    会先删除本地与远端已有的同名 tag，请谨慎使用。

.EXAMPLE
    .\scripts\release_electron.ps1 -Version 2.3.3 -Changelog "修复 B 站分P歌收藏态判断"
    最常用：一条命令完成改版本、自检、提交、推送、打 tag。

.EXAMPLE
    .\scripts\release_electron.ps1 -Version 2.4.0 -ChangelogFile .\notes.md
    更新说明写在文件里（支持多行 Markdown），适合正式版本。

.EXAMPLE
    .\scripts\release_electron.ps1 -Version 2.4.0 -WhatIf
    预演：只打印每一步会做什么，不修改任何文件、不推送。

.NOTES
    需要：git、Node 20+、electron-app/node_modules 已安装（npm ci）。
    未安装依赖时脚本会提示并中止。
#>

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern('^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$')]
  [string]$Version,

  [string]$Changelog = '',

  [string]$ChangelogFile = '',

  [switch]$SkipTests,

  [switch]$NoPush,

  [switch]$Force,

  [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$appDir = Join-Path $repoRoot 'electron-app'
$packagePath = Join-Path $appDir 'package.json'
$tag = "v$Version"

# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

function Write-Step([string]$Text) {
  Write-Host ''
  Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
  Write-Host "    $Text" -ForegroundColor Green
}

function Write-Warn([string]$Text) {
  Write-Host "    $Text" -ForegroundColor Yellow
}

function Invoke-Step([string]$Command, [string[]]$Arguments) {
  Write-Host "    > $Command $($Arguments -join ' ')"
  if ($WhatIf) {
    return
  }
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "命令失败（exit $LASTEXITCODE）：$Command $($Arguments -join ' ')"
  }
}

function Test-Clean {
  # 只拦「已暂存/已修改的已跟踪文件」；未跟踪的新文件不拦（发布脚本只动 package.json）
  $staged = @(git diff --cached --name-only)
  $unstaged = @(git diff --name-only)
  $dirty = @($staged + $unstaged | Select-Object -Unique)
  if ($dirty.Count -gt 0) {
    # 不用 here-string：Windows PowerShell 5.1 的解析器处理
    # @"..." 内的 $( ... { "..." } ) 嵌套双引号有缺陷（pwsh 7 已修），
    # 这里改用普通字符串拼接，保证 5.1 与 7.x 都能解析。
    $lines = @($dirty | ForEach-Object { '    ' + $_ })
    $message = '工作区有未提交的改动，请先提交或 stash：' + "`n" + ($lines -join "`n")
    throw $message
  }
}

function Get-CurrentVersion {
  $json = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
  return $json.version
}

# 版本比较：支持 2.3.3 / 2.3.3+7 / 2.4.0-beta.1
# 规则与 electron/update.ts 的 parseVersion 一致（pub_semver 语义，build 号参与比较）
function Compare-Version([string]$A, [string]$B) {
  $pattern = '^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$'

  $ma = [regex]::Match($A, $pattern)
  $mb = [regex]::Match($B, $pattern)
  if (-not $ma.Success) { throw "无法解析版本号：$A" }
  if (-not $mb.Success) { throw "无法解析版本号：$B" }

  function Parse-Part([string]$Text) {
    if ([string]::IsNullOrEmpty($Text)) { return @() }
    return @($Text.Split('.') | Where-Object { $_.Length -gt 0 } | ForEach-Object {
      if ($_ -match '^\d+$') { [int]$_ } else { $_ }
    })
  }

  # 逐段比较，null 视为小于任何存在的值
  function Compare-Part($X, $Y) {
    $len = [Math]::Max($X.Count, $Y.Count)
    for ($i = 0; $i -lt $len; $i++) {
      $x = if ($i -lt $X.Count) { $X[$i] } else { $null }
      $y = if ($i -lt $Y.Count) { $Y[$i] } else { $null }
      if ($null -eq $x -and $null -eq $y) { continue }
      if ($null -eq $x) { return -1 }
      if ($null -eq $y) { return 1 }
      # 数字段小于字符串段
      $xNum = $x -is [int]
      $yNum = $y -is [int]
      if ($xNum -and $yNum) {
        if ($x -ne $y) { return $(if ($x -lt $y) { -1 } else { 1 }) }
      } elseif ($xNum) {
        return -1
      } elseif ($yNum) {
        return 1
      } elseif ($x -ne $y) {
        return $(if ([string]$x -lt [string]$y) { -1 } else { 1 })
      }
    }
    return 0
  }

  foreach ($field in @(1, 2, 3)) {
    $x = [int]$ma.Groups[$field].Value
    $y = [int]$mb.Groups[$field].Value
    if ($x -ne $y) { return $(if ($x -lt $y) { -1 } else { 1 }) }
  }

  # 预发布段：有预发布的版本低于同号正式版
  $aPre = Parse-Part $ma.Groups[4].Value
  $bPre = Parse-Part $mb.Groups[4].Value
  $aHasPre = $aPre.Count -gt 0
  $bHasPre = $bPre.Count -gt 0
  if ($aHasPre -ne $bHasPre) {
    return $(if ($aHasPre) { -1 } else { 1 })
  }
  $cmp = Compare-Part $aPre $bPre
  if ($cmp -ne 0) { return $cmp }

  # build 段：有 build 号的大于没有的
  $aBuild = Parse-Part $ma.Groups[5].Value
  $bBuild = Parse-Part $mb.Groups[5].Value
  $aHasBuild = $aBuild.Count -gt 0
  $bHasBuild = $bBuild.Count -gt 0
  if ($aHasBuild -ne $bHasBuild) {
    return $(if ($aHasBuild) { 1 } else { -1 })
  }
  return (Compare-Part $aBuild $bBuild)
}

# ---------------------------------------------------------------------------
# 前置检查
# ---------------------------------------------------------------------------

Write-Step '前置检查'

if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
  throw "找不到 $packagePath，请在仓库根目录运行本脚本。"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw '找不到 git，请先安装 Git for Windows。'
}

if (-not (Test-Path -LiteralPath (Join-Path $appDir 'node_modules') -PathType Container)) {
  throw "electron-app/node_modules 不存在。先执行：`n  cd electron-app`n  npm ci`n"
}

if (-not $SkipTests -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '找不到 node，请先安装 Node 20+。'
}

Test-Clean
Write-Ok '工作区干净'

$current = Get-CurrentVersion
Write-Ok "当前版本：$current"
Write-Ok "目标版本：$Version"

$cmp = Compare-Version $current $Version
if ($cmp -ge 0 -and -not $Force) {
  throw "目标版本 $Version 不大于当前版本 $current，已中止。`n如需重新发布同一版本，加 -Force（会覆盖远端同名 tag）。"
}
if ($cmp -eq 0 -and $Force) {
  Write-Warn "版本号未变（$Version），因 -Force 继续执行"
}

# 远端 tag 冲突
$existing = @(git ls-remote --tags origin $tag 2>$null | ForEach-Object { ($_ -split "`t")[1] })
if ($existing.Count -gt 0) {
  if (-not $Force) {
    throw "远端已存在 tag $tag。如要重发该版本，加 -Force（将删除并重建远端 tag）。"
  }
  Write-Warn "远端已存在 tag $tag，-Force 将删除重建"
}

# 分支检查：tag 会从当前 HEAD 打出，必须与远端同步
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -eq 'HEAD') {
  throw '当前处于 detached HEAD，请先切回分支（例如 git checkout feat/electron-ui-rewrite）。'
}
$counts = (git rev-list --left-right --count "origin/$branch...HEAD").Trim() -split '\s+'
$behind = [int]$counts[0]
$ahead = [int]$counts[1]
if ($behind -gt 0) {
  throw "本地分支落后远端 $behind 个提交，请先 git pull。"
}
Write-Ok "分支 $branch（领先远端 $ahead 个提交）"

# ---------------------------------------------------------------------------
# 0. 解析更新说明（将成为 GitHub Release 的正文）
# ---------------------------------------------------------------------------

Write-Step '解析更新说明'

$notes = ''
if ($ChangelogFile.Trim() -ne '') {
  $notesPath = $ChangelogFile
  if (-not [System.IO.Path]::IsPathRooted($notesPath)) {
    $notesPath = Join-Path $repoRoot $notesPath
  }
  if (-not (Test-Path -LiteralPath $notesPath -PathType Leaf)) {
    throw "找不到 -ChangelogFile 指定的文件：$notesPath"
  }
  $notes = [System.IO.File]::ReadAllText($notesPath, [System.Text.UTF8Encoding]::new($false))
} elseif ($Changelog.Trim() -ne '') {
  $notes = $Changelog
}

# 允许在 -Changelog 里用 \n 写换行：PowerShell 自己的转义符是反引号，
# 在命令行和 CI 里都容易输错，支持 \n 更顺手。
$notes = $notes -replace '\\n', "`n"
$notes = $notes.Replace("`r`n", "`n").Trim()

if ($notes -eq '') {
  Write-Warn '未提供更新说明：Release 只会有自动生成的变更对比链接。'
  Write-Warn '  建议用 -Changelog "..." 或 -ChangelogFile <md 文件> 写清楚新功能/改进/修复。'
} else {
  Write-Ok "更新说明 $((($notes -split "`n").Count)) 行："
  foreach ($line in ($notes -split "`n")) {
    Write-Host "      $line" -ForegroundColor DarkGray
  }
}

# ---------------------------------------------------------------------------
# 1. 写入新版本号
# ---------------------------------------------------------------------------

Write-Step "写入版本号 $current -> $Version"

$json = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8
# 只替换第一个 "version": "..."，避免误伤 dependencies 里的版本号
$updated = [regex]::Replace($json, '("version"\s*:\s*")[^"]*(")', "`${1}$Version`${2}", 1)
if ($updated -eq $json) {
  throw "未能在 package.json 中定位 version 字段"
}

if (-not $WhatIf) {
  [System.IO.File]::WriteAllText($packagePath, $updated, [System.Text.UTF8Encoding]::new($false))
  $check = Get-CurrentVersion
  if ($check -ne $Version) {
    throw "版本号写入校验失败：期望 $Version，实际 $check"
  }
}
Write-Ok "electron-app/package.json version = $Version"

# ---------------------------------------------------------------------------
# 2. 本地自检
# ---------------------------------------------------------------------------

if ($SkipTests) {
  Write-Warn '已跳过本地自检（-SkipTests）'
} else {
  Write-Step '本地自检（类型检查 + 单元测试）'
  Push-Location $appDir
  try {
    Invoke-Step 'npm' @('run', 'release:check')
  } finally {
    Pop-Location
  }
  Write-Ok '自检通过'
}

# ---------------------------------------------------------------------------
# 3. 提交并推送
# ---------------------------------------------------------------------------

Write-Step '提交版本号变更'

$message = "chore(electron): bump $Version"
if ($notes -ne '') {
  $message += "`n`n$notes"
}

Invoke-Step 'git' @('add', 'electron-app/package.json')
if (-not $WhatIf) {
  # 自检可能顺带改了 lock 文件，一并提交，避免工作区留下未提交改动
  $extra = @(git diff --name-only -- electron-app/package-lock.json)
  if ($extra.Count -gt 0) {
    Write-Warn 'package-lock.json 有改动，一并提交'
    Invoke-Step 'git' @('add', 'electron-app/package-lock.json')
  }
}
Invoke-Step 'git' @('commit', '-m', $message)

if ($NoPush) {
  Write-Warn '已跳过推送（-NoPush），后续请手动执行：git push && git push origin ' + $tag
} else {
  Invoke-Step 'git' @('push')
}

# ---------------------------------------------------------------------------
# 4. 打 tag 并推送（触发 GitHub Actions）
# ---------------------------------------------------------------------------

Write-Step "打 tag $tag"

if ($Force) {
  # 删除本地与远端同名 tag，避免 push 被拒
  Invoke-Step 'git' @('tag', '-d', $tag)
  if (-not $NoPush) {
    Invoke-Step 'git' @('push', 'origin', ":refs/tags/$tag")
  }
}

# tag 说明就是 Release 正文的来源：workflow 用
#   git tag -l --format='%(contents)' vX.Y.Z
# 把它取出来交给 softprops/action-gh-release。
# 用 -F 从文件读而不是 -m：多行中文说明经 PowerShell 5.1 传给原生程序时
# 换行容易被弄丢，写文件最稳。
$tagMessage = if ($notes -ne '') { $notes } else { "IMusic Desktop $tag" }
$msgFile = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText($msgFile, $tagMessage, [System.Text.UTF8Encoding]::new($false))
  Invoke-Step 'git' @('tag', '-a', $tag, '-F', $msgFile)
} finally {
  Remove-Item -LiteralPath $msgFile -Force -ErrorAction SilentlyContinue
}

if ($NoPush) {
  Write-Warn "本地 tag $tag 已创建但未推送"
} else {
  Invoke-Step 'git' @('push', 'origin', $tag)
}

# ---------------------------------------------------------------------------
# 完成
# ---------------------------------------------------------------------------

Write-Step '完成'

if ($WhatIf) {
  Write-Host '（预演模式，未做任何实际修改）' -ForegroundColor Yellow
  exit 0
}

$repo = ((git remote get-url origin) -replace '\.git$', '') -replace '^git@github.com:', 'https://github.com/' -replace '^https://github.com/', ''

Write-Host ''
Write-Host "  版本：$Version   tag：$tag" -ForegroundColor White
Write-Host ''
Write-Host '  接下来 GitHub Actions 会自动打包并发布，查看进度：' -ForegroundColor Gray
Write-Host "    https://github.com/$repo/actions" -ForegroundColor White
Write-Host ''
Write-Host '  发布完成后验证：' -ForegroundColor Gray
Write-Host "    curl -s https://github.com/$repo/releases/latest/download/desktop-update.json" -ForegroundColor White
Write-Host "    https://github.com/$repo/releases/tag/$tag" -ForegroundColor White
Write-Host ''
if ($notes -ne '') {
  Write-Host '  Release 正文与 tag 说明已设为上面的更新说明。' -ForegroundColor Gray
} else {
  Write-Warn '本次未填更新说明，Release 只会有自动生成的变更对比链接。'
}
Write-Host ''
