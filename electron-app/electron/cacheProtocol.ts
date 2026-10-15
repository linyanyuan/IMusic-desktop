/**
 * imusic-audio:// 特权协议 —— 本地缓存文件的受控暴露：
 * - standard + secure + stream（必须在 app ready 前注册 scheme）
 * - token（cache key 的 sha256）间接寻址，渲染层永远看不到真实路径
 * - 支持 HTTP Range（206/416），供 <audio> seek
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { cacheKeyFor, cachePathForToken, verifyCachedFile } from './audioCache'

export const AUDIO_SCHEME = 'imusic-audio'

/** 必须在 app.whenReady() 之前调用 */
export function registerAudioSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_SCHEME,
      privileges: { standard: true, secure: true, stream: true },
    },
  ])
}

/** 由缓存 id 生成渲染层可用的协议 URL（token = cache key） */
export function audioUrlFor(id: string): string {
  return `${AUDIO_SCHEME}://local/${cacheKeyFor(id)}`
}

const MIME_BY_EXT: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
}

/** 复用 audioCache 的目录解析（含用户在设置页指定的缓存目录），再走完整完整性校验 */
async function resolveByToken(
  token: string,
): Promise<{ path: string; mime: string } | null> {
  const p = cachePathForToken(token)
  const report = await verifyCachedFile(p)
  if (!report.ok) return null
  const mime =
    report.kind === 'mp3'
      ? (MIME_BY_EXT['.mp3'] ?? 'audio/mpeg')
      : (MIME_BY_EXT['.m4a'] ?? 'audio/mp4')
  return { path: p, mime }
}

/** app ready 后注册 handler */
export function registerAudioProtocolHandler(): void {
  protocol.handle(AUDIO_SCHEME, async (request) => {
    let token: string
    try {
      const url = new URL(request.url)
      token = url.pathname.replace(/^\//, '')
    } catch {
      return new Response('bad url', { status: 400 })
    }
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return new Response('bad token', { status: 400 })
    }

    const resolved = await resolveByToken(token)
    if (resolved == null) {
      return new Response('gone', { status: 410 })
    }
    const filePath = resolved.path
    const mime = resolved.mime

    const size = (await stat(filePath)).size
    const rangeHeader = request.headers.get('range')

    if (rangeHeader != null && rangeHeader !== '') {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
      if (m == null) {
        return new Response('bad range', { status: 416 })
      }
      let start = m[1] === '' ? 0 : Number.parseInt(m[1], 10)
      let end = m[2] === '' ? size - 1 : Number.parseInt(m[2], 10)
      if (m[1] === '' && m[2] !== '') {
        // suffix range: bytes=-500
        start = Math.max(0, size - Number.parseInt(m[2], 10))
        end = size - 1
      }
      if (start >= size || end < start) {
        return new Response('range not satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        })
      }
      end = Math.min(end, size - 1)
      // SAFETY: node Readable 与 web ReadableStream 运行时可互转，Readable.toWeb 是官方桥。
      const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
      return new Response(stream, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      })
    }

    // SAFETY: 同上，Readable.toWeb 官方桥。
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    })
  })
}
