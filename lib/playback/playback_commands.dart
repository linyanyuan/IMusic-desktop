import 'package:audioplayers/audioplayers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'playback_actions.dart';
import 'playback_providers.dart';

const double playbackVolumeStep = 0.08;

class PlaybackVolumeSnapshot {
  final double volume;
  final double lastAudibleVolume;

  const PlaybackVolumeSnapshot({
    required this.volume,
    this.lastAudibleVolume = 1.0,
  });
}

PlaybackVolumeSnapshot nextSteppedVolume(
  PlaybackVolumeSnapshot current,
  double delta,
) {
  final nextVolume = (current.volume + delta).clamp(0.0, 1.0).toDouble();
  return PlaybackVolumeSnapshot(
    volume: nextVolume,
    lastAudibleVolume: nextVolume > 0
        ? nextVolume
        : current.lastAudibleVolume.clamp(0.01, 1.0).toDouble(),
  );
}

PlaybackVolumeSnapshot toggledMuteVolume(PlaybackVolumeSnapshot current) {
  if (current.volume > 0) {
    return PlaybackVolumeSnapshot(
      volume: 0,
      lastAudibleVolume: current.volume.clamp(0.01, 1.0).toDouble(),
    );
  }
  return PlaybackVolumeSnapshot(
    volume: current.lastAudibleVolume.clamp(0.01, 1.0).toDouble(),
    lastAudibleVolume: current.lastAudibleVolume.clamp(0.01, 1.0).toDouble(),
  );
}

Future<void> togglePlayPause(WidgetRef ref) async {
  final player = ref.read(audioPlayerProvider);
  final current = ref.read(currentSongProvider);
  final loaded = ref.read(loadedPlaybackProvider);
  if (current == null) return;

  if (player.state == PlayerState.playing) {
    await player.pause();
    ref.read(currentSongProvider.notifier).state = {
      ...current,
      'status': 'paused',
    };
    return;
  }

  if (loaded?['id']?.toString() == current['id']?.toString()) {
    await player.resume();
    ref.read(currentSongProvider.notifier).state = {
      ...current,
      'status': 'playing',
    };
    return;
  }

  await startSongPlayback(
    ref,
    song: current,
    index: ref.read(currentSongIndexProvider),
    queue: ref.read(playbackQueueProvider),
  );
}

Future<void> playPreviousTrack(WidgetRef ref) async {
  final queue = ref.read(playbackQueueProvider);
  if (queue.isEmpty) return;
  final currentIndex = ref.read(currentSongIndexProvider);
  final prevIndex = currentIndex > 0 ? currentIndex - 1 : queue.length - 1;
  await startSongPlayback(
    ref,
    song: queue[prevIndex],
    index: prevIndex,
    queue: queue,
  );
}

Future<void> playNextTrack(WidgetRef ref) async {
  final queue = ref.read(playbackQueueProvider);
  if (queue.isEmpty) return;
  final currentIndex = ref.read(currentSongIndexProvider);
  final nextIndex = (currentIndex + 1) % queue.length;
  await startSongPlayback(
    ref,
    song: queue[nextIndex],
    index: nextIndex,
    queue: queue,
  );
}

Future<void> setPlaybackVolume(WidgetRef ref, double value) async {
  final normalized = value.clamp(0.0, 1.0).toDouble();
  ref.read(playerVolumeProvider.notifier).state = normalized;
  if (normalized > 0) {
    ref.read(lastAudibleVolumeProvider.notifier).state = normalized;
  }
  await ref.read(audioPlayerProvider).setVolume(normalized);
}

Future<void> stepPlaybackVolume(WidgetRef ref, double delta) async {
  final next = nextSteppedVolume(
    PlaybackVolumeSnapshot(
      volume: ref.read(playerVolumeProvider),
      lastAudibleVolume: ref.read(lastAudibleVolumeProvider),
    ),
    delta,
  );
  ref.read(lastAudibleVolumeProvider.notifier).state = next.lastAudibleVolume;
  await setPlaybackVolume(ref, next.volume);
}

Future<void> togglePlaybackMute(WidgetRef ref) async {
  final next = toggledMuteVolume(
    PlaybackVolumeSnapshot(
      volume: ref.read(playerVolumeProvider),
      lastAudibleVolume: ref.read(lastAudibleVolumeProvider),
    ),
  );
  ref.read(lastAudibleVolumeProvider.notifier).state = next.lastAudibleVolume;
  await setPlaybackVolume(ref, next.volume);
}
