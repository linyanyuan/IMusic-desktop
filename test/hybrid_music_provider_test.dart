import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/services/gdstudio_music_client.dart';
import 'package:deepvibe_desktop/services/hybrid_music_provider.dart';
import 'package:deepvibe_desktop/services/music_provider.dart';

void main() {
  test(
    'Hybrid provider combines lyrics for quoted Bilibili collections',
    () async {
      final metadata = _MetadataProvider(
        searchResults: const {
          '可能': [
            {
              'id': 'meting:maybe',
              'title': '可能',
              'artist': '程响',
              'duration': 180000,
            },
          ],
          '一路生花': [
            {
              'id': 'meting:flower',
              'title': '一路生花',
              'artist': '温奕心',
              'duration': 180000,
            },
          ],
        },
        details: const {
          'meting:maybe': {
            'id': 'meting:maybe',
            'title': '可能',
            'artist': '程响',
            'lyrics': '[00:00.00]可能第一句',
          },
          'meting:flower': {
            'id': 'meting:flower',
            'title': '一路生花',
            'artist': '温奕心',
            'lyrics': '[00:00.00]一路第一句',
          },
        },
      );
      final provider = HybridMusicProvider(
        metadata: metadata,
        playback: const _UnusedProvider(),
      );

      final lyrics = await provider.getLyrics(const {
        'id': 'bilibili:BVcollection:1',
        'title': '《可能》《一路生花》',
        'artist': '音乐UP',
        'duration': 360000,
      });

      expect(lyrics, contains('[00:00.00]可能第一句'));
      expect(lyrics, contains('[03:00.00]一路第一句'));
    },
  );

  test('Hybrid provider preserves direct Bilibili subtitle lyrics', () async {
    final provider = HybridMusicProvider(
      metadata: const _UnusedProvider(),
      playback: const _PlaybackProviderWithLyrics(),
    );

    final playUrl = await provider.getPlayUrl('bilibili:BVwithcc:1');

    expect(playUrl.lyrics, '[00:00.00]B站字幕歌词');
  });

  test('Hybrid lyrics prefer direct Bilibili CC subtitles', () async {
    final provider = HybridMusicProvider(
      metadata: const _UnusedProvider(),
      playback: const _PlaybackProviderWithLyrics(),
    );

    final lyrics = await provider.getLyrics(const {
      'id': 'bilibili:BVwithcc:p1',
      'title': '带字幕的视频',
    });

    expect(lyrics, '[00:00.00]B站字幕歌词');
  });

  test('searchMetadataSongs returns only metadata songs', () async {
    final provider = HybridMusicProvider(
      metadata: const _MetadataProvider(
        searchResults: {
          '热歌': [
            {
              'id': 'meting:tencent:1',
              'title': '热歌A',
              'artist': '歌手A',
              'resultType': 'song',
            },
            {
              'id': 'meting:tencent:artist1',
              'title': '某歌手',
              'resultType': 'artist',
            },
            {
              'id': 'meting-playlist:tencent:p1',
              'title': '元数据歌单',
              'resultType': 'playlist',
            },
          ],
        },
        details: {},
      ),
      playback: const _ScopedPlaybackProvider(
        results: {
          '热歌': [
            {'id': 'bilibili:BVxxx', 'title': 'B站视频', 'resultType': 'song'},
          ],
        },
      ),
      // Force metadata path (no live GDStudio network in unit tests).
      gdStudio: _emptyGdStudioClient(),
    );

    final results = await provider.searchMetadataSongs('热歌');

    expect(results, hasLength(1));
    expect(results.single['id'], 'meting:tencent:1');
    expect(results.single['playbackSource'], 'bilibili');
  });

  test('searchBilibiliPlaylists returns only bilibili playlists', () async {
    final provider = HybridMusicProvider(
      metadata: const _MetadataProvider(
        searchResults: {
          '华语': [
            {'id': 'meting:tencent:1', 'title': '元数据歌曲', 'resultType': 'song'},
          ],
        },
        details: {},
      ),
      playback: const _ScopedPlaybackProvider(
        results: {
          '华语': [
            {'id': 'bilibili:BVsong', 'title': 'B站单曲', 'resultType': 'song'},
            {
              'id': 'bilibili:BVpl',
              'title': '华语合集',
              'resultType': 'playlist',
              'sourceLabel': 'B站',
            },
          ],
          '华语 歌单': [
            {
              'id': 'bilibili:BVpl2',
              'title': '华语歌单2',
              'resultType': 'playlist',
              'sourceLabel': 'B站',
            },
          ],
        },
      ),
    );

    final results = await provider.searchBilibiliPlaylists('华语');

    expect(results.map((item) => item['id']), [
      'bilibili:BVpl',
      'bilibili:BVpl2',
    ]);
    expect(results.every((item) => item['resultType'] == 'playlist'), isTrue);
  });

  test('searchMetadataSongs prefers GDStudio when available', () async {
    final dio = Dio();
    dio.httpClientAdapter = _SingleResponseAdapter(
      ResponseBody.fromString(
        '[{"id":"9","name":"Hit","artist":["Band"],"album":"","url_id":"9","lyric_id":"9","source":"joox"}]',
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      ),
    );
    final metadata = _ThrowOnSearchMetadataProvider();
    final provider = HybridMusicProvider(
      metadata: metadata,
      playback: const _UnusedProvider(),
      gdStudio: GdStudioMusicClient(dio: dio, sources: const ['joox']),
    );

    final songs = await provider.searchMetadataSongs('AOA');
    expect(songs.single['id'], 'gdstudio:joox:9');
    expect(metadata.searchCalls, 0);
  });

  test('searchMetadataSongs falls back to metadata when GDStudio empty', () async {
    final dio = Dio();
    dio.httpClientAdapter = _SingleResponseAdapter(
      ResponseBody.fromString(
        '[]',
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      ),
    );
    final metadata = const _MetadataProvider(
      searchResults: {
        'AOA': [
          {
            'id': 'meting:tencent:1',
            'title': 'Fallback',
            'artist': 'X',
            'resultType': 'song',
          },
        ],
      },
      details: {},
    );
    final provider = HybridMusicProvider(
      metadata: metadata,
      playback: const _UnusedProvider(),
      gdStudio: GdStudioMusicClient(dio: dio, sources: const ['joox']),
    );

    final songs = await provider.searchMetadataSongs('AOA');
    expect(songs.single['id'], 'meting:tencent:1');
    expect(songs.single['playbackSource'], 'bilibili');
  });

  test(
    'title-only search cache still fetches song detail before Bilibili search',
    () async {
      final metadata = _CountingMetadataProvider();
      final playback = _ResolvingPlaybackProvider();
      final provider = HybridMusicProvider(
        metadata: metadata,
        playback: playback,
      );
      provider.rememberSongs(const [
        {
          'id': 'meting:tencent:cached-song',
          'title': '缓存歌曲',
          'artist': '缓存歌手',
          'resultType': 'song',
        },
      ]);

      final playUrl = await provider.getPlayUrl('meting:tencent:cached-song');

      expect(metadata.detailCalls, 1);
      expect(playback.searchQueries, ['缓存歌手 缓存歌曲']);
      expect(playUrl.resolvedId, 'bilibili:BVcached:p1');
    },
  );

  test(
    'detail playbackId skips Bilibili candidate search',
    () async {
      final metadata = _MetadataProvider(
        searchResults: const {},
        details: const {
          'meting:tencent:detail-song': {
            'id': 'meting:tencent:detail-song',
            'title': '详情歌曲',
            'artist': '详情歌手',
            'playbackId': 'bilibili:BVdetail:p1',
            'lyrics': '[00:00.00]detail',
          },
        },
      );
      final playback = _ResolvingPlaybackProvider();
      final provider = HybridMusicProvider(
        metadata: metadata,
        playback: playback,
      );

      final playUrl = await provider.getPlayUrl('meting:tencent:detail-song');

      expect(playback.searchQueries, isEmpty);
      expect(playUrl.resolvedId, 'bilibili:BVdetail:p1');
      expect(playUrl.lyrics, '[00:00.00]detail');
    },
  );

  test('bestBilibiliMatch hard-excludes instrumental candidates', () {
    final best = HybridMusicProvider.bestBilibiliMatch(
      const {'title': '平凡之路', 'artist': '朴树', 'duration': 240000},
      const [
        {
          'id': 'bilibili:BVinstru',
          'title': '平凡之路 伴奏 off vocal',
          'artist': '朴树',
          'duration': 240000,
        },
        {
          'id': 'bilibili:BVofficial',
          'title': '平凡之路',
          'artist': '朴树',
          'duration': 240000,
        },
      ],
    );
    expect(best?['id'], 'bilibili:BVofficial');
  });

  test('bestBilibiliMatch returns null when only instrumental remains', () {
    final best = HybridMusicProvider.bestBilibiliMatch(
      const {'title': '平凡之路', 'artist': '朴树', 'duration': 240000},
      const [
        {
          'id': 'bilibili:BVinstru',
          'title': '平凡之路 instrumental',
          'artist': '朴树',
          'duration': 240000,
        },
      ],
    );
    expect(best, isNull);
  });

  test('instrumental target title allows instrumental candidates', () {
    final best = HybridMusicProvider.bestBilibiliMatch(
      const {'title': '夜的钢琴曲 纯音乐', 'artist': '石进', 'duration': 240000},
      const [
        {
          'id': 'bilibili:BVpiano',
          'title': '夜的钢琴曲 纯音乐',
          'artist': '石进',
          'duration': 240000,
        },
      ],
    );
    expect(best?['id'], 'bilibili:BVpiano');
  });

  test('soft-downgrade prefers official over live/cover at equal match', () {
    final best = HybridMusicProvider.bestBilibiliMatch(
      const {'title': '海阔天空', 'artist': 'Beyond', 'duration': 300000},
      const [
        {
          'id': 'bilibili:BVlive',
          'title': '海阔天空 live 现场',
          'artist': 'Beyond',
          'duration': 300000,
        },
        {
          'id': 'bilibili:BVofficial',
          'title': '海阔天空',
          'artist': 'Beyond',
          'duration': 300000,
        },
      ],
    );
    expect(best?['id'], 'bilibili:BVofficial');
  });

  test(
    'persistent playback metadata resolves an ID without loading audio',
    () async {
      final playback = _ResolvingPlaybackProvider();
      final provider = HybridMusicProvider(
        metadata: _CountingMetadataProvider(),
        playback: playback,
      );
      const song = {
        'id': 'meting:tencent:cached-song',
        'title': '缓存歌曲',
        'artist': '缓存歌手',
        'resultType': 'song',
      };
      provider.rememberSongs(const [song]);

      final playbackId = await provider.resolvePlaybackId(song);

      expect(playbackId, 'bilibili:BVcached:p1');
      expect(playback.searchQueries, ['缓存歌手 缓存歌曲']);
      expect(playback.playUrlCalls, 0);
    },
  );
}

