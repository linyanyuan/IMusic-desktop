import { session } from 'electron'

/**
 * 音源域名请求头注入。
 *
 * 注意：Electron 每个 session 的 webRequest 事件只允许注册一个监听器，
 * 重复调用 onBeforeSendHeaders 会覆盖之前的。因此 CDN 与 API 的请求头
 * 处理必须合并在同一个监听器内（B 站音频 CDN 拿不到 Referer → 403，
 * 这是 Flutter 端无法流播、必须先整首下载的根因）。
 */
export function setupSourceHeaders() {
  const sourceUrls = [
    // Bilibili 图片/音频 CDN 与 API
    'https://*.hdslb.com/*',
    'https://*.bilivideo.com/*',
    'https://*.bilivideo.cn/*',
    'https://*.akamaized.net/*',
    'https://*.bilibili.com/*',
    // 网易云（ChKSz 音频回源）
    'https://*.music.126.net/*',
    'https://*.163.com/*',
  ]

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: sourceUrls },
    (details, callback) => {
      const headers = details.requestHeaders
      // 绝不给 CDN 带会话 Cookie
      delete headers.Cookie
      delete headers.cookie

      const url = details.url
      if (/\.(hdslb|bilivideo)\.(com|cn)|akamaized\.net|bilibili\.com/.test(url)) {
        headers.Referer = 'https://www.bilibili.com'
      } else if (/music\.126\.net|163\.com/.test(url)) {
        headers.Referer = 'https://music.163.com'
      }
      callback({ requestHeaders: headers })
    },
  )
}
