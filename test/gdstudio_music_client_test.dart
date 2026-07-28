import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/services/gdstudio_music_client.dart';

void main() {
  group('GdStudioMusicClient.parseSongId', () {
    test('parses source and media id with base64 characters', () {
      const id = 'gdstudio:joox:0QLF56OE5myG3ClImaYFZQ==';
      final parsed = GdStudioMusicClient.parseSongId(id);
      expect(parsed?.$1, 'joox');
      expect(parsed?.$2, '0QLF56OE5myG3ClImaYFZQ==');
    });

    test('rejects non-gdstudio ids', () {
      expect(GdStudioMusicClient.parseSongId('meting:tencent:1'), isNull);
      expect(GdStudioMusicClient.parseSongId('gdstudio:'), isNull);
      expect(GdStudioMusicClient.parseSongId('gdstudio:joox'), isNull);
    });
  });

  group('GdStudioMusicClient.mapSearchItem', () {
    test('maps API row to app song map with cover hint', () {
      final mapped = GdStudioMusicClient.mapSearchItem({
        'id': '197691205',
        'name': 'MINISKIRT',
        'artist': ['AOA'],
        'album': 'MINISKIRT',
        'pic_id': '120/x.jpg',
        'url_id': '197691205',
        'lyric_id': '197691205',
        'source': 'kuwo',
      });

      expect(mapped?['id'], 'gdstudio:kuwo:197691205');
      expect(mapped?['title'], 'MINISKIRT');
      expect(mapped?['artist'], 'AOA');
      expect(mapped?['resultType'], 'song');
      expect(mapped?['preferDirectUrl'], isTrue);
      expect(
        mapped?['coverUrl'],
        'https://img1.kwcdn.kuwo.cn/star/albumcover/120/x.jpg',
      );
    });

    test('maps joox cover CDN hint and optional duration', () {
      final mapped = GdStudioMusicClient.mapSearchItem({
        'id': 'abc',
        'name': 'Hit',
        'artist': ['AOA'],
        'album': 'A',
        'pic_id': 'd011245005c44896',
        'url_id': 'abc',
        'lyric_id': 'abc',
        'source': 'joox',
        'extra_data': {'duration': 210},
      });
      expect(
        mapped?['coverUrl'],
        'https://image.joox.com/JOOXcover/0/d011245005c44896/300',
      );
      expect(mapped?['duration'], 210000);
    });

    test('drops incomplete rows', () {
      expect(
        GdStudioMusicClient.mapSearchItem({
          'name': 'x',
          'source': 'kuwo',
        }),
        isNull,
      );
    });
  });

  test('getPicUrl reads url field', () async {
    final dio = Dio();
    dio.httpClientAdapter = _QueueAdapter([
      ResponseBody.fromString(
        '{"url":"https://image.example/cover.jpg","from":"music.gdstudio.xyz"}',
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      ),
    ]);
    final client = GdStudioMusicClient(dio: dio);
    final url = await client.getPicUrl(
      source: 'joox',
      picId: 'd011',
      size: 300,
    );
    expect(url, 'https://image.example/cover.jpg');
  });

  group('GdStudioMusicClient HTTP', () {
    test('searchSongs uses first non-empty source', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        // joox empty
        ResponseBody.fromString('[]', 200, headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        }),
        // netease hits
        ResponseBody.fromString(
          '[{"id":"1","name":"Song","artist":["A"],"album":"","url_id":"1","lyric_id":"1","source":"netease"}]',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        ),
      ]);

      final client = GdStudioMusicClient(
        dio: dio,
        sources: const ['joox', 'netease'],
      );
      final songs = await client.searchSongs('AOA');
      expect(songs, hasLength(1));
      expect(songs.single['id'], 'gdstudio:netease:1');
    });

    test('searchSongs passes pages param for later pages', () async {
      final adapter = _CapturingAdapter([
        ResponseBody.fromString(
          '[{"id":"1","name":"Song","artist":["A"],"album":"","url_id":"1","lyric_id":"1","source":"kuwo"}]',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        ),
        ResponseBody.fromString(
          '[{"id":"2","name":"Song2","artist":["A"],"album":"","url_id":"2","lyric_id":"2","source":"kuwo"}]',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        ),
      ]);
      final dio = Dio()..httpClientAdapter = adapter;
      final client = GdStudioMusicClient(
        dio: dio,
        sources: const ['kuwo'],
      );

      final page1 = await client.searchSongs('AOA', page: 1);
      final page2 = await client.searchSongs('AOA', page: 2);

      expect(page1.single['id'], 'gdstudio:kuwo:1');
      expect(page2.single['id'], 'gdstudio:kuwo:2');
      expect(adapter.pages, [1, 2]);
    });

    test('load-more after joox uses pageable kuwo page 1', () async {
      final adapter = _CapturingAdapter([
        // joox page 1
        ResponseBody.fromString(
          '[{"id":"j1","name":"J","artist":["A"],"album":"","url_id":"j1","lyric_id":"j1","source":"joox"}]',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        ),
        // kuwo page 1 for UI page 2
        ResponseBody.fromString(
          '[{"id":"k1","name":"K","artist":["A"],"album":"","url_id":"k1","lyric_id":"k1","source":"kuwo"}]',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        ),
      ]);
      final dio = Dio()..httpClientAdapter = adapter;
      final client = GdStudioMusicClient(
        dio: dio,
        sources: const ['joox', 'kuwo'],
      );

      final page1 = await client.searchSongs('AOA', page: 1);
      final page2 = await client.searchSongs('AOA', page: 2);

      expect(page1.single['id'], 'gdstudio:joox:j1');
      expect(page2.single['id'], 'gdstudio:kuwo:k1');
      expect(adapter.pages, [1, 1]);
      expect(adapter.sources, ['joox', 'kuwo']);
    });

    test('getPlayUrl returns direct url without headers', () async {
      final dio = Dio();
      dio.httpClientAdapter = _QueueAdapter([
        ResponseBody.fromString(
          '{"url":"https://cdn.example/a.mp3","br":320,"size":1}',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        ),
        ResponseBody.fromString(
          '{"lyric":"[00:00.00]hi"}',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        ),
      ]);

      final client = GdStudioMusicClient(dio: dio);
      final play = await client.getPlayUrl('gdstudio:joox:abc');
      expect(play.url, 'https://cdn.example/a.mp3');
      expect(play.headers, isEmpty);
      // Lyrics load asynchronously after play starts (Hybrid.getLyrics).
      expect(play.lyrics, isEmpty);
      expect(play.resolvedId, 'gdstudio:joox:abc');
    });
  });
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
  final List<int> pages = [];
  final List<String> sources = [];
  var _i = 0;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final raw = options.queryParameters['pages'];
    pages.add(raw is int ? raw : int.tryParse(raw?.toString() ?? '') ?? -1);
    sources.add(options.queryParameters['source']?.toString() ?? '');
    if (_i >= _responses.length) {
      throw StateError('no more mock responses for ${options.uri}');
    }
    return _responses[_i++];
  }
}
