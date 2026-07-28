import 'package:dio/dio.dart';

import 'music_provider.dart';

/// Thin client for https://music-api.gdstudio.xyz/api.php
///
/// Used as the preferred path for the desktop **songs** search tab.
/// Unstable sources / empty play URLs fall back to Hybrid + Bilibili.
class GdStudioMusicClient {
  GdStudioMusicClient({
    Dio? dio,
    this.baseUrl = defaultBaseUrl,
    this.sources = defaultSources,
    this.searchTimeout = const Duration(seconds: 8),
    this.countPerSource = defaultCountPerSource,
  }) : _dio =
           dio ??
           Dio(
             BaseOptions(
               connectTimeout: const Duration(seconds: 8),
               receiveTimeout: const Duration(seconds: 12),
               headers: const {
                 'User-Agent':
                     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                 'Accept': 'application/json, text/javascript, */*; q=0.01',
               },
             ),
           );

  static const defaultBaseUrl = 'https://music-api.gdstudio.xyz/api.php';

  /// Page-1 order: joox first (usually faster play URLs). kuwo paginates well.
  static const defaultSources = ['joox', 'kuwo', 'netease'];

  /// Sources that honor `pages`/`count` for load-more.
  static const pageableSources = ['kuwo'];

  /// Default page size per source (`count` query param).
  static const defaultCountPerSource = 20;

  static const idPrefix = 'gdstudio:';

  /// Cap each url/bitrate probe so a slow source cannot stall playback.
  static const urlAttemptTimeout = Duration(seconds: 5);

  final Dio _dio;
  final String baseUrl;
  final List<String> sources;
  final Duration searchTimeout;
  final int countPerSource;

  /// Sticky source for multi-page searches of the same query.
  String? _stickySource;
  String? _stickyQuery;

  /// `gdstudio:{source}:{urlId}` → (source, urlId)
  static (String source, String mediaId)? parseSongId(String id) {
    if (!id.startsWith(idPrefix)) return null;
    final rest = id.substring(idPrefix.length);
    final sep = rest.indexOf(':');
    if (sep <= 0 || sep >= rest.length - 1) return null;
    return (rest.substring(0, sep), rest.substring(sep + 1));
  }

  static String buildSongId({required String source, required String mediaId}) {
    return '$idPrefix$source:$mediaId';
  }

  static bool isGdStudioId(String id) => id.startsWith(idPrefix);

  /// Search preferred sources.
  ///
  /// Page 1: first non-empty among [sources] (joox → kuwo → …).
  /// Page 2+: prefer a pageable source (kuwo). If page 1 was joox (no real
  /// paging), UI page N maps to kuwo page N-1 so load-more still works.
  Future<List<Map<String, dynamic>>> searchSongs(
    String query, {
    int page = 1,
  }) async {
    final q = query.trim();
    if (q.isEmpty) return const [];
    final safePage = page < 1 ? 1 : page;

    if (safePage <= 1) {
      for (final source in sources) {
        try {
          final rows = await _searchSource(
            source,
            q,
            page: 1,
          ).timeout(searchTimeout);
          if (rows.isNotEmpty) {
            _stickySource = source;
            _stickyQuery = q;
            return rows;
          }
        } catch (e) {
          print('[GdStudio] search source=$source page=1 failed: $e');
        }
      }
      return const [];
    }

    final pageTarget = _pageTargetFor(query: q, page: safePage);
    for (final source in pageTarget.sources) {
      try {
        final rows = await _searchSource(
          source,
          q,
          page: pageTarget.sourcePage,
        ).timeout(searchTimeout);
        if (rows.isNotEmpty) {
          _stickySource = source;
          _stickyQuery = q;
          return rows;
        }
      } catch (e) {
        print(
          '[GdStudio] search source=$source page=${pageTarget.sourcePage} failed: $e',
        );
      }
    }
    return const [];
  }

  ({List<String> sources, int sourcePage}) _pageTargetFor({
    required String query,
    required int page,
  }) {
    final sticky =
        (_stickyQuery == query && _stickySource != null) ? _stickySource! : null;
    final pageableInConfig = [
      for (final s in sources)
        if (pageableSources.contains(s)) s,
    ];
    final fallbackPageable = pageableInConfig.isNotEmpty
        ? pageableInConfig
        : pageableSources;

    if (sticky != null && pageableSources.contains(sticky)) {
      return (
        sources: [sticky, ...fallbackPageable.where((s) => s != sticky)],
        sourcePage: page,
      );
    }

    // Non-pageable first hit (e.g. joox): first load-more → pageable page 1.
    final sourcePage = (page - 1) < 1 ? 1 : page - 1;
    return (sources: fallbackPageable, sourcePage: sourcePage);
  }

