import 'dart:async';
import 'dart:typed_data';

import 'package:audioplayers_platform_interface/audioplayers_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/desktop/widgets/playback_completion_controller.dart';
import 'package:deepvibe_desktop/playback/playback_commands.dart';
import 'package:deepvibe_desktop/playback/playback_actions.dart';
import 'package:deepvibe_desktop/playback/playback_providers.dart';
import 'package:deepvibe_desktop/services/music_provider.dart';
import 'package:deepvibe_desktop/services/music_service.dart';

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

  testWidgets('playback URL failure shows the requested song error', (
    tester,
  ) async {
    final provider = _ControlledPlaybackProvider();
    final audioPlatform = _FakeAudioplayersPlatform();
    final globalPlatform = _FakeGlobalAudioPlatform();
    final previousAudioPlatform = AudioplayersPlatformInterface.instance;
    final previousGlobalPlatform = GlobalAudioplayersPlatformInterface.instance;
    AudioplayersPlatformInterface.instance = audioPlatform;
    GlobalAudioplayersPlatformInterface.instance = globalPlatform;
    addTearDown(() async {
      AudioplayersPlatformInterface.instance = previousAudioPlatform;
      GlobalAudioplayersPlatformInterface.instance = previousGlobalPlatform;
      await audioPlatform.disposeControllers();
      await globalPlatform.dispose();
    });

    final container = ProviderContainer(
      overrides: [
        musicServiceProvider.overrideWithValue(
          MusicService(provider: provider),
        ),
      ],
    );
    addTearDown(container.dispose);

    late WidgetRef capturedRef;
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: Consumer(
          builder: (context, ref, _) {
            capturedRef = ref;
            return const SizedBox.shrink();
          },
        ),
      ),
    );

    const luv = {'id': 'luv', 'title': 'LUV', 'status': 'playing'};
    const mrChu = {'id': 'mr-chu', 'title': 'Mr.Chu'};
    container.read(currentSongProvider.notifier).state = luv;
    container.read(currentSongIndexProvider.notifier).state = 0;

    final playback = startSongPlayback(
      capturedRef,
      song: mrChu,
      index: 1,
      queue: const [luv, mrChu],
    );
    await tester.pump();

    expect(provider.requestedIds, ['mr-chu']);
    expect(audioPlatform.calls, contains('stop'));
    expect(container.read(currentSongProvider)?['id'], 'mr-chu');
    expect(container.read(currentSongProvider)?['status'], 'loading');
    expect(container.read(currentSongIndexProvider), 1);

    provider.fail(StateError('play url timeout'));
    await playback;

    expect(audioPlatform.calls, contains('stop'));
    expect(container.read(currentSongProvider)?['id'], 'mr-chu');
    expect(container.read(currentSongProvider)?['status'], 'error');
    expect(container.read(currentSongIndexProvider), 1);
  });

  testWidgets('new playback stops the current song before URL resolution', (
    tester,
  ) async {
    final provider = _ControlledPlaybackProvider();
    late ProviderContainer container;
    Map<String, dynamic>? songAtSetSource;
    int? indexAtSetSource;
    final audioPlatform = _FakeAudioplayersPlatform(
      onSetSourceUrl: () {
        songAtSetSource = container.read(currentSongProvider);
        indexAtSetSource = container.read(currentSongIndexProvider);
      },
    );
    final globalPlatform = _FakeGlobalAudioPlatform();
    final previousAudioPlatform = AudioplayersPlatformInterface.instance;
    final previousGlobalPlatform = GlobalAudioplayersPlatformInterface.instance;
    AudioplayersPlatformInterface.instance = audioPlatform;
    GlobalAudioplayersPlatformInterface.instance = globalPlatform;
    addTearDown(() async {
      AudioplayersPlatformInterface.instance = previousAudioPlatform;
      GlobalAudioplayersPlatformInterface.instance = previousGlobalPlatform;
      await audioPlatform.disposeControllers();
      await globalPlatform.dispose();
    });

    container = ProviderContainer(
      overrides: [
        musicServiceProvider.overrideWithValue(
          MusicService(provider: provider),
        ),
      ],
    );
    addTearDown(container.dispose);

    late WidgetRef capturedRef;
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: Consumer(
          builder: (context, ref, _) {
            capturedRef = ref;
            return const SizedBox.shrink();
          },
        ),
      ),
    );

    const luv = {'id': 'luv', 'title': 'LUV', 'status': 'playing'};
    const mrChu = {'id': 'mr-chu', 'title': 'Mr.Chu'};
    container.read(currentSongProvider.notifier).state = luv;
    container.read(currentSongIndexProvider.notifier).state = 0;

    final playback = startSongPlayback(
      capturedRef,
      song: mrChu,
      index: 1,
      queue: const [luv, mrChu],
    );
    await tester.pump();

    expect(provider.requestedIds, ['mr-chu']);
    expect(audioPlatform.calls, contains('stop'));
    expect(container.read(currentSongProvider)?['id'], 'mr-chu');
    expect(container.read(currentSongProvider)?['status'], 'loading');
    expect(container.read(currentSongIndexProvider), 1);

    provider.succeed(const PlaybackUrl('https://example.test/mr-chu.mp3'));
    await playback;

    expect(audioPlatform.calls, containsAllInOrder(['stop', 'setSourceUrl']));
    expect(songAtSetSource?['id'], 'mr-chu');
    expect(songAtSetSource?['status'], 'loading');
    expect(indexAtSetSource, 1);
    expect(container.read(currentSongProvider)?['id'], 'mr-chu');
    expect(container.read(currentSongProvider)?['status'], 'playing');

    await container.read(audioPlayerProvider).stop();
    await tester.pump();
  });

  testWidgets(
    'playback failure after stopping previous song shows requested error',
    (tester) async {
      final provider = _ControlledPlaybackProvider();
      final audioPlatform = _FakeAudioplayersPlatform(failSetSource: true);
      final globalPlatform = _FakeGlobalAudioPlatform();
      final previousAudioPlatform = AudioplayersPlatformInterface.instance;
      final previousGlobalPlatform =
          GlobalAudioplayersPlatformInterface.instance;
      AudioplayersPlatformInterface.instance = audioPlatform;
      GlobalAudioplayersPlatformInterface.instance = globalPlatform;
      addTearDown(() async {
        AudioplayersPlatformInterface.instance = previousAudioPlatform;
        GlobalAudioplayersPlatformInterface.instance = previousGlobalPlatform;
        await audioPlatform.disposeControllers();
        await globalPlatform.dispose();
      });

      final container = ProviderContainer(
        overrides: [
          musicServiceProvider.overrideWithValue(
            MusicService(provider: provider),
          ),
        ],
      );
      addTearDown(container.dispose);

      late WidgetRef capturedRef;
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: Consumer(
            builder: (context, ref, _) {
              capturedRef = ref;
              return const SizedBox.shrink();
            },
          ),
        ),
      );

      const luv = {'id': 'luv', 'title': 'LUV', 'status': 'playing'};
      const mrChu = {'id': 'mr-chu', 'title': 'Mr.Chu'};
      container.read(currentSongProvider.notifier).state = luv;
      container.read(currentSongIndexProvider.notifier).state = 0;

      final playback = startSongPlayback(
        capturedRef,
        song: mrChu,
        index: 1,
        queue: const [luv, mrChu],
      );
      await tester.pump();

      provider.succeed(const PlaybackUrl('https://example.test/mr-chu.mp3'));
      await playback;

      expect(audioPlatform.calls, containsAllInOrder(['stop', 'setSourceUrl']));
      expect(container.read(currentSongProvider)?['id'], 'mr-chu');
      expect(container.read(currentSongProvider)?['status'], 'error');
      expect(container.read(currentSongIndexProvider), 1);
    },
  );
}

