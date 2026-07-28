import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:audioplayers/audioplayers.dart';
import 'playback_providers.dart';
import '../services/music_service.dart';
import '../services/library_service.dart';
import '../services/app_settings.dart';
import '../services/audio_cache_service.dart';
import '../core/models/song.dart';
import 'playback_track.dart';

export 'playback_track.dart'
    show
        lyricsStatusLoading,
        lyricsStatusLoaded,
        lyricsStatusEmpty,
        lyricsStatusTimeout,
        lyricsTimeoutAtKey,
        lyricsLoadingStartedAtKey;

/// Request serial numbers to prevent old requests from overwriting new ones
int playbackRequestSerial = 0;
int lyricsRequestSerial = 0;

Duration lyricsLoadTimeout = const Duration(seconds: 15);
Duration lyricsTimeoutNoticeDuration = const Duration(seconds: 6);

bool shouldShowLyricsTimeoutNotice(
  Map<String, dynamic>? song, {
  DateTime? now,
}) {
  if (song == null) {
    return false;
  }

  final track = PlaybackTrack.fromJson(song);
  if (!track.isLyricsTimeout) {
    return false;
  }

  final timeoutAt = track.lyricsTimedOutAt;
  if (timeoutAt == null) return true;

  final elapsed = (now ?? DateTime.now()).millisecondsSinceEpoch - timeoutAt;
  return elapsed < lyricsTimeoutNoticeDuration.inMilliseconds;
}

bool isLyricsLoadingExpired(Map<String, dynamic>? song, {DateTime? now}) {
  if (song == null) {
    return false;
  }

  final track = PlaybackTrack.fromJson(song);
  if (!track.isLyricsLoading) {
    return false;
  }

  final startedAt = track.lyricsLoadingStartedAt;
  if (startedAt == null) return false;
  final elapsed = (now ?? DateTime.now()).millisecondsSinceEpoch - startedAt;
  return elapsed >= lyricsLoadTimeout.inMilliseconds;
}

void requestLyricsForCurrentSong(WidgetRef ref) {
  final song = ref.read(currentSongProvider);
  if (song == null) return;

  final track = PlaybackTrack.fromJson(song);
  if (track.lyrics.trim().isNotEmpty) return;

  final lyricSerial = ++lyricsRequestSerial;
  ref.read(currentSongProvider.notifier).state = track
      .copyWith(
        lyricsStatus: LyricsStatus.loading,
        lyricsLoadingStartedAt: DateTime.now().millisecondsSinceEpoch,
        lyricsTimedOutAt: null,
      )
      .toJson();

  unawaited(
    loadLyricsForCurrentSong(
      ref,
      song,
      requestSerial: playbackRequestSerial,
      lyricsSerial: lyricSerial,
    ),
  );
}