class _CountingMetadataProvider implements MusicProvider {
  int detailCalls = 0;

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async => '';

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) async {
    detailCalls++;
    return {'id': id};
  }

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query, {int page = 1}) async =>
      const [];

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async => const [];

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async => const [];

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) {
    throw UnimplementedError();
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) {
    throw UnimplementedError();
  }
}

class _ResolvingPlaybackProvider implements MusicProvider {
  final searchQueries = <String>[];
  int playUrlCalls = 0;

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async => '';

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query, {int page = 1}) async {
    searchQueries.add(query);
    return const [
      {
        'id': 'bilibili:BVcached:p1',
        'title': '缓存歌曲',
        'artist': '缓存歌手',
        'resultType': 'song',
      },
    ];
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) async {
    playUrlCalls++;
    return PlaybackUrl('https://example.test/audio.m4s', resolvedId: id);
  }

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async => const [];

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async => const [];

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) {
    throw UnimplementedError();
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) {
    throw UnimplementedError();
  }
}

class _MetadataProvider implements MusicProvider {
  const _MetadataProvider({required this.searchResults, required this.details});

  final Map<String, List<Map<String, dynamic>>> searchResults;
  final Map<String, Map<String, dynamic>> details;

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async {
    return song['lyrics']?.toString() ?? '';
  }

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query, {int page = 1}) async {
    return searchResults[query] ?? const [];
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) async {
    return details[id] ?? {'id': id};
  }

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async => const [];

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async => const [];

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) {
    throw UnimplementedError();
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) {
    throw UnimplementedError();
  }
}

