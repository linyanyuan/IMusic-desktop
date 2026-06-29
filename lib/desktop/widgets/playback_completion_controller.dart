import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../playback/playback_commands.dart';
import '../../playback/playback_providers.dart';

final playbackCompletionEventsProvider = Provider<Stream<void>>((ref) {
  return ref.watch(audioPlayerProvider).onPlayerComplete;
});

class PlaybackCompletionController extends ConsumerStatefulWidget {
  final Widget child;

  const PlaybackCompletionController({super.key, required this.child});

  @override
  ConsumerState<PlaybackCompletionController> createState() =>
      _PlaybackCompletionControllerState();
}

class _PlaybackCompletionControllerState
    extends ConsumerState<PlaybackCompletionController> {
  StreamSubscription<void>? _subscription;
  bool _handlingCompletion = false;

  @override
  void initState() {
    super.initState();
    _subscription = ref
        .read(playbackCompletionEventsProvider)
        .listen((_) => _handleCompletion());
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;

  Future<void> _handleCompletion() async {
    if (_handlingCompletion) return;
    _handlingCompletion = true;
    try {
      final queue = ref.read(playbackQueueProvider);
      final nextIndex = nextPlaybackIndexAfterCompletion(
        mode: ref.read(playbackModeProvider),
        currentIndex: ref.read(currentSongIndexProvider),
        queueLength: queue.length,
      );

      if (nextIndex == null) {
        final current = ref.read(currentSongProvider);
        if (current != null) {
          ref.read(currentSongProvider.notifier).state = {
            ...current,
            'status': 'completed',
          };
        }
        return;
      }

      await ref.read(playbackStarterProvider)(
        ref,
        song: queue[nextIndex],
        index: nextIndex,
        queue: queue,
      );
    } finally {
      _handlingCompletion = false;
    }
  }
}