/// Start song playback with full flow:
/// 1. Set current song to loading state
/// 2. Write queue and index
/// 3. Remember songs in music service
/// 4. Get playback URL
/// 5. Load audio and play
/// 6. Update current song with playUrl, lyrics, status
/// 7. Trigger async lyrics loading if needed
Future<void> startSongPlayback(
  WidgetRef ref, {
  required Map<String, dynamic> song,
  required int index,
  required List<Map<String, dynamic>> queue,
}) async {
  final requestSerial = ++playbackRequestSerial;
  ++lyricsRequestSerial;

  final previousSong = ref.read(currentSongProvider);
  final previousTrack = previousSong == null
      ? null
      : PlaybackTrack.fromJson(previousSong);
  final keepPreviousPlaybackVisible =
      previousTrack?.isPlaying == true || previousTrack?.isPaused == true;
  final requestedTrack = PlaybackTrack.fromJson(song);

  // Check if song already has lyrics
  final initialLyrics = requestedTrack.lyrics.trim();
  final initialLyricsStatus = initialLyrics.isEmpty
      ? LyricsStatus.loading
      : LyricsStatus.loaded;
  var previousPlaybackStopped = false;

  void showRequestedSongLoading() {
    ref.read(playbackQueueProvider.notifier).state = queue;
    ref.read(currentSongIndexProvider.notifier).state = index;
    ref.read(currentSongProvider.notifier).state = requestedTrack
        .withLoading(
          lyricsStatus: initialLyricsStatus,
          lyricsLoadingStartedAt: initialLyrics.isEmpty
              ? DateTime.now().millisecondsSinceEpoch
              : null,
        )
        .toJson();
  }

  if (!keepPreviousPlaybackVisible) {
    showRequestedSongLoading();
  }

  try {
    // Remember songs for cache
    final musicService = ref.read(musicServiceProvider);
    musicService.rememberSongs(queue);
    musicService.rememberSongs([song]);

    // Get playback URL
    final playUrl = await musicService.getPlayUrl(requestedTrack.id ?? 'null');

    // Check if this request is still current
    if (requestSerial != playbackRequestSerial) return;

    // Load and play audio
    final player = ref.read(audioPlayerProvider);
    await player.stop();
    previousPlaybackStopped = true;

    if (requestSerial != playbackRequestSerial) return;
    showRequestedSongLoading();

    // Windows audioplayers doesn't support custom headers
    // Download to a stable local cache file if headers are required.
    String sourceUrl = playUrl.url;
    if (playUrl.headers.isNotEmpty) {
      print('[PlaybackActions] 检测到需要 headers，准备本地缓存');
      try {
        final settings = ref.read(appSettingsProvider);
        final cacheService = ref.read(audioCacheServiceProvider);
        unawaited(cacheService.cleanupExpiredIfNeeded(settings));
        final cacheResult = await cacheService.getOrDownload(
          playUrl: playUrl,
          cacheDirectory: settings.cacheDirectory,
        );
        sourceUrl = cacheResult.path;
        print(
          cacheResult.cacheHit
              ? '[PlaybackActions] 命中音频缓存: $sourceUrl'
              : '[PlaybackActions] 音频缓存完成: $sourceUrl',
        );
      } catch (e) {
        print('[PlaybackActions] 缓存准备失败: $e');
        throw Exception('准备音频缓存失败: $e');
      }
    }

    // Check again after download
    if (requestSerial != playbackRequestSerial) return;

    // Set source from URL or local file
    await player.setSource(
      sourceUrl.startsWith('http')
          ? UrlSource(sourceUrl)
          : DeviceFileSource(sourceUrl),
    );
    await player.resume();

    // Merge lyrics: prefer PlaybackUrl.lyrics > currentSong.lyrics > initialLyrics
    final current = ref.read(currentSongProvider);
    final currentTrack = current == null
        ? null
        : PlaybackTrack.fromJson(current);
    final currentLyrics = currentTrack?.sameSongAs(requestedTrack) == true
        ? currentTrack?.lyrics ?? ''
        : '';
    final resolvedLyrics = playUrl.lyrics.trim().isNotEmpty
        ? playUrl.lyrics
        : currentLyrics.trim().isNotEmpty
        ? currentLyrics
        : initialLyrics;

    // Build enriched song data
    var enrichedTrack = requestedTrack.withPlaying(
      playUrl: playUrl.url,
      lyrics: resolvedLyrics,
      lyricsStatus: resolvedLyrics.trim().isEmpty
          ? LyricsStatus.loading
          : LyricsStatus.loaded,
      lyricsLoadingStartedAt: resolvedLyrics.trim().isEmpty
          ? DateTime.now().millisecondsSinceEpoch
          : null,
    );
    if (playUrl.resolvedId.isNotEmpty) {
      enrichedTrack = enrichedTrack.copyWith(playbackId: playUrl.resolvedId);
    }
    final enriched = enrichedTrack.toJson();

    // Update providers
    ref.read(playbackQueueProvider.notifier).state = queue;
    ref.read(currentSongIndexProvider.notifier).state = index;
    ref.read(loadedPlaybackProvider.notifier).state = enriched;
    ref.read(currentSongProvider.notifier).state = enriched;

    if (resolvedLyrics.trim().isEmpty) {
      final lyricSerial = ++lyricsRequestSerial;
      unawaited(
        loadLyricsForCurrentSong(
          ref,
          enriched,
          requestSerial: requestSerial,
          lyricsSerial: lyricSerial,
        ),
      );
    }

    // Add to play history
    try {
      final songObj = Song.fromJson(enriched);
      await ref.read(libraryProvider.notifier).addToHistory(songObj);
    } catch (e) {
      print('[PlaybackActions] 添加历史记录失败: $e');
    }

    print('[PlaybackActions] 播放成功: ${song['title']} (${song['id']})');
  } catch (e) {
    print('[PlaybackActions] 播放失败: $e');
    if (requestSerial == playbackRequestSerial) {
      if (!previousPlaybackStopped) {
        try {
          await ref.read(audioPlayerProvider).stop();
          previousPlaybackStopped = true;
        } catch (stopError) {
          print('[PlaybackActions] 停止旧播放失败: $stopError');
        }
      }

      ref.read(playbackQueueProvider.notifier).state = queue;
      ref.read(currentSongIndexProvider.notifier).state = index;
      ref.read(currentSongProvider.notifier).state = requestedTrack
          .withPlaybackError(
            lyricsStatus: initialLyricsStatus,
            lyricsLoadingStartedAt: initialLyrics.isEmpty
                ? DateTime.now().millisecondsSinceEpoch
                : null,
          )
          .toJson();
    }
  }
}

