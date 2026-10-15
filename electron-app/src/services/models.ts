/**
 * 数据模型 —— 移植自 lib/core/models/song.dart 与 lib/services/music_provider.dart。
 * 保持与 Flutter 版一致的 JSON 结构，以便本地/远端数据互通。
 */

export interface Song {
  id: string
  title: string
  artist: string
  /** 播放来源，如 "Bilibili" */
  source: string
  /** 元数据来源，如 "Tencent Music metadata" */
  metaSource?: string
  duration: string
  coverUrl?: string
  resultType: string // 'song' | 'playlist'
  songCount: number
  isFavorite: boolean
  isCached: boolean
  /** 保留未知原始字段（播放/歌词元数据随 extra 回传管线） */
  extra: Record<string, unknown>
}

export function isPlaylist(song: Song): boolean {
  return song.resultType === 'playlist'
}

/** "Tencent Music metadata · Bilibili 播放" */
export function sourceLabel(song: Song): string {
  return song.metaSource == null ? song.source : `${song.metaSource} · ${song.source} 播放`
}

export function songFromJson(json: Record<string, unknown>): Song {
  const rawDuration = json['duration']
  return {
    id: json['id']?.toString() ?? '',
    title: json['title']?.toString() ?? '未知歌曲',
    artist: json['artist']?.toString() ?? '未知艺人',
    source: json['source']?.toString() ?? 'Unknown',
    metaSource: json['metaSource']?.toString(),
    duration: rawDuration?.toString() ?? '0:00',
    coverUrl: json['coverUrl']?.toString(),
    resultType: json['resultType']?.toString() ?? 'song',
    songCount: typeof json['songCount'] === 'number' ? (json['songCount'] as number) : 0,
    isFavorite: json['isFavorite'] === true,
    isCached: json['isCached'] === true,
    extra: { ...json },
  }
}

export function songToJson(song: Song): Record<string, unknown> {
  return {
    ...song.extra,
    id: song.id,
    title: song.title,
    artist: song.artist,
    source: song.source,
    metaSource: song.metaSource,
    duration: 'duration' in song.extra ? song.extra['duration'] : song.duration,
    coverUrl: song.coverUrl,
    resultType: song.resultType,
    songCount: song.songCount,
    isFavorite: song.isFavorite,
    isCached: song.isCached,
  }
}

export function songCopyWith(song: Song, patch: Partial<Song>): Song {
  return { ...song, ...patch, extra: patch.extra ?? song.extra }
}

/** 自建歌单（含服务端同步字段） */
export interface UserPlaylist {
  id: string
  name: string
  songIds: string[]
  createdAt: number
  updatedAt: number
}

/** 播放地址 —— 与 Dart PlaybackUrl 一致 */
export interface PlaybackUrl {
  url: string
  headers: Record<string, string>
  lyrics: string
  resolvedId: string
  /** 解析过程中发现的封面（如 ChKSz 163_music 返回的 picUrl） */
  coverUrl: string
}

export function playbackUrl(
  url: string,
  init?: Partial<Omit<PlaybackUrl, 'url'>>,
): PlaybackUrl {
  return {
    url,
    headers: init?.headers ?? {},
    lyrics: init?.lyrics ?? '',
    resolvedId: init?.resolvedId ?? '',
    coverUrl: init?.coverUrl ?? '',
  }
}

export interface PlaybackPage {
  songs: Song[]
  hasMore: boolean
  nextPage: number
  total?: number
}

export interface SearchPageResult {
  songs: Song[]
  hasMore: boolean
  nextPage: number
}

/** 搜索范围 —— 与 Flutter MusicSearchScope 一致 */
/** 播放模式 —— 对应 Flutter PlayMode */
export const PlayMode = {
  List: 'list',
  Single: 'single',
  Shuffle: 'shuffle',
} as const
export type PlayMode = (typeof PlayMode)[keyof typeof PlayMode]

export const MusicSearchScope = {
  All: 'all',
  MetadataSongs: 'metadataSongs',
  BilibiliPlaylists: 'bilibiliPlaylists',
  ChkszSongs: 'chkszSongs',
} as const
export type MusicSearchScope =
  (typeof MusicSearchScope)[keyof typeof MusicSearchScope]
