import 'package:dio/dio.dart';
import 'music_provider.dart';

/// Meting music provider - provides metadata and lyrics from meting API
///
/// This is a metadata-only provider. It searches and provides song details
/// but does not provide playback URLs (throws UnsupportedError).
class MetingMusicProvider implements MusicProvider {
  MetingMusicProvider({
    Dio? dio,
    String apiBaseUrl = 'http://60.205.218.90:8787/api',
    String? Function()? tokenProvider,
  })  : _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: apiBaseUrl,
                connectTimeout: const Duration(seconds: 10),
                receiveTimeout: const Duration(seconds: 10),
              ),
            ),
        _tokenProvider = tokenProvider,
       _artistTitles = {};

  final Dio _dio;
  final String? Function()? _tokenProvider;
  final Map<String, String> _artistTitles;

  Options? _requestOptions() {
    final token = _tokenProvider?.call()?.trim() ?? '';
    if (token.isEmpty) return null;
    return Options(headers: {'Authorization': 'Bearer $token'});
  }

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<List<Map<String, dynamic>>> searchSongs(
    String query, {
    int page = 1,
  }) async {
    final keywords = query.trim();
    if (keywords.isEmpty) return [];
    // Upstream meting search has no stable paging; only page 1 is useful.
    if (page > 1) return const [];

    // Search tencent first
    final tencent = await _searchVendor('tencent', keywords);
    if (tencent.isEmpty) return _searchVendor('kugou', keywords);
    if (tencent.any(_isArtistResult)) return tencent;

    // If no artist in tencent, try kugou
    final kugou = await _searchVendor('kugou', keywords);
    final kugouArtists = kugou.where(_isArtistResult).toList();
    if (kugouArtists.isEmpty) {
      return tencent;
    }
    // Put kugou artists first, then tencent songs
    return [...kugouArtists, ...tencent];
  }

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() {
    return searchSongs('热门音乐');
  }

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async {
    return const [];
  }

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) async {
    final parsed = _parseMetingCollectionId(id);
    if (parsed.kind != 'artist') {
      throw UnsupportedError('Meting provider does not expose playlists');
    }
    final artistTitle = _artistTitles[id]?.trim() ?? '';
    final queryParameters = <String, dynamic>{
      if (artistTitle.isNotEmpty) 'name': artistTitle,
      if (limit != null) 'limit': limit,
    };
    final response = await _dio.get<Map<String, dynamic>>(
      '/music/artists/${parsed.vendor}/${Uri.encodeComponent(parsed.rawId)}',
      queryParameters: queryParameters.isEmpty ? null : queryParameters,
      options: _requestOptions(),
    );
    final collection = _mapValue(response.data?['data']) ?? const {};
    final songs = collection['songs'];
    if (songs is List) {
      collection['songs'] = songs
          .whereType<Map>()
          .map((item) => _withCoverUrl(item.cast<String, dynamic>()))
          .toList();
    }
    return collection;
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) async {
    final parsed = _parseMetingId(id);
    final response = await _dio.get<Map<String, dynamic>>(
      '/music/songs/${parsed.vendor}/${Uri.encodeComponent(parsed.rawId)}',
      options: _requestOptions(),
    );
    final detail = _mapValue(response.data?['data']) ?? const {};
    return _withCoverUrl(detail);
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) async {
    throw UnsupportedError('Meting provider is metadata-only');
  }

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async {
    final existing = song['lyrics']?.toString().trim() ?? '';
    if (existing.isNotEmpty) return existing;
    final id = song['id']?.toString() ?? '';
    if (id.isEmpty) return '';
    final detail = await getSongDetail(id);
    return detail['lyrics']?.toString().trim() ?? '';
  }

  Future<List<Map<String, dynamic>>> _searchVendor(
    String vendor,
    String query,
  ) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/music/search',
        queryParameters: {'vendor': vendor, 'q': query},
        options: _requestOptions(),
      );
      final data = _mapValue(response.data?['data']);
      final items = data?['items'];
      if (items is! List) return const [];
      final results = items
          .whereType<Map>()
          .map((item) => _withCoverUrl(item.cast<String, dynamic>()))
          .toList();
      // Remember artist titles for later playlist queries
      for (final item in results.where(_isArtistResult)) {
        final id = item['id']?.toString() ?? '';
        final title = item['title']?.toString().trim() ?? '';
        if (id.isNotEmpty && title.isNotEmpty) _artistTitles[id] = title;
      }
      return results;
    } catch (_) {
      return const [];
    }
  }

  static _MetingId _parseMetingId(String id) {
    final parts = id.split(':');
    if (parts.length < 3 || parts.first != 'meting') {
      throw ArgumentError.value(id, 'id', 'Expected meting:{vendor}:{id}');
    }
    return _MetingId(parts[1], parts.sublist(2).join(':'));
  }

  static _MetingCollectionId _parseMetingCollectionId(String id) {
    final parts = id.split(':');
    if (parts.length < 3 || !parts.first.startsWith('meting-')) {
      throw ArgumentError.value(
        id,
        'id',
        'Expected meting-artist:{vendor}:{id}',
      );
    }
    return _MetingCollectionId(
      parts.first.substring('meting-'.length),
      parts[1],
      parts.sublist(2).join(':'),
    );
  }

  static Map<String, dynamic>? _mapValue(Object? value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return value.cast<String, dynamic>();
    return null;
  }

  /// Normalize meting cover fields (`picUrl` / `pic` / `pic_id`) to
  /// `coverUrl`. Bare ids become vendor CDN urls; full urls pass through
  /// (http:// upgraded to https://). No pic → item unchanged (placeholder).
  static Map<String, dynamic> _withCoverUrl(Map<String, dynamic> item) {
    final existing = item['coverUrl']?.toString().trim() ?? '';
    if (existing.isNotEmpty) return item;

    final vendor =
        item['source']?.toString().trim() ??
        _vendorFromId(item['id']?.toString() ?? '');
    final raw =
        item['picUrl']?.toString().trim() ??
        item['pic']?.toString().trim() ??
        item['pic_id']?.toString().trim() ??
        '';
    if (raw.isEmpty) return item;

    final cover = raw.startsWith('http')
        ? (raw.startsWith('http://') ? 'https://${raw.substring(7)}' : raw)
        : _vendorCoverUrl(vendor, raw);
    if (cover.isEmpty) return item;
    return {...item, 'coverUrl': cover};
  }

  static String _vendorFromId(String id) {
    // meting:{vendor}:{rawId}
    final parts = id.split(':');
    if (parts.length < 2 || parts.first != 'meting') return '';
    return parts[1];
  }

  static String _vendorCoverUrl(String vendor, String picId) {
    switch (vendor) {
      case 'tencent':
        return 'https://y.gtimg.cn/music/photo_new/T002R300x300M000$picId.jpg';
      case 'netease':
        return 'https://p2.music.126.net/$picId.jpg';
      case 'kuwo':
        return 'https://img1.kwcdn.kuwo.cn/star/albumcover/$picId';
      case 'kugou':
        return 'https://imgessl.kugou.com/cover/480/$picId.jpg';
      default:
        return '';
    }
  }

  static bool _isArtistResult(Map<String, dynamic> item) {
    return item['resultType']?.toString() == 'artist';
  }
}

class _MetingId {
  const _MetingId(this.vendor, this.rawId);

  final String vendor;
  final String rawId;
}

class _MetingCollectionId {
  const _MetingCollectionId(this.kind, this.vendor, this.rawId);

  final String kind;
  final String vendor;
  final String rawId;
}
