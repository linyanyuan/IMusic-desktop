import 'dart:async';
import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'playback_providers.dart';
import '../services/music_service.dart';
import '../services/library_service.dart';
import '../services/app_settings.dart';
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

  // Write queue and current song immediately
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

  try {
    // Remember songs for cache
    final musicService = ref.read(musicServiceProvider);
    musicService.rememberSongs(queue);
    musicService.rememberSongs([song]);

    // Get playback URL
    final playUrl = await musicService.getPlayUrl(song['id'].toString());

    // Check if this request is still current
    if (requestSerial != playbackRequestSerial) return;

    // Load and play audio
    final player = ref.read(audioPlayerProvider);
    await player.stop();

    // Windows audioplayers doesn't support custom headers
    // Download to temp file if headers are required
    String sourceUrl = playUrl.url;
    if (playUrl.headers.isNotEmpty) {
      print('[PlaybackActions] 检测到需要 headers，下载到临时文件');
      try {
        final configuredCacheDir = ref
            .read(appSettingsProvider)
            .cacheDirectory
            .trim();
        final tempDir = configuredCacheDir.isEmpty
            ? await getTemporaryDirectory()
            : await Directory(configuredCacheDir).create(recursive: true);
        final fileName = 'audio_${DateTime.now().millisecondsSinceEpoch}.m4s';
        final tempFile = File('${tempDir.path}/$fileName');

        final dio = Dio();
        await dio.download(
          playUrl.url,
          tempFile.path,
          options: Options(headers: playUrl.headers),
        );

        sourceUrl = tempFile.path;
        print('[PlaybackActions] 下载完成: $sourceUrl');
      } catch (e) {
        print('[PlaybackActions] 下载失败: $e');
        throw Exception('下载音频失败: $e');
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
    final currentLyrics = current?['lyrics']?.toString() ?? '';
    final resolvedLyrics = playUrl.lyrics.trim().isNotEmpty
        ? playUrl.lyrics
        : currentLyrics.trim().isNotEmpty
        ? currentLyrics
        : initialLyrics;

    // Build enriched song data
    final enriched = {
      ...song,
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
    };

    // Update providers
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
    // Revert to previous state on error
    final current = ref.read(currentSongProvider);
    if (current != null && requestSerial == playbackRequestSerial) {
      ref.read(currentSongProvider.notifier).state = {
        ...current,
        'status': 'error',
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