/// Load lyrics for current song asynchronously
/// Uses reverse metadata search for Bilibili songs
Future<void> loadLyricsForCurrentSong(
  WidgetRef ref,
  Map<String, dynamic> song, {
  required int requestSerial,
  required int lyricsSerial,
}) async {
  final requestedTrack = PlaybackTrack.fromJson(song);
  print('[PlaybackActions] 开始加载歌词: ${requestedTrack.title}');

  try {
    final musicService = ref.read(musicServiceProvider);
    final lyrics = await musicService
        .getLyrics(song)
        .timeout(lyricsLoadTimeout);

    if (requestSerial != playbackRequestSerial ||
        lyricsSerial != lyricsRequestSerial) {
      print('[PlaybackActions] 歌词请求已过期，放弃更新');
      return;
    }

    final current = ref.read(currentSongProvider);
    final currentTrack = current == null
        ? null
        : PlaybackTrack.fromJson(current);
    if (currentTrack == null || !currentTrack.sameSongAs(requestedTrack)) {
      print('[PlaybackActions] 当前歌曲已变化，放弃更新');
      return;
    }

    final currentLyrics = currentTrack.lyrics.trim();
    final resolvedTrack = lyrics.trim().isEmpty
        ? currentTrack.copyWith(
            lyricsStatus: currentLyrics.isNotEmpty
                ? LyricsStatus.loaded
                : LyricsStatus.empty,
            lyricsLoadingStartedAt: null,
            lyricsTimedOutAt: null,
          )
        : currentTrack.withLyricsLoaded(lyrics: lyrics);
    final resolvedSong = resolvedTrack.toJson();

    ref.read(currentSongProvider.notifier).state = resolvedSong;

    if (lyrics.trim().isNotEmpty) {
      musicService.rememberSong(resolvedSong);
      try {
        final library = ref.read(libraryProvider.notifier);
        unawaited(library.updateStoredSong(resolvedSong).catchError((_) {}));
      } on UnimplementedError {
        // Isolated playback tests do not always provide a library store.
      }
    }

    print('[PlaybackActions] 歌词加载成功: ${lyrics.length} 字符');
  } on TimeoutException catch (e) {
    print('[PlaybackActions] 歌词加载超时: $e');

    if (requestSerial != playbackRequestSerial ||
        lyricsSerial != lyricsRequestSerial) {
      return;
    }

    final current = ref.read(currentSongProvider);
    final currentTrack = current == null
        ? null
        : PlaybackTrack.fromJson(current);
    if (currentTrack == null || !currentTrack.sameSongAs(requestedTrack)) {
      return;
    }

    final currentLyrics = currentTrack.lyrics.trim();
    ref.read(currentSongProvider.notifier).state = currentLyrics.isEmpty
        ? currentTrack
              .withLyricsTimeout(
                timedOutAt: DateTime.now().millisecondsSinceEpoch,
              )
              .toJson()
        : currentTrack.withLyricsLoaded().toJson();
  } catch (e) {
    print('[PlaybackActions] 歌词加载失败: $e');

    if (requestSerial != playbackRequestSerial ||
        lyricsSerial != lyricsRequestSerial) {
      return;
    }

    final current = ref.read(currentSongProvider);
    final currentTrack = current == null
        ? null
        : PlaybackTrack.fromJson(current);
    if (currentTrack == null || !currentTrack.sameSongAs(requestedTrack)) {
      return;
    }

    final currentLyrics = currentTrack.lyrics.trim();
    ref.read(currentSongProvider.notifier).state = currentLyrics.isEmpty
        ? currentTrack.withLyricsEmpty().toJson()
        : currentTrack.withLyricsLoaded().toJson();
  }
}