class _ControlledPlaybackProvider implements MusicProvider {
  final requestedIds = <String>[];
  final Completer<PlaybackUrl> _playUrl = Completer<PlaybackUrl>();

  void fail(Object error) {
    if (!_playUrl.isCompleted) _playUrl.completeError(error);
  }

  void succeed(PlaybackUrl playUrl) {
    if (!_playUrl.isCompleted) _playUrl.complete(playUrl);
  }

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query) async =>
      const [];

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async => '';

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
    requestedIds.add(id);
    return _playUrl.future;
  }
}

class _FakeAudioplayersPlatform extends AudioplayersPlatformInterface {
  _FakeAudioplayersPlatform({this.failSetSource = false, this.onSetSourceUrl});

  final bool failSetSource;
  final void Function()? onSetSourceUrl;
  final calls = <String>[];
  final _events = <String, StreamController<AudioEvent>>{};

  @override
  Future<void> create(String playerId) async {
    calls.add('create');
    _events[playerId] = StreamController<AudioEvent>.broadcast();
  }

  @override
  Future<void> dispose(String playerId) async {
    calls.add('dispose');
    await _events.remove(playerId)?.close();
  }

  @override
  Stream<AudioEvent> getEventStream(String playerId) {
    return _events
        .putIfAbsent(playerId, () => StreamController<AudioEvent>.broadcast())
        .stream;
  }

