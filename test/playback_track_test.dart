import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/playback/playback_track.dart';

void main() {
  test('PlaybackTrack preserves unknown fields when copied', () {
    final track = PlaybackTrack.fromJson(const {
      'id': 'song-1',
      'title': 'Track title',
      'artist': 'Artist name',
      'source': 'bilibili',
      'customField': {'nested': true},
    });

    final copied = track.copyWith(
      status: PlaybackStatus.playing,
      lyricsStatus: LyricsStatus.loading,
      lyricsLoadingStartedAt: 1234,
      lyricsTimedOutAt: null,
    );

    expect(copied.toJson()['customField'], {'nested': true});
    expect(copied.toJson()['source'], 'bilibili');
  });

  test('PlaybackTrack writes existing playback and lyrics JSON keys', () {
    final json =
        PlaybackTrack.fromJson(const {
              'id': 'song-1',
              'title': 'Track title',
              'artist': 'Artist name',
            })
            .copyWith(
              lyrics: 'line 1',
              status: PlaybackStatus.playing,
              lyricsStatus: LyricsStatus.loaded,
              playbackId: 'resolved-song-1',
              playUrl: 'https://example.test/song.mp3',
              lyricsLoadingStartedAt: null,
              lyricsTimedOutAt: null,
            )
            .toJson();

    expect(json['id'], 'song-1');
    expect(json['title'], 'Track title');
    expect(json['artist'], 'Artist name');
    expect(json['lyrics'], 'line 1');
    expect(json['status'], 'playing');
    expect(json['lyricsStatus'], 'loaded');
    expect(json['playbackId'], 'resolved-song-1');
    expect(json['playUrl'], 'https://example.test/song.mp3');
    expect(json.containsKey('lyricsLoadingStartedAt'), isTrue);
    expect(json['lyricsLoadingStartedAt'], isNull);
    expect(json.containsKey('lyricsTimedOutAt'), isTrue);
    expect(json['lyricsTimedOutAt'], isNull);
  });

  test('PlaybackTrack exposes typed status helpers', () {
    final loading = PlaybackTrack.fromJson(const {
      'id': 'song-1',
      'lyrics': '',
      'status': 'loading',
      'lyricsStatus': 'loading',
      'lyricsLoadingStartedAt': 1000,
      'lyricsTimedOutAt': 2000,
    });

    expect(loading.id, 'song-1');
    expect(loading.status, PlaybackStatus.loading);
    expect(loading.lyricsStatus, LyricsStatus.loading);
    expect(loading.isLyricsLoading, isTrue);
    expect(loading.lyricsLoadingStartedAt, 1000);
    expect(loading.lyricsTimedOutAt, 2000);
    expect(loading.withPlaying(playUrl: 'u').toJson()['status'], 'playing');
    expect(loading.withPlaybackError().toJson()['status'], 'error');
    expect(loading.withLyricsTimeout().toJson()['lyricsStatus'], 'timeout');
  });
}