  Future<List<Map<String, dynamic>>> _searchSource(
    String source,
    String query, {
    int page = 1,
  }) async {
    final response = await _dio.get<dynamic>(
      baseUrl,
      queryParameters: {
        'types': 'search',
        'source': source,
        'name': query,
        'count': countPerSource,
        'pages': page < 1 ? 1 : page,
      },
    );
    final data = response.data;
    if (data is! List) return const [];

    final songs = <Map<String, dynamic>>[];
    final seen = <String>{};
    for (final item in data) {
      if (item is! Map) continue;
      final mapped = mapSearchItem(item.cast<String, dynamic>());
      if (mapped == null) continue;
      final id = mapped['id']?.toString() ?? '';
      if (id.isEmpty || !seen.add(id)) continue;
      songs.add(mapped);
    }
    return _attachCoverUrls(songs);
  }

  /// Resolve missing covers via CDN hints or types=pic (bounded concurrency).
  Future<List<Map<String, dynamic>>> _attachCoverUrls(
    List<Map<String, dynamic>> songs,
  ) async {
    if (songs.isEmpty) return songs;
    return Future.wait(
      songs.map((song) async {
        final existing = song['coverUrl']?.toString().trim() ?? '';
        if (existing.isNotEmpty) return song;
        final source = song['gdstudioSource']?.toString() ?? '';
        final picId = song['pic_id']?.toString() ?? '';
        if (source.isEmpty || picId.isEmpty) return song;

        final hinted = coverUrlHint(source: source, picId: picId);
        if (hinted != null) {
          return {...song, 'coverUrl': hinted};
        }

        try {
          final url = await getPicUrl(
            source: source,
            picId: picId,
            size: 300,
          ).timeout(const Duration(seconds: 3));
          if (url != null && url.isNotEmpty) {
            return {...song, 'coverUrl': url};
          }
        } catch (_) {}
        return song;
      }),
    );
  }

  /// Map API search row → app song map. Returns null if unusable.
  static Map<String, dynamic>? mapSearchItem(Map<String, dynamic> raw) {
    final source = raw['source']?.toString().trim() ?? '';
    final urlId =
        (raw['url_id'] ?? raw['id'])?.toString().trim() ?? '';
    final name = raw['name']?.toString().trim() ?? '';
    if (source.isEmpty || urlId.isEmpty || name.isEmpty) return null;

    final artist = _artistText(raw['artist']);
    final album = raw['album']?.toString() ?? '';
    final lyricId = raw['lyric_id']?.toString() ?? urlId;
    final picId = raw['pic_id']?.toString() ?? '';
    final id = buildSongId(source: source, mediaId: urlId);
    final durationMs = _durationMsFromSearchRow(raw);
    final coverHint = coverUrlHint(source: source, picId: picId);

    return {
      'id': id,
      'title': name,
      'artist': artist,
      'album': album,
      'resultType': 'song',
      'source': source,
      'sourceLabel': 'GDStudio · $source',
      'metaSource': 'GDStudio',
      'playbackSource': source,
      'gdstudioSource': source,
      'url_id': urlId,
      'lyric_id': lyricId,
      'pic_id': picId,
      if (coverHint != null) 'coverUrl': coverHint,
      if (durationMs > 0) 'duration': durationMs,
      // Prefer streaming via UrlSource (usually no custom headers).
      'preferDirectUrl': true,
    };
  }

  /// Best-effort cover without an extra HTTP hop (source-specific CDN).
  static String? coverUrlHint({
    required String source,
    required String picId,
  }) {
    final id = picId.trim();
    if (id.isEmpty) return null;
    if (id.startsWith('http://') || id.startsWith('https://')) return id;

    switch (source) {
      case 'joox':
        return 'https://image.joox.com/JOOXcover/0/$id/300';
      case 'kuwo':
        // pic_id is often like "120/79/49/xxx.jpg"
        return 'https://img1.kwcdn.kuwo.cn/star/albumcover/$id';
      case 'bilibili':
        return id.startsWith('//') ? 'https:$id' : null;
      default:
        return null;
    }
  }

  /// Search rows rarely include duration; read common optional fields if present.
  static int _durationMsFromSearchRow(Map<String, dynamic> raw) {
    final extra = raw['extra_data'];
    final candidates = <Object?>[
      raw['duration'],
      raw['dt'],
      raw['time'],
      if (extra is Map) extra['duration'],
      if (extra is Map) extra['dt'],
    ];
    for (final value in candidates) {
      final ms = _coerceDurationMs(value);
      if (ms > 0) return ms;
    }
    return 0;
  }

