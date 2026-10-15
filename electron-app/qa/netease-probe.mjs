// 网易云公开接口真实连通性探针（会发真实网络请求，不 mock）。
//
// 用法: node qa/netease-probe.mjs
// 输出协议：console.log（与 qa/ 下其它探针一致，供人工/脚本读 stdout）。
//
// 直接调用源码里的 NeteasePublicClient（先用 esbuild 把 TS 打成临时 CJS，
// 保证探针验证的是应用真正使用的那份实现，而不是等价的手写请求）。

import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')
const tmpDir = path.join(os.tmpdir(), 'imusic-netease-probe')
const bundlePath = path.join(tmpDir, 'netease.cjs')

const CATEGORY = process.argv[2] ?? '流行'

function line(label, value) {
  console.log(`${label}: ${value}`)
}

async function main() {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })
  await build({
    entryPoints: [path.join(appRoot, 'src/services/netease.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'warning',
  })

  const require = createRequire(import.meta.url)
  const { NeteasePublicClient } = require(bundlePath)
  const client = new NeteasePublicClient()

  line('category', CATEGORY)

  const playlists = await client.getCategoryPlaylists(CATEGORY, { limit: 5, offset: 0 })
  line('playlists.count', playlists.length)
  playlists.slice(0, 3).forEach((playlist, index) => {
    console.log(
      JSON.stringify({
        index,
        id: playlist.id,
        title: playlist.title,
        artist: playlist.artist,
        songCount: playlist.songCount,
        playCount: playlist.playCount,
        coverUrl: playlist.coverUrl,
      }),
    )
  })

  if (playlists.length > 0) {
    const detail = await client.getPlaylist(playlists[0].id, 5)
    line('detail.title', detail.title)
    line('detail.songCount', detail.songCount)
    line('detail.songs', (detail.songs ?? []).length)
    for (const song of (detail.songs ?? []).slice(0, 3)) {
      console.log(
        JSON.stringify({
          id: song.id,
          title: song.title,
          artist: song.artist,
          album: song.album,
          duration: song.duration,
          coverUrl: song.coverUrl,
        }),
      )
    }
  }

  const songs = await client.getCategorySongs(CATEGORY, 1)
  line('categorySongs.count', songs.length)
  const ids = new Set(songs.map((song) => song.id))
  line('categorySongs.uniqueIds', ids.size)
  songs.slice(0, 3).forEach((song, index) => {
    console.log(
      JSON.stringify({
        index,
        id: song.id,
        title: song.title,
        artist: song.artist,
        sourceLabel: song.sourceLabel,
      }),
    )
  })
  line('probe', 'OK')
}

main().catch((error) => {
  line('probe', `FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
