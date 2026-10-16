// 用户头像被 CSP 拦掉的回归锚点。
//
// 背景（2026-10 真实回归）：后端 /me 返回的 avatarUrl 是相对路径，按 baseUrl 解析成
// 绝对地址后是纯 HTTP —— http://60.205.218.90:8787/uploads/avatars/xxx.jpg。
// index.html 的 CSP 里 connect-src 放行了这个源，img-src 却只有 `'self' data: https:`，
// 于是 <img> 直接被浏览器拦下 → onError → UserAvatar 静默回退成字母头像，
// 表现为「登录成功了但头像一直是字母」。
//
// 锁定方式：直接读仓库里的 index.html，解析出 img-src 指令本身（而不是全文 grep，
// 否则源写在 connect-src / media-src 里也会假通过），要求它包含后端 HTTP 源。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { AUTH_BASE_URL } from '../src/services/auth'

const BACKEND_ORIGIN = 'http://60.205.218.90:8787'

// 测试先被 esbuild 打成 tests/dist/*.cjs，import.meta.url 不可用，按包根（npm test 的 cwd）定位
const html = readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8')

/** 取出 index.html 里 CSP meta 的 content（找不到就抛错，避免断言在一个空串上假通过）
 *  注意：CSP 值里含单引号（'self'），所以 content 只能用双引号属性匹配——
 *  写成 [^"']* 会在第一个 'self' 处截断，导致 img-src 整个指令都解析不出来。 */
function cspContent(): string {
  const meta = html.match(
    /http-equiv=["']Content-Security-Policy["'][^>]*content="([^"]*)"/i,
  )
  assert.ok(meta?.[1], 'index.html 必须保留 Content-Security-Policy meta')
  return meta[1]
}

/** 解析出某个指令的源列表，例如 imgSrcDirective() -> ["'self'", 'data:', 'https:', ...] */
function directiveSources(name: string): string[] {
  const directive = cspContent()
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(`${name} `))
  assert.ok(directive, `CSP 里必须显式写出 ${name} 指令`)
  return directive.split(/\s+/).slice(1)
}

test('img-src 放行后端 HTTP 源，头像不再被 CSP 拦成字母头像', () => {
  // 2026-10 修复的那一行：src 是纯 http，只有 img-src 里显式列出才允许加载
  assert.ok(
    directiveSources('img-src').includes(BACKEND_ORIGIN),
    `img-src 必须包含 ${BACKEND_ORIGIN}，否则 http 头像会被拦掉`,
  )
})

test('后端来源（AUTH_BASE_URL 的 origin）必然在 img-src 白名单里', () => {
  // 换后端域名时这条会先炸，提醒同步 index.html —— 而不是等用户反馈头像变字母
  const origin = new URL(AUTH_BASE_URL).origin
  assert.equal(origin, BACKEND_ORIGIN, 'AUTH_BASE_URL 换了域名，index.html 的 img-src 要同步')
  assert.ok(directiveSources('img-src').includes(origin))
})
