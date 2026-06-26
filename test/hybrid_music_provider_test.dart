import 'package:flutter_test/flutter_test.dart';

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
  Future<List<Map<String, dynamic>>> searchSongs(String query) async {
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
  Future<List<Map<String, dynamic>>> searchSongs(String query) async =>
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

class _PlaybackProviderWithLyrics implements MusicProvider {
  const _PlaybackProviderWithLyrics();

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async => '';

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query) async =>
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
