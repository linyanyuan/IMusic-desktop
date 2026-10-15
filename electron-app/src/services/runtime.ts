/**
 * 服务运行时装配 —— 等价 Flutter 的 Riverpod provider 组合。
 * 依赖 appSettings / auth 的注入函数，避免循环依赖。
 */

import { createMusicService, type MusicService } from './musicService'
import { AppSettings } from './appSettings'
import { AuthService } from './auth'
import { LibraryService } from './library'

export interface Services {
  settings: AppSettings
  auth: AuthService
  music: MusicService
  library: LibraryService
}

let cached: Services | null = null

export function getServices(): Services {
  if (cached != null) return cached
  const settings = new AppSettings()

  // auth 与 library 互相依赖（登录要灌库、请求要带 token）—— 用惰性引用打破构造顺序：
  // 两个回调都在登录/登出那一刻才真正执行，那时 library 已赋值。
  //
  // 这两个回调曾是真实缺口：Dart 端 AuthNotifier 登录后调
  // libraryProvider.setLibraryFromLogin(...)、登出调 clearAccountLibrary()；
  // TS 端没接线，于是「登录成功」提示出现了、云端收藏/歌单却一首也没下来。
  let library: LibraryService | null = null

  const auth = new AuthService({
    onLibraryFromLogin: (remote) => library?.setLibraryFromLogin(remote),
    onAccountLibraryCleared: () => library?.clearAccountLibrary(),
  })
  library = new LibraryService({
    tokenProvider: () => auth.getToken(),
    onAuthExpired: () => {
      void auth.logout()
    },
  })

  const music = createMusicService({
    tokenProvider: () => auth.getToken(),
    chkszApiKeyProvider: () => settings.getChkszApiKey(),
  })
  cached = { settings, auth, music, library }
  return cached
}