  static int _coerceDurationMs(Object? value) {
    if (value == null) return 0;
    if (value is int) {
      // Heuristic: values under 10000 are seconds.
      return value > 10000 ? value : value * 1000;
    }
    if (value is double) {
      final n = value.round();
      return n > 10000 ? n : n * 1000;
    }
    final text = value.toString().trim();
    if (text.isEmpty) return 0;
    final asInt = int.tryParse(text);
    if (asInt != null) return asInt > 10000 ? asInt : asInt * 1000;
    final parts = text.split(':');
    if (parts.length == 2) {
      final m = int.tryParse(parts[0]) ?? 0;
      final s = int.tryParse(parts[1]) ?? 0;
      return (m * 60 + s) * 1000;
    }
    if (parts.length == 3) {
      final h = int.tryParse(parts[0]) ?? 0;
      final m = int.tryParse(parts[1]) ?? 0;
      final s = int.tryParse(parts[2]) ?? 0;
      return ((h * 3600) + (m * 60) + s) * 1000;
    }
    return 0;
  }

  static String _artistText(Object? raw) {
    if (raw is List) {
      return raw
          .map((e) => e?.toString().trim() ?? '')
          .where((e) => e.isNotEmpty)
          .join(' / ');
    }
    return raw?.toString().trim() ?? '';
  }

  /// Resolve a playable URL for a `gdstudio:` song id.
  ///
  /// Lyrics are not fetched here (async via Hybrid.getLyrics) so play can
  /// start as soon as a stream URL is available.
  Future<PlaybackUrl> getPlayUrl(String songId) async {
    final parsed = parseSongId(songId);
    if (parsed == null) {
      throw StateError('invalid gdstudio id: $songId');
    }
    final (source, mediaId) = parsed;

    String? url;
    // Mid quality first — often succeeds faster than probing 320 then failing.
    for (final br in const [192, 128, 320, 999]) {
      try {
        final hit = await _fetchUrl(source: source, mediaId: mediaId, br: br)
            .timeout(urlAttemptTimeout);
        if (hit != null && hit.isNotEmpty) {
          url = hit;
          break;
        }
      } catch (e) {
        print('[GdStudio] url br=$br failed: $e');
      }
    }
    if (url == null || url.isEmpty) {
      throw StateError('GDStudio 未返回播放地址 ($source:$mediaId)');
    }

    // Relative paths are rare; normalize if needed.
    final absolute = url.startsWith('http')
        ? url
        : 'https://music.gdstudio.xyz/${url.replaceFirst(RegExp(r'^/'), '')}';

    return PlaybackUrl(
      absolute,
      headers: const {},
      lyrics: '',
      resolvedId: songId,
    );
  }

  Future<String?> _fetchUrl({
    required String source,
    required String mediaId,
    required int br,
  }) async {
    final response = await _dio.get<dynamic>(
      baseUrl,
      queryParameters: {
        'types': 'url',
        'source': source,
        'id': mediaId,
        'br': br,
      },
    );
    final data = response.data;
    if (data is! Map) return null;
    final url = data['url']?.toString().trim() ?? '';
    final brField = data['br'];
    if (url.isEmpty) return null;
    if (brField == -1 || brField == '-1') return null;
    return url;
  }

  Future<String> getLyric({
    required String source,
    required String lyricId,
  }) async {
    final response = await _dio.get<dynamic>(
      baseUrl,
      queryParameters: {
        'types': 'lyric',
        'source': source,
        'id': lyricId,
      },
    );
    final data = response.data;
    if (data is! Map) return '';
    final lyric = data['lyric']?.toString().trim() ?? '';
    if (lyric.isEmpty ||
        lyric == 'NULL' ||
        lyric == 'null' ||
        lyric.contains('歌词获取失败')) {
      return '';
    }
    return lyric;
  }

  /// `types=pic` → `{ "url": "https://..." }`
  Future<String?> getPicUrl({
    required String source,
    required String picId,
    int size = 300,
  }) async {
    final id = picId.trim();
    if (source.trim().isEmpty || id.isEmpty) return null;
    final response = await _dio.get<dynamic>(
      baseUrl,
      queryParameters: {
        'types': 'pic',
        'source': source,
        'id': id,
        'size': size,
      },
    );
    final data = response.data;
    if (data is! Map) return null;
    final url = data['url']?.toString().trim() ?? '';
    if (url.isEmpty) return null;
    if (url.startsWith('//')) return 'https:$url';
    return url;
  }
}
