import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:audioplayers/audioplayers.dart';
import 'playback_providers.dart';
import '../services/music_service.dart';
import '../services/library_service.dart';
import '../services/app_settings.dart';
import '../services/audio_cache_service.dart';
import '../core/models/song.dart';

/// Request serial numbers to prevent old requests from overwriting new ones
int playbackRequestSerial = 0;
int lyricsRequestSerial = 0;

/// Lyrics status constants
const lyricsStatusLoading = 'loading';
const lyricsStatusLoaded = 'loaded';
const lyricsStatusEmpty = 'empty';
const lyricsStatusTimeout = 'timeout';
const lyricsTimeoutAtKey = 'lyricsTimedOutAt';
const lyricsLoadingStartedAtKey = 'lyricsLoadingStartedAt';
Duration lyricsLoadTimeout = const Duration(seconds: 15);
Duration lyricsTimeoutNoticeDuration = const Duration(seconds: 6);

bool shouldShowLyricsTimeoutNotice(
  Map<String, dynamic>? song, {
  DateTime? now,
}) {
  if (song == null || song['lyricsStatus']?.toString() != lyricsStatusTimeout) {
    return false;
  }

  final timeoutAt = int.tryParse(song[lyricsTimeoutAtKey]?.toString() ?? '');
  if (timeoutAt == null) return true;

  final elapsed = (now ?? DateTime.now()).millisecondsSinceEpoch - timeoutAt;
  return elapsed < lyricsTimeoutNoticeDuration.inMilliseconds;
}

bool isLyricsLoadingExpired(Map<String, dynamic>? song, {DateTime? now}) {
  if (song == null || song['lyricsStatus']?.toString() != lyricsStatusLoading) {
    return false;
  }
  final startedAt = int.tryParse(
    song[lyricsLoadingStartedAtKey]?.toString() ?? '',
  );
  if (startedAt == null) return false;
  final elapsed = (now ?? DateTime.now()).millisecondsSinceEpoch - startedAt;
  return elapsed >= lyricsLoadTimeout.inMilliseconds;
}

