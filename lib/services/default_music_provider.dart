import 'package:dio/dio.dart';
import 'music_provider.dart';

/// Default music provider - provides metadata and playback from Karpov Gateway API
///
/// This provider accesses QQMusic and other sources through a proxy gateway.
class DefaultMusicProvider implements MusicProvider {
  DefaultMusicProvider({
    Dio? dio,
    String source = defaultSource,
    String apiBaseUrl = apiUrl,
  })  : _source = source,
        _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: apiBaseUrl,
                connectTimeout: const Duration(seconds: 15),
                receiveTimeout: const Duration(seconds: 15),
              ),
            );

  static const apiUrl = 'https://gateway.karpov.cn/api/proxy';
  static const defaultSource = 'qqmusic';
  static const defaultQuality = 'MP3_320';
  static const defaultRecommendationQuery = '热门';
  static const defaultHotPlaylistIds = ['8037641642', '7461724680'];

  final Dio _dio;
  final String _source;

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query) async {
    final keywords = query.trim();
    if (keywords.isEmpty) return [];

    final response = await _dio.get<dynamic>(
      '/$_source/search/songs',
      queryParameters: {
        'q': keywords,
        'page': 1,
        'page_size': 30,
      },
    );

    return _parseSearchSongs(response.data);
  }

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() {
    return searchSongs(defaultRecommendationQuery);
  }

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({int? limit, int? offset}) async {
    // Return empty to let HybridMusicProvider fallback to BilibiliMusicProvider
    // which has proper pagination support
    return [];
  }

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) async {
    final response = await _dio.get<dynamic>('/$_source/playlists/$id');
    return _parsePlaylist(_parseApiResponse(response.data)['data']);
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) async {
    final response = await _dio.get<dynamic>('/$_source/songs/$id');
    return _parseSong(_parseApiResponse(response.data)['data']);
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) async {
    final response = await _dio.get<dynamic>(
      '/$_source/songs/$id/url',
      queryParameters: {'quality': defaultQuality},
    );
    return PlaybackUrl(_parsePlayUrl(_parseApiResponse(response.data)));
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

  static Map<String, dynamic> _parseApiResponse(Object? data) {
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    throw const FormatException('接口返回了非 JSON 内容');
  }

  static List<Map<String, dynamic>> _parseSearchSongs(Object? data) {
    final json = _parseApiResponse(data);
    final envelopeData = _mapValue(json['data']);
    final items = envelopeData?['items'];
    if (items is! List) return [];
    return items.whereType<Map>().map(_parseSong).toList();
  }

  static Map<String, dynamic> _parseSong(Object? data) {
    final song = _mapValue(data) ?? const {};
    final album = _mapValue(song['album']);
    final artists = _listValue(song['artists']) ?? const [];
    final artistNames = artists
        .whereType<Map>()
        .map((artist) => artist['name']?.toString())
        .whereType<String>()
        .where((name) => name.isNotEmpty)
        .join(' / ');

    return {
      'id': song['id']?.toString() ?? '',
      'source': song['provider']?.toString() ?? defaultSource,
      'title': song['title']?.toString() ?? '未知歌曲',
      'artist': artistNames.isEmpty
          ? song['artist']?.toString() ?? '未知艺人'
          : artistNames,
      'album': album?['name']?.toString() ??
          album?['title']?.toString() ??
          song['album']?.toString() ??
          '',
      'duration': song['duration'] ?? song['durationSeconds'] ?? 0,
      'coverUrl': song['cover']?.toString() ??
          album?['picUrl']?.toString() ??
          album?['cover']?.toString() ??
          '',
      'lyrics': song['lyrics']?.toString() ?? song['lyric']?.toString() ?? '',
    };
  }

  static Map<String, dynamic> _parsePlaylist(Object? data) {
    final playlist = _mapValue(data) ?? const {};
    final creator = _mapValue(playlist['creator']);
    final songs = _listValue(playlist['songs']) ?? const [];
    final songCount = _intValue(playlist['songCount']);
    final playCount = _intValue(playlist['playCount']);
    final creatorName = creator?['nickname']?.toString() ?? '';
    final detailParts = [
      if (songCount > 0) '$songCount 首歌曲',
      if (playCount > 0) '${_compactCount(playCount)} 次播放',
      if (creatorName.isNotEmpty) creatorName,
    ];

    return {
      'id': playlist['id']?.toString() ?? '',
      'source': playlist['provider']?.toString() ?? defaultSource,
      'title': playlist['title']?.toString() ??
          playlist['name']?.toString() ??
          '未知歌单',
      'subtitle': detailParts.join(' • '),
      'coverUrl': playlist['cover']?.toString() ??
          playlist['picUrl']?.toString() ??
          playlist['coverUrl']?.toString() ??
          '',
      'songCount': songCount,
      'playCount': playCount,
      'songs': songs.whereType<Map>().map(_parseSong).toList(),
    };
  }

  static String _parsePlayUrl(Map<String, dynamic> json) {
    final data = _mapValue(json['data']);
    final audio = _mapValue(data?['audio']);
    final url = audio?['url']?.toString();
    if (url == null || url.isEmpty) {
      throw StateError(json['message']?.toString() ?? '未获取到播放地址');
    }
    return url;
  }

  static Map<String, dynamic>? _mapValue(Object? value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return value.cast<String, dynamic>();
    return null;
  }

  static List<dynamic>? _listValue(Object? value) {
    if (value is List) return value;
    return null;
  }

  static int _intValue(Object? value) {
    if (value is int) return value;
    if (value is num) return value.round();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  static String _compactCount(int value) {
    if (value >= 10000) {
      final count = value / 10000;
      final text =
          count >= 100 ? count.round().toString() : count.toStringAsFixed(1);
      return '${text.replaceAll(RegExp(r'\.0$'), '')}万';
    }
    return value.toString();
  }
}
