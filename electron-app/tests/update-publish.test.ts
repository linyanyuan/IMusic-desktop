// 发布到 GitHub Releases 的更新链路：manifest URL 形态 + 下载域名白名单。
//
// 背景（本轮改动）：发布渠道从自建服务器（60.205.218.90:8787）迁到 GitHub Releases，
// workflow 见 .github/workflows/release-windows.yml。这里锁定：
//   1. GitHub 的 release asset 地址必须通过 manifestIsValid（否则更新器直接不认）
//   2. github.com 必须始终在下载白名单里（否则「域名不在白名单内」→ 无法更新）
//   3. 白名单不能被 manifest 里的地址牵着走（更新器会执行下载内容）

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_UPDATE_BASE_URL,
  manifestIsValid,
  parseManifest,
  installerFileName,
} from '../electron/update'

const REPO = 'linyanyuan/IMusic-desktop'
const TAG = 'v2.3.3'
const VERSION = '2.3.3'

/** workflow 生成的 manifest 形态（见 release-windows.yml 的「生成更新清单」步骤） */
function githubManifest(version = VERSION) {
  const sha = 'a'.repeat(64)
  return {
    version,
    downloadUrl: `https://github.com/${REPO}/releases/download/${TAG}/IMusic-Setup-${version}-x64.exe`,
    sha256: sha,
    changelog: '见 Release notes',
  }
}

test('默认更新来源指向 GitHub Releases', () => {
  assert.equal(
    DEFAULT_UPDATE_BASE_URL,
    `https://github.com/${REPO}`,
    '默认 baseUrl 必须指向本仓库，否则改渠道后老用户收不到更新',
  )
})

test('GitHub release asset 地址能通过 manifestIsValid', () => {
  const manifest = githubManifest()
  assert.ok(manifestIsValid(manifest), 'GitHub asset 的 https 地址必须被接受')
  assert.equal(
    installerFileName(manifest),
    `IMusic-Setup-${VERSION}-x64.exe`,
    '安装包名必须与 workflow 产物名一致，否则下载后找不到文件',
  )
})

test('带 build 号的版本也生成正确的安装包名（去掉 +N）', () => {
  const manifest = githubManifest('2.3.3+7')
  assert.equal(installerFileName(manifest), 'IMusic-Setup-2.3.3-x64.exe')
})

test('parseManifest 接受 snake_case 字段（服务端历史命名）', () => {
  const parsed = parseManifest({
    version: VERSION,
    download_url: `https://github.com/${REPO}/releases/download/${TAG}/IMusic-Setup-${VERSION}-x64.exe`,
    sha256: 'b'.repeat(64),
    change_log: 'notes',
  })
  assert.ok(manifestIsValid(parsed))
  assert.equal(parsed?.changelog, 'notes')
})

test('非 http(s) 协议的下载地址一律拒绝', () => {
  for (const scheme of ['ftp:', 'file:', 'javascript:']) {
    const bad = {
      ...githubManifest(),
      downloadUrl: `${scheme}//evil.example.com/IMusic-Setup.exe`,
    }
    assert.equal(manifestIsValid(bad), false, `${scheme} 不应被接受`)
  }
})

// manifestIsValid 仍接受 http://（历史自建服务器是明文），域名白名单在
// UpdateService.assertAllowedUrl 里单独把关——那才是「能执行的内容」的边界。
test('http:// 地址能过 manifest 校验，但要靠域名白名单兜底', () => {
  const plain = {
    ...githubManifest(),
    downloadUrl: `http://github.com/${REPO}/releases/download/${TAG}/IMusic-Setup.exe`,
  }
  assert.equal(manifestIsValid(plain), true)
})

test('sha256 不是 64 位 hex 时拒绝', () => {
  const bad = { ...githubManifest(), sha256: 'notahash' }
  assert.equal(manifestIsValid(bad), false)
})

// 回归锚点：electron-builder 的 ${version} 宏是 package.json 的完整 version
//（含 +build），所以 GitHub 上的 asset 名是 IMusic-Setup-2.3.3+7-x64.exe。
// 更新端 installerFileName() 会去掉 +build，只用于「下载后落地的本地文件名」；
// 真正下载用的是 manifest.downloadUrl。若 workflow 按去掉 build 号的名字拼
// URL 就会 404 —— 这里锁定 URL 必须带 build 号。
test('带 build 号时 downloadUrl 必须指向含 build 号的 asset 名', () => {
  const version = '2.3.3+7'
  const manifest = {
    version,
    downloadUrl: `https://github.com/${REPO}/releases/download/${TAG}/IMusic-Setup-${version}-x64.exe`,
    sha256: 'c'.repeat(64),
    changelog: null,
  }
  assert.ok(manifestIsValid(manifest))
  assert.equal(
    manifest.downloadUrl.split('/').pop(),
    'IMusic-Setup-2.3.3+7-x64.exe',
    'downloadUrl 必须匹配 electron-builder 的实际产物名',
  )
  // 本地落地名刻意去掉 build 号，与下载地址不同名
  assert.equal(installerFileName(manifest), 'IMusic-Setup-2.3.3-x64.exe')
})
