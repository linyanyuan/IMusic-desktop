import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/playback/playback_commands.dart';

void main() {
  test('volume step clamps between muted and full volume', () {
    expect(
      nextSteppedVolume(
        const PlaybackVolumeSnapshot(volume: 0.96),
        0.08,
      ).volume,
      1.0,
    );
    expect(
      nextSteppedVolume(
        const PlaybackVolumeSnapshot(volume: 0.04),
        -0.08,
      ).volume,
      0.0,
    );
  });

  test('mute toggle restores the last audible volume', () {
    final muted = toggledMuteVolume(
      const PlaybackVolumeSnapshot(volume: 0.42, lastAudibleVolume: 0.42),
    );
    expect(muted.volume, 0.0);
    expect(muted.lastAudibleVolume, 0.42);

    final restored = toggledMuteVolume(muted);
    expect(restored.volume, 0.42);
    expect(restored.lastAudibleVolume, 0.42);
  });
}
