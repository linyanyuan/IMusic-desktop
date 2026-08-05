import 'package:dio/dio.dart';

import 'music_provider.dart';

/// Thrown when no ChKSz API key is configured. The UI shows an actionable
/// "configure your key" prompt; playback must NOT fall back to Bilibili for
/// this error (config error, not a source failure).
class ChkszApiKeyMissingException implements Exception {
  // Note: no trailing comma allowed inside `[...]` optional positional
  // parameter lists (Dart parser quirk).
  const ChkszApiKeyMissingException([
    this.message = '未配置 ChKSz API 密钥，请在设置中填写',
  ]);

  final String message;

  @override
  String toString() => message;
}

/// Thrown for ChKSz business errors (HTTP 200 but `code != 200`).
class ChkszApiException implements Exception {
  const ChkszApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Key provider: returns the runtime-configured key (settings page); empty
/// when the user has not configured one.
typedef ChkszApiKeyProvider = String Function();

/// Thin client for the ChKSz NetEase music API (https://api.chksz.com).
///
/// ID conventions (must match the mobile end so synced favorites/playlists
/// resolve to the same source):
///   song:     `chksz:163:{neteaseSongId}`
///   playlist: `chksz:playlist:{neteasePlaylistId}`
///
/// Key resolution priority: runtime provider (app settings) > compile-time
/// `--dart-define=CHKSZ_API_KEY`.
class ChkszMusicClient {
  ChkszMusicClient({
    Dio? dio,
    this.baseUrl = defaultBaseUrl,
    ChkszApiKeyProvider? apiKeyProvider,
    this.searchTimeout = const Duration(seconds: 12),
  }) : _apiKeyProvider = apiKeyProvider ?? _envKey,
       _dio =
           dio ??
           Dio(
             BaseOptions(
               connectTimeout: const Duration(seconds: 12),
               receiveTimeout: const Duration(seconds: 15),
               headers: const {
                 'User-Agent':
                     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                 'Accept': 'application/json, text/javascript, */*; q=0.01',
               },
             ),
           );

  static const defaultBaseUrl = 'https://api.chksz.com';
  static const idPrefix = 'chksz:';
  static const songIdPrefix = 'chksz:163:';
  static const playlistIdPrefix = 'chksz:playlist:';

  /// Compile-time key (`--dart-define=CHKSZ_API_KEY=...`); never committed.
  static const envApiKey = String.fromEnvironment('CHKSZ_API_KEY');

  /// Quality ladder: prefer exhigh, fall back to standard.
  static const qualityLadder = ['exhigh', 'standard'];

  /// Cap each url probe so a slow source cannot stall playback.
  static const urlAttemptTimeout = Duration(seconds: 5);

  /// Overall Bilibili fallback budget (mobile parity, ~12s).
  static const fallbackTimeout = Duration(seconds: 12);

  static String _envKey() => envApiKey;

  final String baseUrl;
  final Dio _dio;
  final ChkszApiKeyProvider _apiKeyProvider;
  final Duration searchTimeout;

  /// Runtime settings take priority over the compile-time define.
  String get _apiKey {
    final configured = _apiKeyProvider().trim();
    if (configured.isNotEmpty) return configured;
    return envApiKey;
  }

  // === ID helpers (must match mobile conventions) ===

  static bool isChkszId(String id) => id.startsWith(idPrefix);

  static bool isChkszSongId(String id) => id.startsWith(songIdPrefix);

  static bool isChkszPlaylistId(String id) => id.startsWith(playlistIdPrefix);

  static String buildSongId(String neteaseId) => '$songIdPrefix$neteaseId';

  static String buildPlaylistId(String neteaseId) =>
      '$playlistIdPrefix$neteaseId';

  /// `chksz:163:{id}` → `{id}`; null for anything else.
  static String? parseSongId(String id) {
    if (!id.startsWith(songIdPrefix)) return null;
    final rest = id.substring(songIdPrefix.length);
    return rest.isEmpty ? null : rest;
  }

