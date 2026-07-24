import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../core/models/song.dart';
import 'auth_service.dart';
import 'music_provider.dart';
import 'bilibili_music_provider.dart';
import 'meting_music_provider.dart';
import 'default_music_provider.dart';
import 'fallback_music_provider.dart';
import 'hybrid_music_provider.dart';

/// Music service provider - singleton instance
///
/// Uses HybridMusicProvider to combine:
/// - Metadata (lyrics, song info) from Meting/Default
/// - Playback URLs from Bilibili
final musicServiceProvider = Provider<MusicService>((ref) {
  return MusicService(
    provider: HybridMusicProvider(
      metadata: FallbackMusicProvider(
        primary: MetingMusicProvider(
          // Read latest login token on each music request (Bearer auth).
          tokenProvider: () => ref.read(authProvider).token,
        ),
        fallback: DefaultMusicProvider(),
        isPrimaryId: (id) =>
            id.startsWith('meting:') || id.startsWith('meting-artist:'),
      ),
      playback: BilibiliMusicProvider(),
    ),
  );
});

/// How [MusicService.searchSongs] should load results.
enum MusicSearchScope {
  /// Hybrid: metadata songs + Bilibili playlists.
  all,

  /// Metadata songs only (Meting/Default).
  metadataSongs,

  /// Bilibili playlists only.
  bilibiliPlaylists,
}

/// Music service - handles music data and playback
class MusicService {
  MusicService({required MusicProvider provider}) : _provider = provider;

  final MusicProvider _provider;
  final Map<String, Map<String, dynamic>> _cache = {};

  /// Expose dio instance for downloading audio files with proper headers
  Dio get dio {
    if (_provider is BilibiliMusicProvider) {
      return _provider.dio;
    }
    throw UnsupportedError('Current provider does not expose Dio instance');
  }

  /// Search songs / playlists according to [scope].
  Future<List<Song>> searchSongs(
    String query, {
    MusicSearchScope scope = MusicSearchScope.all,
  }) async {
    try {
      final results = await _searchRaw(query, scope);
      _cacheResults(results);
      return results.map(_toSong).toList();
    } catch (e) {
      return [];
    }
  }

  Future<List<Map<String, dynamic>>> _searchRaw(
    String query,
    MusicSearchScope scope,
  ) async {
    final provider = _provider;
    if (provider is HybridMusicProvider) {
      return switch (scope) {
        MusicSearchScope.all => provider.searchSongs(query),
        MusicSearchScope.metadataSongs => provider.searchMetadataSongs(query),
        MusicSearchScope.bilibiliPlaylists =>
          provider.searchBilibiliPlaylists(query),
      };
    }
    return provider.searchSongs(query);
  }

  /// Get recommended songs
  Future<List<Song>> getRecommendedSongs() async {
    try {
      final results = await _provider.getRecommendedSongs();
      _cacheResults(results);
      return results.map(_toSong).toList();
    } catch (e) {
      return [];
    }
  }

  /// Get hot playlists
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async {
    try {
      return await _provider.getHotPlaylists(limit: limit, offset: offset);
    } catch (e) {
      return [];
    }
  }

  /// Get playlist details
  Future<Map<String, dynamic>?> getPlaylist(String id, {int? limit}) async {
    try {
      final playlist = await _provider.getPlaylist(id, limit: limit);
      final songs = playlist['songs'] as List?;
      if (songs != null) {
        _cacheResults(songs.whereType<Map<String, dynamic>>());
      }
      return playlist;
    } catch (e) {
      return null;
    }
  }

  /// Get song detail
  Future<Song?> getSongDetail(String id) async {
    // Check cache first
    final cached = _cache[id];
    if (cached != null) {
      return _toSong(cached);
    }

    try {
      final detail = await _provider.getSongDetail(id);
      final merged = _mergeSongData(_cache[id], detail);
      _cache[id] = merged;
      return _toSong(merged);
    } catch (e) {
      return null;
    }
  }

  /// Get cached song map with lyrics
  Map<String, dynamic>? getCachedSongMap(String id) {
    return _cache[id];
  }