class _UnusedProvider implements MusicProvider {
  const _UnusedProvider();

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async => '';

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query, {int page = 1}) async =>
      const [];

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async => const [];

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async => const [];

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) {
    throw UnimplementedError();
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) {
    throw UnimplementedError();
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) {
    throw UnimplementedError();
  }
}

class _ThrowOnSearchMetadataProvider implements MusicProvider {
  int searchCalls = 0;

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async => '';

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query, {int page = 1}) async {
    searchCalls += 1;
    throw StateError('metadata search should not run when GDStudio hits');
  }

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async => const [];

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async => const [];

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) {
    throw UnimplementedError();
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) {
    throw UnimplementedError();
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) {
    throw UnimplementedError();
  }
}

class _SingleResponseAdapter implements HttpClientAdapter {
  _SingleResponseAdapter(this.body);

  final ResponseBody body;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return body;
  }
}

GdStudioMusicClient _emptyGdStudioClient() {
  final dio = Dio();
  dio.httpClientAdapter = _SingleResponseAdapter(
    ResponseBody.fromString(
      '[]',
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    ),
  );
  return GdStudioMusicClient(dio: dio, sources: const ['joox']);
}

class _PlaybackProviderWithLyrics implements MusicProvider {
  const _PlaybackProviderWithLyrics();

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async =>
      '[00:00.00]B站字幕歌词';

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query, {int page = 1}) async =>
      const [];

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async => const [];

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async => const [];

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) {
    throw UnimplementedError();
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) {
    throw UnimplementedError();
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) async {
    return const PlaybackUrl(
      'https://example.test/audio.m4s',
      lyrics: '[00:00.00]B站字幕歌词',
      resolvedId: 'bilibili:BVwithcc:1',
    );
  }
}

class _ScopedPlaybackProvider implements MusicProvider {
  const _ScopedPlaybackProvider({required this.results});

  final Map<String, List<Map<String, dynamic>>> results;

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async => '';

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query, {int page = 1}) async =>
      results[query] ?? const [];

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async => const [];

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async => const [];

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) {
    throw UnimplementedError();
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) {
    throw UnimplementedError();
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) {
    throw UnimplementedError();
  }
}