  /// `chksz:playlist:{id}` → `{id}`; null for anything else.
  static String? parsePlaylistId(String id) {
    if (!id.startsWith(playlistIdPrefix)) return null;
    final rest = id.substring(playlistIdPrefix.length);
    return rest.isEmpty ? null : rest;
  }

  // === Search ===

  /// Page size for [searchSongs]; matches the search UI's per-page hint
  /// (`kSearchPageSizeHint`) so load-more paging stays aligned.
  static const searchPageSize = 20;

  /// Search NetEase single songs with offset paging
  /// (`offset = (page - 1) * [searchPageSize]`). Results are deduped by id.
  Future<List<Map<String, dynamic>>> searchSongs(
    String query, {
    int page = 1,
  }) async {
    final q = query.trim();
    if (q.isEmpty) return const [];
    final safePage = page < 1 ? 1 : page;
    final data = await _getJson('/api/163_search', {
      'keyword': q,
      'limit': searchPageSize,
      if (safePage > 1) 'offset': (safePage - 1) * searchPageSize,
    }).timeout(searchTimeout);

    final songs = _extractSongs(data);
    final seen = <String>{};
    final results = <Map<String, dynamic>>[];
    for (final song in songs) {
      final id = song['id']?.toString() ?? '';
      if (id.isEmpty || !seen.add(id)) continue;
      results.add(song);
    }
    return results;
  }

  /// `data` may be `{ "songs": [...], "total": N }` or a raw array.
  List<Map<String, dynamic>> _extractSongs(Map<String, dynamic> data) {
    final rawData = data['data'];
    final rows = <Object?>[];
    if (rawData is Map) {
      final songs = rawData['songs'];
      if (songs is List) rows.addAll(songs);
    } else if (rawData is List) {
      rows.addAll(rawData);
    }

    final songs = <Map<String, dynamic>>[];
    for (final row in rows) {
      if (row is! Map) continue;
      final mapped = mapSearchItem(row.cast<String, dynamic>());
      if (mapped != null) songs.add(mapped);
    }
    return songs;
  }

  /// Map NetEase search row → app song map. Returns null if unusable.
  ///
  /// Search rows carry a top-level `picUrl`; playlist tracks use `al.picUrl`.
  static Map<String, dynamic>? mapSearchItem(Map<String, dynamic> raw) {
    final id = raw['id']?.toString() ?? '';
    final name = raw['name']?.toString().trim() ?? '';
    if (id.isEmpty || name.isEmpty) return null;

    final albumRaw = raw['al'] ?? raw['album'];
    final coverUrl = _picUrl(raw) ?? _picUrl(albumRaw);
    final durationMs = _dtMs(raw['dt'] ?? raw['duration']);

    return {
      'id': buildSongId(id),
      'title': name,
      'artist': _artistText(raw['ar'] ?? raw['artists']),
      'album': _albumName(albumRaw),
      'coverUrl': ?coverUrl,
      if (durationMs > 0) 'duration': durationMs,
      'resultType': 'song',
      'source': 'chksz',
      'sourceLabel': 'ChKSz · 网易云',
      'metaSource': 'ChKSz',
      'playbackSource': 'chksz',
    };
  }

  // === Play URL ===

  /// Resolve a playable URL for a `chksz:163:` song id (quality ladder
  /// exhigh → standard, each probe bounded by [urlAttemptTimeout]).
  ///
  /// The resolve endpoint also returns `picUrl` — carried back as
  /// [PlaybackUrl.coverUrl] so the player bar / full player can show art even
  /// when the song map itself has no cover.
  Future<PlaybackUrl> getPlayUrl(String songId) async {
    final neteaseId = parseSongId(songId);
    if (neteaseId == null) {
      throw StateError('invalid chksz song id: $songId');
    }

    String? url;
    String? coverUrl;
    Object? lastError;
    for (final level in qualityLadder) {
      try {
        final hit = await _fetchUrl(
          neteaseId,
          level,
        ).timeout(urlAttemptTimeout);
        if (hit != null && hit.url.isNotEmpty) {
          url = hit.url;
          coverUrl = hit.picUrl;
          break;
        }
      } on ChkszApiKeyMissingException {
        rethrow;
      } on ChkszApiException {
        // Business/auth errors are systemic (bad key, rate limit) — not a
        // per-level availability signal; stop probing and surface the error.
        rethrow;
      } catch (e) {
        lastError = e;
        print('[ChKSz] url level=$level failed: $e');
      }
    }

    if (url == null || url.isEmpty) {
      throw StateError(
        'ChKSz 未返回播放地址 ($songId)${lastError == null ? '' : ': $lastError'}',
      );
    }

    final normalized = url.startsWith('http://')
        ? 'https://${url.substring('http://'.length)}'
        : url;
    return PlaybackUrl(
      normalized,
      headers: const {},
      lyrics: '',
      resolvedId: songId,
      coverUrl: coverUrl ?? '',
    );
  }