void requestLyricsForCurrentSong(WidgetRef ref) {
  final song = ref.read(currentSongProvider);
  if (song == null) return;

  final lyrics = song['lyrics']?.toString().trim() ?? '';
  if (lyrics.isNotEmpty) return;

  final lyricSerial = ++lyricsRequestSerial;
  ref.read(currentSongProvider.notifier).state = {
    ...song,
    'lyricsStatus': lyricsStatusLoading,
    lyricsLoadingStartedAtKey: DateTime.now().millisecondsSinceEpoch,
    lyricsTimeoutAtKey: null,
  };

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

  // Check if song already has lyrics
  final initialLyrics = song['lyrics']?.toString().trim() ?? '';
  final initialLyricsStatus = initialLyrics.isEmpty
      ? lyricsStatusLoading
      : lyricsStatusLoaded;
  var previousPlaybackStopped = false;

  void showRequestedSongLoading() {
    ref.read(playbackQueueProvider.notifier).state = queue;
    ref.read(currentSongIndexProvider.notifier).state = index;
    ref.read(currentSongProvider.notifier).state = {
      ...song,
      'status': 'loading',
      'lyricsStatus': initialLyricsStatus,
      lyricsLoadingStartedAtKey: initialLyrics.isEmpty
          ? DateTime.now().millisecondsSinceEpoch
          : null,
      lyricsTimeoutAtKey: null,
    };
  }

  // Always show loading immediately (including the first click after launch).
  showRequestedSongLoading();

  try {
    // Stop current audio first so rapid clicks feel responsive.
    final player = ref.read(audioPlayerProvider);
    await player.stop();
    previousPlaybackStopped = true;
    if (requestSerial != playbackRequestSerial) return;

    // Remember songs for cache
    final musicService = ref.read(musicServiceProvider);
    musicService.rememberSongs(queue);
    musicService.rememberSongs([song]);

    // Get playback URL
    final songId = song['id'].toString();
    final playUrl = await musicService.getPlayUrl(songId);

    // Check if this request is still current
    if (requestSerial != playbackRequestSerial) return;

    // Prefer cached metadata (e.g. GDStudio coverUrl filled after search/play).
    final cachedSong = musicService.getCachedSongMap(songId);
    final songWithMeta = {
      if (cachedSong != null) ...cachedSong,
      ...song,
      if ((song['coverUrl']?.toString().trim().isEmpty ?? true) &&
          (cachedSong?['coverUrl']?.toString().trim().isNotEmpty ?? false))
        'coverUrl': cachedSong!['coverUrl'],
    };

    // Windows audioplayers doesn't support custom headers.
    // Download to a stable local cache file if headers are required (Bilibili).
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
    if (requestSerial != playbackRequestSerial) return;

    // Start playback; do not let a hung resume leave the UI on "loading"
    // forever if the engine already moved on.
    try {
      await player.resume().timeout(const Duration(seconds: 8));
    } on TimeoutException {
      print('[PlaybackActions] resume 超时，继续以当前播放器状态收尾');
    }
    if (requestSerial != playbackRequestSerial) return;

    // Merge lyrics: prefer PlaybackUrl.lyrics > currentSong.lyrics > initialLyrics
    final current = ref.read(currentSongProvider);
    final currentLyrics = current?['id']?.toString() == song['id']?.toString()
        ? (current?['lyrics']?.toString() ?? '')
        : '';
    final resolvedLyrics = playUrl.lyrics.trim().isNotEmpty
        ? playUrl.lyrics
        : currentLyrics.trim().isNotEmpty
        ? currentLyrics
        : initialLyrics;

    // Build enriched song data — flip status off loading as soon as we resume.
    final enriched = {
      ...songWithMeta,
      'status': 'playing',
      'playUrl': playUrl.url,
      'lyrics': resolvedLyrics,
      'lyricsStatus': resolvedLyrics.trim().isEmpty
          ? lyricsStatusLoading
          : lyricsStatusLoaded,
      lyricsLoadingStartedAtKey: resolvedLyrics.trim().isEmpty
          ? DateTime.now().millisecondsSinceEpoch
          : null,
      lyricsTimeoutAtKey: null,
      if (playUrl.resolvedId.isNotEmpty) 'playbackId': playUrl.resolvedId,
      if (playUrl.coverUrl.trim().isNotEmpty) 'coverUrl': playUrl.coverUrl,
    };

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
      ref.read(currentSongProvider.notifier).state = {
        ...song,
        'status': 'error',
        'lyricsStatus': initialLyricsStatus,
        lyricsLoadingStartedAtKey: initialLyrics.isEmpty
            ? DateTime.now().millisecondsSinceEpoch
            : null,
        lyricsTimeoutAtKey: null,
      };
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
  print('[PlaybackActions] 开始加载歌词: ${song['title']}');

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
    if (current == null ||
        current['id']?.toString() != song['id']?.toString()) {
      print('[PlaybackActions] 当前歌曲已变化，放弃更新');
      return;
    }

    final currentLyrics = current['lyrics']?.toString().trim() ?? '';
    final resolvedSong = {
      ...current,
      if (lyrics.trim().isNotEmpty) 'lyrics': lyrics,
      'lyricsStatus': lyrics.trim().isEmpty
          ? (currentLyrics.isNotEmpty ? lyricsStatusLoaded : lyricsStatusEmpty)
          : lyricsStatusLoaded,
      lyricsLoadingStartedAtKey: null,
      lyricsTimeoutAtKey: null,
    };

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
    if (current == null ||
        current['id']?.toString() != song['id']?.toString()) {
      return;
    }

    final currentLyrics = current['lyrics']?.toString().trim() ?? '';
    ref.read(currentSongProvider.notifier).state = {
      ...current,
      'lyricsStatus': currentLyrics.isEmpty
          ? lyricsStatusTimeout
          : lyricsStatusLoaded,
      lyricsLoadingStartedAtKey: null,
      lyricsTimeoutAtKey: currentLyrics.isEmpty
          ? DateTime.now().millisecondsSinceEpoch
          : null,
    };
  } catch (e) {
    print('[PlaybackActions] 歌词加载失败: $e');

    if (requestSerial != playbackRequestSerial ||
        lyricsSerial != lyricsRequestSerial) {
      return;
    }

    final current = ref.read(currentSongProvider);
    if (current == null ||
        current['id']?.toString() != song['id']?.toString()) {
      return;
    }

    final currentLyrics = current['lyrics']?.toString().trim() ?? '';
    ref.read(currentSongProvider.notifier).state = {
      ...current,
      'lyricsStatus': currentLyrics.isEmpty
          ? lyricsStatusEmpty
          : lyricsStatusLoaded,
      lyricsLoadingStartedAtKey: null,
      lyricsTimeoutAtKey: null,
    };
  }
}
