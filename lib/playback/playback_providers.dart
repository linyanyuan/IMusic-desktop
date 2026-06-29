import 'package:audioplayers/audioplayers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Playback mode enum
enum PlaybackMode { sequence, shuffle, repeatOne }

/// Current song provider - contains full song data including lyrics and status
final currentSongProvider = StateProvider<Map<String, dynamic>?>((ref) => null);

/// Playback queue provider - list of all songs in current queue
final playbackQueueProvider = StateProvider<List<Map<String, dynamic>>>(
  (ref) => const [],
);

/// Loaded playback provider - contains the song with playUrl loaded
final loadedPlaybackProvider = StateProvider<Map<String, dynamic>?>(
  (ref) => null,
);

/// Current song index in queue
final currentSongIndexProvider = StateProvider<int>((ref) => 0);

/// Playback mode (sequence, shuffle, repeatOne)
final playbackModeProvider = StateProvider<PlaybackMode>(
  (ref) => PlaybackMode.sequence,
);

/// Current player volume, normalized from 0.0 to 1.0.
final playerVolumeProvider = StateProvider<double>((ref) => 1.0);

/// Last non-zero volume used when toggling mute back off.
final lastAudibleVolumeProvider = StateProvider<double>((ref) => 1.0);

/// Audio player instance provider
final audioPlayerProvider = Provider<AudioPlayer>((ref) {
  final player = AudioPlayer();
  ref.onDispose(player.dispose);
  return player;
});

/// Playback position stream provider
final playbackPositionProvider = StreamProvider<Duration>((ref) {
  return ref.watch(audioPlayerProvider).onPositionChanged;
});

/// Playback duration stream provider
final playbackDurationProvider = StreamProvider<Duration?>((ref) {
  return ref.watch(audioPlayerProvider).onDurationChanged;
});

/// Playback playing state stream provider
final playbackPlayingProvider = StreamProvider<bool>((ref) {
  final player = ref.watch(audioPlayerProvider);
  return player.onPlayerStateChanged.map(
    (state) => state == PlayerState.playing,
  );
});
