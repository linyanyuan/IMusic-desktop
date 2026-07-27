import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/services/bilibili_music_provider.dart';
import 'package:deepvibe_desktop/services/music_provider.dart';

void main() {
  test('hot playlists page is based on the requested page size', () async {
    final adapter = _JsonAdapter((options) {
      return {
        'data': {
          'result': [
            {
              'bvid': 'BVpage2',
              'title': '音乐合集第二页',
              'author': '音乐UP',
              'pic': '//i0.hdslb.com/cover.jpg',
            },
          ],
        },
      };
    });
    final provider = BilibiliMusicProvider(dio: _dio(adapter));

    await provider.getHotPlaylists(limit: 6, offset: 6);

    expect(adapter.requests.single.queryParameters['page'], 2);
  });

  test('Bilibili collection search results are marked as playlists', () async {
    final adapter = _JsonAdapter((options) {
      return {
        'data': {
          'result': [
            {
              'bvid': 'BVcollection',
              'title': '<em>华语热歌</em>合集《可能》《一路生花》',
              'author': '音乐UP',
              'duration': '45:00',
              'pic': '//i0.hdslb.com/cover.jpg',
            },
          ],
        },
      };
    });
    final provider = BilibiliMusicProvider(dio: _dio(adapter));

    final results = await provider.searchSongs('华语热歌合集');

    expect(results.single['resultType'], 'playlist');
  });

  test(
    'playlist songs use mobile-compatible p-page ids and cid metadata',
    () async {
      final adapter = _JsonAdapter((options) {
        return switch (options.path) {
          '/x/web-interface/view' => {
            'data': {
              'title': '合集标题',
              'owner': {'name': '音乐UP'},
              'pic': '//i0.hdslb.com/cover.jpg',
            },
          },
          '/x/player/pagelist' => {
            'data': [
              {'page': 1, 'cid': 111, 'part': '第一首', 'duration': 180},
              {'page': 2, 'cid': 222, 'part': '第二首', 'duration': 210},
            ],
          },
          _ => <String, dynamic>{},
        };
      });
      final provider = BilibiliMusicProvider(dio: _dio(adapter));

      final playlist = await provider.getPlaylist('bilibili:BVcollection');
      final songs = playlist['songs'] as List;

      expect(songs.first['id'], 'bilibili:BVcollection:p1');
      expect(songs.first['playbackId'], 'bilibili:BVcollection:p1');
      expect(songs.first['sourceId'], 'bilibili:BVcollection:p1');
      expect(songs.first['playbackSourceId'], 'bilibili:BVcollection:p1');
      expect(songs.first['bvid'], 'BVcollection');
      expect(songs.first['page'], 1);
      expect(songs.first['cid'], '111');
      expect(
        songs.first['pageUrl'],
        'https://www.bilibili.com/video/BVcollection?p=1',
      );
    },
  );

  test('recommendations fall back when the gateway does not return', () async {
    final fallbackAdapter = _JsonAdapter((options) {
      return {
        'data': {
          'result': [
            {
              'bvid': 'BVfallback',
              'title': '热门音乐',
              'author': '音乐UP',
              'duration': '03:30',
              'pic': '//i0.hdslb.com/cover.jpg',
            },
          ],
        },
      };
    });
    final provider = BilibiliMusicProvider(
      dio: _dio(fallbackAdapter),
      gatewayDio: _dio(_NeverCompletingAdapter()),
      recommendationTimeout: const Duration(milliseconds: 20),
    );

    final results = await provider.getRecommendedSongs();

    expect(results.single['id'], 'bilibili:BVfallback');
    expect(fallbackAdapter.requests.single.path, contains('/search/type'));
  });

  test('play URL resolution does not wait for subtitles', () async {
    final adapter = _JsonAdapter((options) {
      return switch (options.path) {
        '/x/player/pagelist' => {
          'data': [
            {'page': 1, 'cid': 111},
          ],
        },
        '/x/player/playurl' => {
          'data': {
            'dash': {
              'audio': [
                {
                  'bandwidth': 128000,
                  'baseUrl': 'https://example.test/audio.m4s',
                },
              ],
            },
          },
        },
        _ => <String, dynamic>{},
      };
    });
    final provider = BilibiliMusicProvider(dio: _dio(adapter));

    final playUrl = await provider.getPlayUrl('bilibili:BVfast:p1');

    expect(playUrl, isA<PlaybackUrl>());
    expect(playUrl.lyrics, isEmpty);
    expect(adapter.requests.map((request) => request.path), [
      '/x/player/pagelist',
      '/x/player/playurl',
    ]);
  });

  test('lyrics reuse the CID resolved for playback', () async {
    final adapter = _JsonAdapter((options) {
      return switch (options.path) {
        '/x/player/pagelist' => {
          'data': [
            {'page': 1, 'cid': 111},
          ],
        },
        '/x/player/playurl' => {
          'data': {
            'durl': [
              {'url': 'https://example.test/audio.m4s'},
            ],
          },
        },
        '/x/player/v2' => {
          'data': {
            'subtitle': {
              'subtitles': [
                {'subtitle_url': 'https://example.test/subtitle.json'},
              ],
            },
          },
        },
        _ => <String, dynamic>{},
      };
    });
    final subtitleAdapter = _JsonAdapter((options) {
      return {
        'body': [
          {'content': '第一句'},
          {'content': '第二句'},
        ],
      };
    });
    final provider = BilibiliMusicProvider(
      dio: _dio(adapter),
      subtitleDio: _dio(subtitleAdapter),
    );

    await provider.getPlayUrl('bilibili:BVfast:p1');
    final lyrics = await provider.getLyrics(const {'id': 'bilibili:BVfast:p1'});

    expect(lyrics, '第一句\n第二句');
    expect(
      adapter.requests.where((request) => request.path == '/x/player/pagelist'),
      hasLength(1),
    );
    expect(
      adapter.requests.map((request) => request.path),
      containsAllInOrder([
        '/x/player/pagelist',
        '/x/player/playurl',
        '/x/player/v2',
      ]),
    );
  });
}

Dio _dio(HttpClientAdapter adapter) {
  final dio = Dio(BaseOptions(baseUrl: 'https://api.bilibili.com'));
  dio.httpClientAdapter = adapter;
  return dio;
}

class _JsonAdapter implements HttpClientAdapter {
  _JsonAdapter(this.responseFor);

  final Map<String, dynamic> Function(RequestOptions options) responseFor;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return ResponseBody.fromString(
      jsonEncode(responseFor(options)),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _NeverCompletingAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    return Completer<ResponseBody>().future;
  }

  @override
  void close({bool force = false}) {}
}
