import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/services/chksz_music_client.dart';

void main() {
  group('ChkszMusicClient id helpers', () {
    test('parses song ids with the chksz:163: prefix', () {
      expect(ChkszMusicClient.parseSongId('chksz:163:22813978'), '22813978');
      expect(ChkszMusicClient.buildSongId('22813978'), 'chksz:163:22813978');
      expect(ChkszMusicClient.isChkszId('chksz:163:22813978'), isTrue);
      expect(ChkszMusicClient.isChkszSongId('chksz:163:22813978'), isTrue);
    });

    test('parses playlist ids with the chksz:playlist: prefix', () {
      expect(
        ChkszMusicClient.parsePlaylistId('chksz:playlist:5202687076'),
        '5202687076',
      );
      expect(
        ChkszMusicClient.buildPlaylistId('5202687076'),
        'chksz:playlist:5202687076',
      );
      expect(ChkszMusicClient.isChkszPlaylistId('chksz:playlist:1'), isTrue);
    });

    test('rejects foreign or malformed ids', () {
      expect(ChkszMusicClient.parseSongId('bilibili:BV1:1'), isNull);
      expect(ChkszMusicClient.parseSongId('chksz:163:'), isNull);
      expect(ChkszMusicClient.parseSongId('chksz:playlist:1'), isNull);
      expect(ChkszMusicClient.parsePlaylistId('chksz:163:1'), isNull);
      expect(ChkszMusicClient.isChkszId('meting:tencent:1'), isFalse);
    });
  });

  group('ChkszMusicClient.mapSearchItem', () {
    test('maps NetEase row with ar/al maps to app song map', () {
      final mapped = ChkszMusicClient.mapSearchItem({
        'id': 22813978,
        'name': '晴天',
        'ar': [
          {'name': '周杰伦'},
        ],
        'al': {'name': '叶惠美', 'picUrl': 'http://p1.music.126.net/cover.jpg'},
        'dt': 269000,
      });

      expect(mapped?['id'], 'chksz:163:22813978');
      expect(mapped?['title'], '晴天');
      expect(mapped?['artist'], '周杰伦');
      expect(mapped?['album'], '叶惠美');
      // http:// cover is upgraded to https://
      expect(mapped?['coverUrl'], 'https://p1.music.126.net/cover.jpg');
      expect(mapped?['duration'], 269000);
      expect(mapped?['resultType'], 'song');
      expect(mapped?['sourceLabel'], 'ChKSz · 网易云');
    });

    test('maps artists as string list and missing duration', () {
      final mapped = ChkszMusicClient.mapSearchItem({
        'id': '1',
        'name': 'Song',
        'artists': ['A', 'B'],
        'album': {'name': 'Al'},
      });
      expect(mapped?['artist'], 'A / B');
      expect(mapped?['duration'], isNull);
    });

    test('reads top-level picUrl from search rows', () {
      final mapped = ChkszMusicClient.mapSearchItem({
        'id': '1315196858',
        'name': '海底',
        'artists': '一支榴莲',
        'album': '独',
        'picUrl': 'http://p1.music.126.net/cover.jpg',
      });
      expect(mapped?['artist'], '一支榴莲');
      expect(mapped?['coverUrl'], 'https://p1.music.126.net/cover.jpg');
    });

    test('drops incomplete rows', () {
      expect(ChkszMusicClient.mapSearchItem({'name': 'x'}), isNull);
      expect(ChkszMusicClient.mapSearchItem({'id': 1}), isNull);
    });
  });

  group('ChkszMusicClient api key', () {
    test('throws before any request when no key is configured', () async {
      final adapter = _CountingAdapter();
      final dio = Dio()..httpClientAdapter = adapter;
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => '');
      expect(
        () => client.searchSongs('周杰伦'),
        throwsA(isA<ChkszApiKeyMissingException>()),
      );
      expect(adapter.requests, 0);
    });

    test('prefers runtime provider key over env key', () async {
      final adapter = _CapturingAdapter([
        _jsonResponse('{"code":200,"data":{"songs":[],"total":0}}'),
      ]);
      final dio = Dio()..httpClientAdapter = adapter;
      final client = ChkszMusicClient(
        dio: dio,
        apiKeyProvider: () => 'runtime-key',
      );
      await client.searchSongs('周杰伦');
      expect(adapter.apiKeys, ['runtime-key']);
    });
  });

  group('ChkszMusicClient search', () {
    test('maps data.songs and dedupes by id', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        _jsonResponse('''
        {
          "code": 200,
          "data": {
            "total": 2,
            "songs": [
              {"id": 1, "name": "A", "ar": [{"name": "A1"}]},
              {"id": 1, "name": "A dup", "ar": [{"name": "A1"}]},
              {"id": 2, "name": "B", "ar": [{"name": "B1"}]}
            ]
          }
        }
        '''),
      ]);
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => 'k');
      final songs = await client.searchSongs('周杰伦');
      expect(songs, hasLength(2));
      expect(songs.map((s) => s['id']), ['chksz:163:1', 'chksz:163:2']);
    });

    test('accepts data as a raw array', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        _jsonResponse('''
        {
          "code": 200,
          "data": [
            {"id": 9, "name": "C", "ar": [{"name": "C1"}]}
          ]
        }
        '''),
      ]);
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => 'k');
      final songs = await client.searchSongs('周杰伦');
      expect(songs.single['id'], 'chksz:163:9');
    });

    test('page > 1 sends offset paging params', () async {
      final adapter = _CapturingAdapter([
        _jsonResponse('{"code":200,"data":[]}'),
        _jsonResponse('{"code":200,"data":[]}'),
        _jsonResponse('{"code":200,"data":[]}'),
      ]);
      final dio = Dio()..httpClientAdapter = adapter;
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => 'k');

      await client.searchSongs('周杰伦', page: 1);
      await client.searchSongs('周杰伦', page: 2);
      await client.searchSongs('周杰伦', page: 3);

      expect(adapter.requests, hasLength(3));
      final params = adapter.requests.map((r) => r.queryParameters);
      // Page 1: no offset; page 2/3 advance by the page size.
      expect(params.elementAt(0).containsKey('offset'), isFalse);
      expect(params.elementAt(0)['limit'], ChkszMusicClient.searchPageSize);
      expect(params.elementAt(1)['offset'], ChkszMusicClient.searchPageSize);
      expect(
        params.elementAt(2)['offset'],
        ChkszMusicClient.searchPageSize * 2,
      );
    });

    test('throws ChkszApiException on business error code', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        _jsonResponse('{"code":400,"msg":"参数错误"}'),
      ]);
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => 'k');
      expect(
        () => client.searchSongs('周杰伦'),
        throwsA(
          isA<ChkszApiException>().having(
            (e) => e.message,
            'message',
            contains('参数错误'),
          ),
        ),
      );
    });
  });

  group('ChkszMusicClient play url', () {
    test('falls back exhigh -> standard and normalizes https', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        _jsonResponse('{"code":200,"data":{"url":"","br":-1}}'),
        _jsonResponse(
          '{"code":200,"data":{"url":"http://m701.music.126.net/a.mp3","picUrl":"http://p1.music.126.net/c.jpg"}}',
        ),
      ]);
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => 'k');
      final play = await client.getPlayUrl('chksz:163:22813978');
      expect(play.url, 'https://m701.music.126.net/a.mp3');
      expect(play.headers, isEmpty);
      expect(play.resolvedId, 'chksz:163:22813978');
      // Cover comes along from the resolve endpoint.
      expect(play.coverUrl, 'https://p1.music.126.net/c.jpg');
    });

    test('getSongDetail maps resolve metadata', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        _jsonResponse(
          '{"code":200,"data":{"url":"https://x/a.mp3","name":"海底","artist":"一支榴莲","album":"独","picUrl":"https://p1.music.126.net/c.jpg"}}',
        ),
      ]);
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => 'k');
      final detail = await client.getSongDetail('chksz:163:1315196858');
      expect(detail['title'], '海底');
      expect(detail['artist'], '一支榴莲');
      expect(detail['coverUrl'], 'https://p1.music.126.net/c.jpg');
    });

    test('throws when every level returns empty', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        _jsonResponse('{"code":200,"data":{"url":""}}'),
        _jsonResponse('{"code":200,"data":{"url":""}}'),
      ]);
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => 'k');
      expect(
        () => client.getPlayUrl('chksz:163:1'),
        throwsA(isA<StateError>()),
      );
    });

    test('propagates missing key without probing', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        _jsonResponse('{"code":200,"data":{"url":"x"}}'),
      ]);
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => '');
      expect(
        () => client.getPlayUrl('chksz:163:1'),
        throwsA(isA<ChkszApiKeyMissingException>()),
      );
    });

    test('rejects non-song chksz ids', () {
      final client = ChkszMusicClient(apiKeyProvider: () => 'k');
      expect(
        () => client.getPlayUrl('chksz:playlist:1'),
        throwsA(isA<StateError>()),
      );
    });
  });

  group('ChkszMusicClient lyrics', () {
    test('prefers lrc over tlyric', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        _jsonResponse(
          '{"code":200,"data":{"lrc":"[00:00.00]原词","tlyric":"[00:00.00]翻译"}}',
        ),
      ]);
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => 'k');
      expect(await client.getLyric('chksz:163:1'), '[00:00.00]原词');
    });

    test('falls back to tlyric when lrc empty', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        _jsonResponse('{"code":200,"data":{"lrc":"","tlyric":"[00:00.00]翻译"}}'),
      ]);
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => 'k');
      expect(await client.getLyric('chksz:163:1'), '[00:00.00]翻译');
    });
  });

  group('ChkszMusicClient playlist', () {
    test('maps tracks with ar/al to chksz song ids', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        _jsonResponse('''
        {
          "code": 200,
          "data": {
            "id": 5202687076,
            "name": "华语精选",
            "creator": {"nickname": "UP主"},
            "coverImgUrl": "http://p1.music.126.net/pic.jpg",
            "tracks": [
              {"id": 1, "name": "T1", "ar": [{"name": "A"}], "al": {"name": "Al"}},
              {"id": 2, "name": "T2", "ar": [{"name": "B"}], "al": {"name": "Al"}}
            ]
          }
        }
        '''),
      ]);
      final client = ChkszMusicClient(dio: dio, apiKeyProvider: () => 'k');
      final playlist = await client.getPlaylist('chksz:playlist:5202687076');
      expect(playlist['id'], 'chksz:playlist:5202687076');
      expect(playlist['title'], '华语精选');
      expect(playlist['songCount'], 2);
      expect(playlist['coverUrl'], 'https://p1.music.126.net/pic.jpg');
      final songs = playlist['songs'] as List;
      expect(songs.first['id'], 'chksz:163:1');
      expect(songs.last['id'], 'chksz:163:2');
    });

    test('rejects non-playlist ids', () {
      final client = ChkszMusicClient(apiKeyProvider: () => 'k');
      expect(
        () => client.getPlaylist('chksz:163:1'),
        throwsA(isA<StateError>()),
      );
    });
  });
}

ResponseBody _jsonResponse(String body) {
  return ResponseBody.fromString(
    body,
    200,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );
}

class _QueueAdapter implements HttpClientAdapter {
  _QueueAdapter(this._responses);

  final List<ResponseBody> _responses;
  var _i = 0;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (_i >= _responses.length) {
      throw StateError('no more mock responses for ${options.uri}');
    }
    return _responses[_i++];
  }
}

class _CapturingAdapter implements HttpClientAdapter {
  _CapturingAdapter(this._responses);

  final List<ResponseBody> _responses;
  final List<String> apiKeys = [];
  final List<RequestOptions> requests = [];
  var _i = 0;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    apiKeys.add(options.queryParameters['apikey']?.toString() ?? '');
    return _responses[_i++];
  }
}

class _CountingAdapter implements HttpClientAdapter {
  int requests = 0;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests++;
    throw StateError('should not be reached');
  }
}