  /// Song detail via the resolve endpoint (the API has no separate detail
  /// endpoint; 163_music returns name/artist/album/picUrl alongside the url).
  Future<Map<String, dynamic>> getSongDetail(String songId) async {
    final neteaseId = parseSongId(songId);
    if (neteaseId == null) return {'id': songId};
    try {
      final data = await _getJson('/api/163_music', {
        'id': neteaseId,
        'level': qualityLadder.first,
        'type': 'json',
      });
      final rawData = data['data'];
      if (rawData is! Map) return {'id': songId};
      final map = rawData.cast<String, dynamic>();
      return {
        'id': songId,
        'title': map['name']?.toString() ?? '',
        'artist': _artistText(map['artist']),
        'album': map['album']?.toString() ?? '',
        'coverUrl': _toHttps(map['picUrl']?.toString().trim() ?? ''),
        'resultType': 'song',
        'source': 'chksz',
        'sourceLabel': 'ChKSz · 网易云',
      };
    } catch (_) {
      return {'id': songId};
    }
  }

  Future<({String url, String picUrl})?> _fetchUrl(
    String neteaseId,
    String level,
  ) async {
    final data = await _getJson('/api/163_music', {
      'id': neteaseId,
      'level': level,
      'type': 'json',
    });
    final rawData = data['data'];
    if (rawData is! Map) return null;
    final map = rawData.cast<String, dynamic>();
    final url = map['url']?.toString().trim() ?? '';
    if (url.isEmpty) return null;
    final picUrl = map['picUrl']?.toString().trim() ?? '';
    return (url: url, picUrl: picUrl.isEmpty ? '' : _toHttps(picUrl));
  }

  // === Lyrics ===

  /// NetEase LRC; falls back to translation lyrics when original is empty.
  Future<String> getLyric(String songId) async {
    final neteaseId = parseSongId(songId);
    if (neteaseId == null) return '';
    final data = await _getJson('/api/163_lyric', {'id': neteaseId});
    final rawData = data['data'];
    if (rawData is! Map) return '';
    final lrc = rawData['lrc']?.toString().trim() ?? '';
    if (lrc.isNotEmpty && lrc != 'null') return lrc;
    final tlyric = rawData['tlyric']?.toString().trim() ?? '';
    if (tlyric.isEmpty || tlyric == 'null') return '';
    return tlyric;
  }

  // === Playlist ===

  /// Playlist detail; tracks are mapped to `chksz:163:` song ids.
  Future<Map<String, dynamic>> getPlaylist(
    String playlistId, {
    int? limit,
  }) async {
    final neteaseId = parsePlaylistId(playlistId);
    if (neteaseId == null) {
      throw StateError('invalid chksz playlist id: $playlistId');
    }
    final data = await _getJson('/api/163_playlist', {'id': neteaseId});
    final playlist = mapPlaylist(data['data']);
    // The playlist endpoint has no partial-load param; slice locally.
    if (limit != null && limit > 0) {
      final songs = playlist['songs'];
      if (songs is List && songs.length > limit) {
        playlist['songs'] = songs.sublist(0, limit);
        playlist['songCount'] = limit;
      }
    }
    return playlist;
  }

