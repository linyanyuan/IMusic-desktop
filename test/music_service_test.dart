import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/services/music_provider.dart';
import 'package:deepvibe_desktop/services/music_service.dart';

void main() {
  test(
    'MusicService keeps cached lyrics when later results are sparse',
    () async {
      final service = MusicService(provider: const _EchoLyricsProvider());

      service.rememberSongs(const [
        {
          'id': 'liked-song-1',
          'title': '喜欢的歌',
          'artist': '歌手',
          'lyrics': '[00:00.00]喜欢歌词',
        },
      ]);
      service.rememberSongs(const [
        {'id': 'liked-song-1', 'title': '喜欢的歌'},
      ]);

      final lyrics = await service.getLyrics(const {'id': 'liked-song-1'});

      expect(lyrics, '[00:00.00]喜欢歌词');
    },
  );

  test('MusicService merges current song metadata over stale cache', () async {
    final provider = _EchoLyricsProvider(
      lyricsByPlaybackId: const {'bilibili:BVhistory:1': '[00:00.00]历史歌词'},
    );
    final service = MusicService(provider: provider);

    service.rememberSongs(const [
      {'id': 'history-song-1', 'title': '历史歌曲'},
    ]);

    final lyrics = await service.getLyrics(const {
      'id': 'history-song-1',
      'title': '历史歌曲',
      'playbackId': 'bilibili:BVhistory:1',
    });

    expect(lyrics, '[00:00.00]历史歌词');
  });

  test(
    'MusicService caches resolved playback id for later lyrics lookup',
    () async {
      final provider = _EchoLyricsProvider(
        lyricsByPlaybackId: const {'bilibili:BVresolved:1': '[00:00.00]解析后歌词'},
        playbackUrls: const {
          'liked-song-2': PlaybackUrl(
            'https://example.test/audio.m4s',
            resolvedId: 'bilibili:BVresolved:1',
          ),
        },
      );
      final service = MusicService(provider: provider);

      await service.getPlayUrl('liked-song-2');
      final lyrics = await service.getLyrics(const {
        'id': 'liked-song-2',
        'title': '需要解析ID的歌',
      });

      expect(lyrics, '[00:00.00]解析后歌词');
    },
  );
}

class _EchoLyricsProvider implements MusicProvider {
  const _EchoLyricsProvider({
    this.lyricsByPlaybackId = const {},
    this.playbackUrls = const {},
  });

  final Map<String, String> lyricsByPlaybackId;
  final Map<String, PlaybackUrl> playbackUrls;

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async {
    final direct = song['lyrics']?.toString().trim() ?? '';
    if (direct.isNotEmpty) return direct;

    final playbackId = song['playbackId']?.toString() ?? '';
    return lyricsByPlaybackId[playbackId] ?? '';
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
  Future<Map<String, dynamic>> getSongDetail(String id) {
    throw UnimplementedError();
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) async =>
      playbackUrls[id] ?? const PlaybackUrl('https://example.test/audio.m4s');
}