  @override
  Future<void> pause(String playerId) async {
    calls.add('pause');
  }

  @override
  Future<void> stop(String playerId) async {
    calls.add('stop');
  }

  @override
  Future<void> resume(String playerId) async {
    calls.add('resume');
  }

  @override
  Future<void> release(String playerId) async {
    calls.add('release');
  }

  @override
  Future<void> seek(String playerId, Duration position) async {}

  @override
  Future<void> setBalance(String playerId, double balance) async {}

  @override
  Future<void> setVolume(String playerId, double volume) async {}

  @override
  Future<void> setReleaseMode(String playerId, ReleaseMode releaseMode) async {}

  @override
  Future<void> setPlaybackRate(String playerId, double playbackRate) async {}

  @override
  Future<void> setSourceUrl(
    String playerId,
    String url, {
    bool? isLocal,
    String? mimeType,
  }) async {
    calls.add('setSourceUrl');
    onSetSourceUrl?.call();
    _events[playerId]?.add(
      const AudioEvent(eventType: AudioEventType.prepared, isPrepared: true),
    );
    if (failSetSource) throw StateError('set source failed');
  }

  @override
  Future<void> setSourceBytes(
    String playerId,
    Uint8List bytes, {
    String? mimeType,
  }) async {}

  @override
  Future<void> setAudioContext(
    String playerId,
    AudioContext audioContext,
  ) async {}

  @override
  Future<void> setPlayerMode(String playerId, PlayerMode playerMode) async {}

  @override
  Future<int?> getDuration(String playerId) async => null;

  @override
  Future<int?> getCurrentPosition(String playerId) async => null;

  @override
  Future<void> emitLog(String playerId, String message) async {}

  @override
  Future<void> emitError(String playerId, String code, String message) async {}

  Future<void> disposeControllers() async {
    for (final controller in _events.values) {
      await controller.close();
    }
    _events.clear();
  }
}

class _FakeGlobalAudioPlatform implements GlobalAudioplayersPlatformInterface {
  final _events = StreamController<GlobalAudioEvent>.broadcast();

  @override
  Future<void> init() async {}

  @override
  Future<void> setGlobalAudioContext(AudioContext ctx) async {}

  @override
  Future<void> emitGlobalLog(String message) async {}

  @override
  Future<void> emitGlobalError(String code, String message) async {}

  @override
  Stream<GlobalAudioEvent> getGlobalEventStream() => _events.stream;

  Future<void> dispose() {
    return _events.close();
  }
}