  static Map<String, dynamic> mapPlaylist(Object? raw) {
    if (raw is! Map) return const {'resultType': 'playlist'};
    final map = raw.cast<String, dynamic>();

    final tracks = <Object?>[
      if (map['songs'] is List) ...map['songs'] as List,
      if (map['tracks'] is List) ...map['tracks'] as List,
    ];
    final songs = <Map<String, dynamic>>[];
    for (final track in tracks) {
      if (track is! Map) continue;
      final mapped = mapSearchItem(track.cast<String, dynamic>());
      if (mapped != null) songs.add(mapped);
    }

    final creator = map['creator'];
    final coverUrl = _picUrl(map);

    return {
      'id': buildPlaylistId(map['id']?.toString() ?? neteaseIdOf(map)),
      'title': map['name']?.toString() ?? '',
      'artist': creator is Map ? (creator['nickname']?.toString() ?? '') : '',
      'songs': songs,
      'resultType': 'playlist',
      'songCount': songs.length,
      'coverUrl': ?coverUrl,
      'source': 'chksz',
      'sourceLabel': 'ChKSz · 网易云',
    };
  }

  static String neteaseIdOf(Map<String, dynamic> map) {
    return map['id']?.toString() ?? '';
  }

  // === Shared mapping helpers ===

  static String _artistText(Object? raw) {
    if (raw is List) {
      return raw
          .map(_singleArtistName)
          .where((name) => name.isNotEmpty)
          .join(' / ');
    }
    return _singleArtistName(raw);
  }

  static String _singleArtistName(Object? raw) {
    if (raw is Map) {
      final name = (raw['name'] ?? raw['nickname'] ?? raw['userName'])
          ?.toString();
      return name?.trim() ?? '';
    }
    return raw?.toString().trim() ?? '';
  }

  static String _albumName(Object? raw) {
    if (raw is! Map) return '';
    return raw['name']?.toString().trim() ?? '';
  }

  static String? _picUrl(Object? raw) {
    if (raw is! Map) return null;
    final pic =
        (raw['picUrl'] ?? raw['coverImgUrl'] ?? raw['pic'])
            ?.toString()
            .trim() ??
        '';
    if (pic.isEmpty) return null;
    return _toHttps(pic);
  }

  static String _toHttps(String url) {
    if (url.startsWith('http://')) return 'https://${url.substring(7)}';
    return url;
  }

  /// NetEase durations (`dt`) are milliseconds; tolerate seconds too.
  static int _dtMs(Object? value) {
    if (value == null) return 0;
    if (value is num) {
      return value > 10000 ? value.round() : (value * 1000).round();
    }
    final n = int.tryParse(value.toString().trim());
    if (n == null) return 0;
    return n > 10000 ? n : n * 1000;
  }

  // === Transport ===

  /// GET JSON with `apikey`. Throws [ChkszApiKeyMissingException] before any
  /// request when no key is configured; [ChkszApiException] for business
  /// errors (`code` present and != 200).
  Future<Map<String, dynamic>> _getJson(
    String path,
    Map<String, dynamic> query,
  ) async {
    final key = _apiKey;
    if (key.isEmpty) {
      throw const ChkszApiKeyMissingException();
    }

    final Response<dynamic> response;
    try {
      response = await _dio.get<dynamic>(
        '$baseUrl$path',
        queryParameters: {...query, 'apikey': key},
      );
    } on DioException catch (e) {
      // 401/403 → readable auth error; other HTTP failures keep their status.
      throw _httpError(e);
    }
    final data = response.data;
    if (data is! Map) {
      throw const ChkszApiException('ChKSz 响应格式错误');
    }
    final map = data.cast<String, dynamic>();
    final code = map['code'];
    if (code is num && code != 200) {
      throw ChkszApiException(
        map['msg']?.toString() ?? 'ChKSz 业务错误 (code=$code)',
      );
    }
    return map;
  }

  /// HTTP 401/403 → readable auth error (invalid or missing apikey);
  /// other HTTP failures keep their status in the message.
  static ChkszApiException _httpError(DioException e) {
    final status = e.response?.statusCode;
    return ChkszApiException(
      status == 401 || status == 403
          ? 'ChKSz API 密钥无效或未授权，请在设置中检查'
          : 'ChKSz 请求失败 (HTTP ${status ?? '连接错误'})',
    );
  }
}
