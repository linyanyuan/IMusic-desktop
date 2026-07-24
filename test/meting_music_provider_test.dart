import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/services/meting_music_provider.dart';

void main() {
  test('music search sends Bearer token from tokenProvider', () async {
    final adapter = _JsonAdapter((options) {
      return {
        'data': {
          'items': [
            {
              'id': 'meting:tencent:1',
              'title': '晴天',
              'artist': '周杰伦',
              'resultType': 'song',
            },
          ],
        },
      };
    });
    final provider = MetingMusicProvider(
      dio: _dio(adapter),
      tokenProvider: () => 'test-token-abc',
    );

    final results = await provider.searchSongs('晴天');

    expect(results, isNotEmpty);
    expect(
      adapter.requests.single.headers['Authorization'],
      'Bearer test-token-abc',
    );
    expect(adapter.requests.single.path, '/music/search');
  });

  test('song detail and artist playlist send Bearer token', () async {
    final adapter = _JsonAdapter((options) {
      if (options.path.contains('/music/songs/')) {
        return {
          'data': {
            'id': 'meting:tencent:1',
            'title': '晴天',
            'lyrics': '[00:00.00]test',
          },
        };
      }
      return {
        'data': {
          'id': 'meting-artist:tencent:a1',
          'title': '周杰伦',
          'songs': <Map<String, dynamic>>[],
        },
      };
    });
    final provider = MetingMusicProvider(
      dio: _dio(adapter),
      tokenProvider: () => 'tok-xyz',
    );

    await provider.getSongDetail('meting:tencent:1');
    await provider.getPlaylist('meting-artist:tencent:a1');

    expect(adapter.requests, hasLength(2));
    for (final request in adapter.requests) {
      expect(request.headers['Authorization'], 'Bearer tok-xyz');
    }
  });

  test('omits Authorization when token is empty', () async {
    final adapter = _JsonAdapter((options) {
      return {
        'data': {'items': <Map<String, dynamic>>[]},
      };
    });
    final provider = MetingMusicProvider(
      dio: _dio(adapter),
      tokenProvider: () => '   ',
    );

    await provider.searchSongs('test');

    expect(adapter.requests.single.headers.containsKey('Authorization'), isFalse);
  });
}

Dio _dio(HttpClientAdapter adapter) {
  final dio = Dio(BaseOptions(baseUrl: 'http://example.test/api'));
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