  /// Get playback URL for a song
  Future<PlaybackUrl> getPlayUrl(String id) async {
    try {
      final playbackUrl = await _provider.getPlayUrl(id);

      // Cache playback metadata for later library/history lyric lookups.
      print('[MusicService] getPlayUrl - 歌词长度: ${playbackUrl.lyrics.length}');
      if (playbackUrl.lyrics.isNotEmpty || playbackUrl.resolvedId.isNotEmpty) {
        var cached = _cache[id];
        if (cached == null) {
          // Create cache entry if it doesn't exist
          print('[MusicService] 创建新缓存条目');
          cached = <String, dynamic>{'id': id};
          _cache[id] = cached;
        }
        if (playbackUrl.lyrics.isNotEmpty) {
          cached['lyrics'] = playbackUrl.lyrics;
        }
        if (playbackUrl.resolvedId.isNotEmpty) {
          cached['playbackId'] = playbackUrl.resolvedId;
        }
        print('[MusicService] 歌词已缓存到 $id');
      }

      return playbackUrl;
    } catch (e) {
      rethrow;
    }
  }

  /// Get lyrics for a song
  Future<String> getLyrics(Map<String, dynamic> song) async {
    try {
      final id = song['id']?.toString() ?? '';
      final cached = _mergeSongData(_cache[id], song);
      return await _provider.getLyrics(cached);
    } catch (e) {
      return '';
    }
  }

  /// Remember songs in cache (for HybridMusicProvider)
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {
    _provider.rememberSongs(songs);
    _cacheResults(songs);
  }

  /// Remember updated metadata for a single song, including lyrics loaded later.
  void rememberSong(Map<String, dynamic> song) {
    rememberSongs([song]);
  }

  void _cacheResults(Iterable<Map<String, dynamic>> results) {
    for (final item in results) {
      final id = item['id']?.toString();
      if (id != null && id.isNotEmpty) {
        _cache[id] = _mergeSongData(_cache[id], item);
      }
    }
  }

  Map<String, dynamic> _mergeSongData(
    Map<String, dynamic>? existing,
    Map<String, dynamic> incoming,
  ) {
    if (existing == null) return Map<String, dynamic>.from(incoming);

    final merged = Map<String, dynamic>.from(existing);
    for (final entry in incoming.entries) {
      final current = merged[entry.key];
      if (_hasUsefulCacheValue(entry.key, entry.value) ||
          !_hasUsefulCacheValue(entry.key, current)) {
        merged[entry.key] = entry.value;
      }
    }
    return merged;
  }

  bool _hasUsefulCacheValue(String key, Object? value) {
    if (value == null) return false;
    if (value is String) {
      final text = value.trim();
      if (text.isEmpty) return false;
      if (key == 'duration') return text != '0' && text != '0:00';
      return text != '未知标题' && text != '未知艺人';
    }
    if (value is num && key == 'duration') return value > 0;
    if (value is Iterable) return value.isNotEmpty;
    if (value is Map) return value.isNotEmpty;
    return true;
  }

  Song _toSong(Map<String, dynamic> data) {
    final id = data['id']?.toString() ?? '';
    final title = data['title']?.toString() ?? '未知标题';
    final artist = data['artist']?.toString() ?? '未知艺人';
    final source = data['source']?.toString() ?? 'bilibili';
    final sourceLabel = data['sourceLabel']?.toString();
    final metaSource = data['metaSource']?.toString();
    final durationMs = data['duration'] as int? ?? 0;
    final coverUrl = data['coverUrl']?.toString();
    final resultType = data['resultType']?.toString() ?? 'song';
    final songCount = data['songCount'] as int? ?? 0;
    final isFavorite = data['isFavorite'] as bool? ?? false;
    final isCached = data['isCached'] as bool? ?? false;

    return Song(
      id: id,
      title: title,
      artist: artist,
      source: source,
      metaSource: metaSource ?? sourceLabel,
      duration: _formatDuration(Duration(milliseconds: durationMs)),
      coverUrl: coverUrl,
      resultType: resultType,
      songCount: songCount,
      isFavorite: isFavorite,
      isCached: isCached,
    );
  }

  String _formatDuration(Duration duration) {
    final minutes = duration.inMinutes;
    final seconds = duration.inSeconds.remainder(60);
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }
}
