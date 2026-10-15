// 发布产物命名的回归锁定。
//
// 背景：electron-builder 的 zip target 在 Windows 上的默认名是
//   <productName>-<version>-win.zip
// （带平台名而不是 arch）。workflow 曾按 `IMusic-<v>-x64.zip` 硬编码去查，
// CI 报 `sha256sum: IMusic-<v>-x64.zip: No such file or directory` 而发布失败
// （见 .github/workflows/release-windows.yml 的「生成更新清单与校验和」步骤）。
//
// 修法有两半，这里锁定 package.json 那一半：
//   1. package.json 显式配 win.artifactName，把 zip 名固定成 -<arch>
//   2. workflow 用 glob 定位实际产物（无法在单元测试里覆盖）

import assert from 'node:assert/strict'
import test from 'node:test'
import pkg from '../package.json'

const build = pkg.build

test('win.target 同时产出 nsis（应用内更新用）与 zip（绿色包）', () => {
  assert.deepEqual(build.win.target, ['nsis', 'zip'])
})

test('win.artifactName 固定含 productName/version/arch，zip 不会退化成 -win.zip', () => {
  const name = build.win.artifactName
  assert.equal(typeof name, 'string', 'zip 走 win.artifactName，必须显式配置')
  assert.match(name, /\$\{productName\}/)
  assert.match(name, /\$\{version\}/)
  assert.match(name, /\$\{arch\}/, '缺 ${arch} 就会回落到带平台名的默认名')
  assert.match(name, /\$\{ext\}$/)
})

test('nsis.artifactName 带 -Setup- 前缀且含 arch（更新端 installerFileName 依赖命名）', () => {
  const name = build.nsis.artifactName
  assert.match(name, /-Setup-/, '更新端按 IMusic-Setup-* 推算安装包名')
  assert.match(name, /\$\{arch\}/)
})
