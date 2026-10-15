import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../core/models/song.dart';
import 'app_settings.dart';
import 'auth_service.dart';
import 'chksz_music_client.dart';
import 'chksz_music_provider.dart';
import 'music_provider.dart';
import 'bilibili_music_provider.dart';
import 'meting_music_provider.dart';
import 'default_music_provider.dart';
import 'fallback_music_provider.dart';
import 'hybrid_music_provider.dart';

/// Music service provider - singleton instance
///
/// Uses HybridMusicProvider to combine:
/// - Song-tab: GDStudio search/play when available
/// - ChKSz: NetEase search/play when selected in the search source picker
/// - Metadata (lyrics, song info) from Meting/Default as fallback
/// - Playback URLs from Bilibili as fallback / playlists
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
      // Read the runtime-configured key on every request (settings page);
      // falls back to --dart-define=CHKSZ_API_KEY inside the client.
      chksz: ChkszMusicProvider(
        client: ChkszMusicClient(
          apiKeyProvider: () => ref.read(appSettingsProvider).chkszApiKey,
        ),
      ),
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

  /// ChKSz NetEase songs only (search source picker).
  chkszSongs,
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
  ///
  /// [page] is 1-based. Callers that want "load more" should append pages
  /// themselves (this method returns only the requested page).
  Future<List<Song>> searchSongs(
    String query, {
    MusicSearchScope scope = MusicSearchScope.all,
    int page = 1,
  }) async {
    try {
      final results = _dropUnplayable(await _searchRaw(query, scope, page: page));
      _cacheResults(results);
      return results.map(_toSong).toList();
    } catch (e) {
      return [];
    }
  }

  /// ChKSz-only search for the search source picker.
  ///
  /// Unlike [searchSongs], a missing API key is NOT swallowed: it rethrows
  /// [ChkszApiKeyMissingException] so the UI can prompt the user to configure
  /// the key instead of showing an empty list.
  Future<List<Song>> searchChkszSongs(String query, {int page = 1}) async {
    final safePage = page < 1 ? 1 : page;
    final provider = _provider;
    // Explicit cast: intersection promotion of unrelated types is unreliable.
    final chkszProvider = provider is ChkszSearchProvider
        ? provider as ChkszSearchProvider
        : null;
    if (chkszProvider == null) {
      throw const ChkszApiKeyMissingException('ChKSz 未启用');
    }
    try {
      final results = _dropUnplayable(
        await chkszProvider.searchChkszSongs(query, page: safePage),
      );
      _cacheResults(results);
      return results.map(_toSong).toList();
    } on ChkszApiKeyMissingException {
      rethrow;
    } on ChkszApiException {
      // Business errors (invalid key, rate limit, bad params) are actionable;
      // surface them so the UI shows an error instead of fake empty results.
      rethrow;
    } catch (e) {
      print('[MusicService] ChKSz 搜索失败: $e');
      return [];
    }
  }

  Future<List<Map<String, dynamic>>> _searchRaw(
    String query,
    MusicSearchScope scope, {
    int page = 1,
  }) async {
    final safePage = page < 1 ? 1 : page;
    final provider = _provider;
    if (provider is HybridMusicProvider) {
      return switch (scope) {
        MusicSearchScope.all => provider.searchSongs(query, page: safePage),
        MusicSearchScope.metadataSongs => provider.searchMetadataSongs(
          query,
          page: safePage,
        ),
        MusicSearchScope.bilibiliPlaylists => provider.searchBilibiliPlaylists(
          query,
          page: safePage,
        ),
        MusicSearchScope.chkszSongs => provider.searchChkszSongs(
          query,
          page: safePage,
        ),
      };
    }
    return provider.searchSongs(query, page: safePage);
  }

  /// 兜底过滤「空载荷 id」的条目（如 `bilibili:`、`gdstudio::`）。
  ///
  /// 上游搜索会混入 B 站课堂(ketang)/番剧/影视等没有 bvid 的结果，provider 层
  /// 已按来源剔除，这里对 Gateway 推荐、热点歌单等其它来源再兜一层，避免空 id
  /// 流入 UI 与播放链路。
  static List<Map<String, dynamic>> _dropUnplayable(
    Iterable<Map<String, dynamic>> songs,
  ) => songs.where((song) {
    final segments = (song['id']?.toString() ?? '').split(':').skip(1);
    return segments.isEmpty || segments.any((s) => s.trim().isNotEmpty);
  }).toList();

  /// Get recommended songs
  Future<List<Song>> getRecommendedSongs() async {
    try {
      final results = _dropUnplayable(await _provider.getRecommendedSongs());
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
      return _dropUnplayable(
        await _provider.getHotPlaylists(limit: limit, offset: offset),
      );
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

  Future<PlaylistSummary> getPlaylistSummary(Song playlist) {
    return _provider.getPlaylistSummary(playlist.toJson());
  }

  Future<Map<String, dynamic>> resolvePlaybackMetadata(Song song) async {
    final raw = song.toJson();
    rememberSong(raw);
    final resolvedId = await _provider.resolvePlaybackId(raw);
    if (!resolvedId.startsWith('bilibili:')) return raw;

    final canonicalId = _canonicalBilibiliPlaybackId(resolvedId);
    final parts = canonicalId.split(':');
    final bvid = parts.length > 1 ? parts[1] : '';
    final page = parts.length > 2
        ? int.tryParse(parts[2].replaceFirst(RegExp(r'^[pP]'), '')) ?? 1
        : 1;
    return {
      ...raw,
      if (song.id.startsWith('bilibili:')) 'id': canonicalId,
      'playbackId': canonicalId,
      'playbackSource': 'bilibili',
      'playbackSourceLabel': 'B站',
      'playbackSourceId': canonicalId,
      'sourceId': canonicalId,
      if (bvid.isNotEmpty) 'bvid': bvid,
      'page': page,
      if (bvid.isNotEmpty)
        'pageUrl': 'https://www.bilibili.com/video/$bvid?p=$page',
    };
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
      if (playbackUrl.lyrics.isNotEmpty ||
          playbackUrl.resolvedId.isNotEmpty ||
          playbackUrl.coverUrl.isNotEmpty) {
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
        if (playbackUrl.coverUrl.isNotEmpty) {
          cached['coverUrl'] = playbackUrl.coverUrl;
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
      extra: Map<String, dynamic>.from(data),
    );
  }

  String _formatDuration(Duration duration) {
    final minutes = duration.inMinutes;
    final seconds = duration.inSeconds.remainder(60);
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }

  String _canonicalBilibiliPlaybackId(String id) {
    final parts = id.split(':');
    if (parts.length < 2) return id;
    final pageText = parts.length > 2 ? parts[2] : '1';
    final page = int.tryParse(pageText.replaceFirst(RegExp(r'^[pP]'), '')) ?? 1;
    return 'bilibili:${parts[1]}:p${page < 1 ? 1 : page}';
  }
}
