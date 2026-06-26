import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/core/models/song.dart';

void main() {
  test(
    'Song preserves lyrics fields needed when liked songs are played later',
    () {
      final restored = Song.fromJson(const {
        'id': 'bilibili:BV1',
        'title': '收藏歌曲',
        'artist': '歌手',
        'source': 'bilibili',
        'duration': 180000,
        'lyrics': '[00:00.00]第一句',
        'lyricsStatus': 'loaded',
        'playbackId': 'bilibili:playback',
        'playbackSourceLabel': 'B站',
      }).toJson();

      expect(restored['lyrics'], '[00:00.00]第一句');
      expect(restored['lyricsStatus'], 'loaded');
      expect(restored['playbackId'], 'bilibili:playback');
      expect(restored['playbackSourceLabel'], 'B站');
      expect(restored['duration'], 180000);
    },
  );
}
