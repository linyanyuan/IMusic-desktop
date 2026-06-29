import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/desktop/widgets/playback_completion_controller.dart';
import 'package:deepvibe_desktop/playback/playback_commands.dart';
import 'package:deepvibe_desktop/playback/playback_providers.dart';

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

  test('sequence completion advances until the end of the queue', () {
    expect(
      nextPlaybackIndexAfterCompletion(
        mode: PlaybackMode.sequence,
        currentIndex: 0,
        queueLength: 3,
      ),
      1,
    );
    expect(
      nextPlaybackIndexAfterCompletion(
        mode: PlaybackMode.sequence,
        currentIndex: 2,
        queueLength: 3,
      ),
      isNull,
    );
  });

  test('repeat-one completion reuses the current queue index', () {
    expect(
      nextPlaybackIndexAfterCompletion(
        mode: PlaybackMode.repeatOne,
        currentIndex: 1,
        queueLength: 3,
      ),
      1,
    );
  });

  testWidgets(
    'player completion starts the next queued song in sequence mode',
    (tester) async {
      final completions = StreamController<void>();
      addTearDown(completions.close);
      final startedIndexes = <int>[];
      final container = ProviderContainer(
        overrides: [
          playbackCompletionEventsProvider.overrideWithValue(
            completions.stream,
          ),
          playbackStarterProvider.overrideWithValue((
            ref, {
            required song,
            required index,
            required queue,
          }) async {
            startedIndexes.add(index);
          }),
        ],
      );
      addTearDown(container.dispose);
      container.read(playbackModeProvider.notifier).state =
          PlaybackMode.sequence;
      container.read(currentSongIndexProvider.notifier).state = 0;
      container.read(playbackQueueProvider.notifier).state = const [
        {'id': 'search-song-1', 'title': '第一首'},
        {'id': 'search-song-2', 'title': '第二首'},
      ];

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(
            home: PlaybackCompletionController(child: SizedBox.shrink()),
          ),
        ),
      );

      completions.add(null);
      await tester.pump();

      expect(startedIndexes, [1]);
    },
  );

  testWidgets('player completion stops at the end of sequence mode', (
    tester,
  ) async {
    final completions = StreamController<void>();
    addTearDown(completions.close);
    final startedIndexes = <int>[];
    final container = ProviderContainer(
      overrides: [
        playbackCompletionEventsProvider.overrideWithValue(completions.stream),
        playbackStarterProvider.overrideWithValue((
          ref, {
          required song,
          required index,
          required queue,
        }) async {
          startedIndexes.add(index);
        }),
      ],
    );
    addTearDown(container.dispose);
    container.read(playbackModeProvider.notifier).state = PlaybackMode.sequence;
    container.read(currentSongIndexProvider.notifier).state = 1;
    container.read(currentSongProvider.notifier).state = const {
      'id': 'search-song-2',
      'title': '第二首',
      'status': 'playing',
    };
    container.read(playbackQueueProvider.notifier).state = const [
      {'id': 'search-song-1', 'title': '第一首'},
      {'id': 'search-song-2', 'title': '第二首'},
    ];

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(
          home: PlaybackCompletionController(child: SizedBox.shrink()),
        ),
      ),
    );

    completions.add(null);
    await tester.pump();

    expect(startedIndexes, isEmpty);
    expect(container.read(currentSongProvider)?['status'], 'completed');
  });
}
