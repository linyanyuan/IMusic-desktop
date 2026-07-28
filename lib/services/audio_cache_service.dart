import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import 'app_settings.dart';
import 'music_provider.dart';

const int defaultAudioCacheRetentionDays = 7;

typedef AudioDownloader =
    Future<void> Function(
      String url,
      String outputPath,
      Map<String, String> headers,
    );

final audioCacheServiceProvider = Provider<AudioCacheService>((ref) {
  return AudioCacheService();
});

final audioCacheStatsProvider = FutureProvider<AudioCacheStats>((ref) async {
  final settings = ref.watch(appSettingsProvider);
  try {
    return await ref
        .watch(audioCacheServiceProvider)
        .scan(settings.cacheDirectory.trim());
  } catch (_) {
    return const AudioCacheStats(fileCount: 0, totalBytes: 0);
  }
});

class AudioCacheStats {
  final int fileCount;
  final int totalBytes;

  const AudioCacheStats({required this.fileCount, required this.totalBytes});

  String get displaySize => formatCacheSize(totalBytes);
}

class AudioCacheResult {
  final String path;
  final bool cacheHit;

  const AudioCacheResult({required this.path, required this.cacheHit});
}

class AudioCacheCleanupResult {
  final int fileCount;
  final int freedBytes;

  const AudioCacheCleanupResult({
    required this.fileCount,
    required this.freedBytes,
  });

  String get displayFreedSize => formatCacheSize(freedBytes);
}

class AudioCacheService {
  final AudioDownloader _downloader;
  DateTime? _lastAutomaticCleanupAt;

  AudioCacheService({AudioDownloader? downloader})
    : _downloader = downloader ?? _defaultDownloader;

  /// Read-only cache lookup. Returns a usable local path or null.
  /// Does not download.
  Future<String?> findCached({
    required PlaybackUrl playUrl,
    required String cacheDirectory,
  }) async {
    final dir = await _resolveCacheDirectory(cacheDirectory);
    final cacheFile = File(
      _joinPath(dir.path, _cacheFileName(_cacheIdentity(playUrl))),
    );
    if (!await _hasUsableFile(cacheFile)) return null;
    await cacheFile.setLastModified(DateTime.now());
    return cacheFile.path;
  }

  /// Delete the cache entry for [playUrl] if present.
  Future<void> invalidate({
    required PlaybackUrl playUrl,
    required String cacheDirectory,
  }) async {
    final dir = await _resolveCacheDirectory(cacheDirectory);
    final cacheFile = File(
      _joinPath(dir.path, _cacheFileName(_cacheIdentity(playUrl))),
    );
    if (await cacheFile.exists()) {
      await cacheFile.delete();
    }
    final partialFile = File('${cacheFile.path}.part');
    if (await partialFile.exists()) {
      await partialFile.delete();
    }
  }

  Future<AudioCacheResult> getOrDownload({
    required PlaybackUrl playUrl,
    required String cacheDirectory,
  }) async {
    final dir = await _resolveCacheDirectory(cacheDirectory);
    final cacheFile = File(
      _joinPath(dir.path, _cacheFileName(_cacheIdentity(playUrl))),
    );

    if (await _hasUsableFile(cacheFile)) {
      await cacheFile.setLastModified(DateTime.now());
      return AudioCacheResult(path: cacheFile.path, cacheHit: true);
    }

    final partialFile = File('${cacheFile.path}.part');
    if (await partialFile.exists()) {
      await partialFile.delete();
    }

    await _downloader(playUrl.url, partialFile.path, playUrl.headers);
    if (!await _hasUsableFile(partialFile)) {
      if (await partialFile.exists()) await partialFile.delete();
      throw Exception('下载的音频文件为空');
    }

    if (await cacheFile.exists()) {
      await cacheFile.delete();
    }
    await partialFile.rename(cacheFile.path);
    return AudioCacheResult(path: cacheFile.path, cacheHit: false);
  }

  Future<AudioCacheStats> scan(String cacheDirectory) async {
    final dir = await _resolveCacheDirectory(cacheDirectory);
    var count = 0;
    var totalBytes = 0;

    await for (final entity in _cacheFiles(dir)) {
      final stat = await entity.stat();
      count += 1;
      totalBytes += stat.size;
    }

    return AudioCacheStats(fileCount: count, totalBytes: totalBytes);
  }

  Future<AudioCacheCleanupResult> clear(String cacheDirectory) {
    return _deleteMatching(cacheDirectory, shouldDelete: (_) => true);
  }

  Future<AudioCacheCleanupResult> clearExpired(
    String cacheDirectory, {
    int retentionDays = defaultAudioCacheRetentionDays,
  }) {
    final cutoff = DateTime.now().subtract(Duration(days: retentionDays));
    return _deleteMatching(
      cacheDirectory,
      shouldDelete: (stat) => stat.modified.isBefore(cutoff),
    );
  }

  Future<void> cleanupExpiredIfNeeded(AppSettings settings) async {
    if (!settings.cacheAutoCleanupEnabled) return;
    final now = DateTime.now();
    final previous = _lastAutomaticCleanupAt;
    if (previous != null &&
        now.difference(previous) < const Duration(hours: 12)) {
      return;
    }
    _lastAutomaticCleanupAt = now;
    try {
      await clearExpired(
        settings.cacheDirectory.trim(),
        retentionDays: settings.cacheRetentionDays,
      );
    } catch (_) {}
  }

  Future<AudioCacheCleanupResult> _deleteMatching(
    String cacheDirectory, {
    required bool Function(FileStat stat) shouldDelete,
  }) async {
    final dir = await _resolveCacheDirectory(cacheDirectory);
    var count = 0;
    var freedBytes = 0;

    await for (final file in _cacheFiles(dir)) {
      final stat = await file.stat();
      if (!shouldDelete(stat)) continue;
      await file.delete();
      count += 1;
      freedBytes += stat.size;
    }

    return AudioCacheCleanupResult(fileCount: count, freedBytes: freedBytes);
  }

  Stream<File> _cacheFiles(Directory dir) async* {
    if (!await dir.exists()) return;
    await for (final entity in dir.list(followLinks: false)) {
      if (entity is! File) continue;
      final name = _fileName(entity.path);
      if (!name.startsWith('audio_')) continue;
      if (!name.endsWith('.m4s') && !name.endsWith('.m4s.part')) continue;
      yield entity;
    }
  }

  Future<Directory> _resolveCacheDirectory(String configuredPath) async {
    if (configuredPath.trim().isEmpty) return getTemporaryDirectory();
    return Directory(configuredPath.trim()).create(recursive: true);
  }

  Future<bool> _hasUsableFile(File file) async {
    if (!await file.exists()) return false;
    return await file.length() > 0;
  }
}

Future<void> _defaultDownloader(
  String url,
  String outputPath,
  Map<String, String> headers,
) async {
  await Dio().download(url, outputPath, options: Options(headers: headers));
}

String formatCacheSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  final kb = bytes / 1024;
  if (kb < 1024) return '${kb.toStringAsFixed(kb >= 10 ? 0 : 1)} KB';
  final mb = kb / 1024;
  if (mb < 1024) return '${mb.toStringAsFixed(mb >= 10 ? 0 : 1)} MB';
  final gb = mb / 1024;
  return '${gb.toStringAsFixed(gb >= 10 ? 0 : 1)} GB';
}

String _cacheIdentity(PlaybackUrl playUrl) {
  return playUrl.resolvedId.trim().isNotEmpty
      ? playUrl.resolvedId.trim()
      : playUrl.url.trim();
}

String _cacheFileName(String identity) {
  final digest = sha1.convert(utf8.encode(identity)).toString();
  return 'audio_$digest.m4s';
}

String _joinPath(String directory, String fileName) {
  final separator = Platform.pathSeparator;
  return directory.endsWith(separator)
      ? '$directory$fileName'
      : '$directory$separator$fileName';
}

String _fileName(String path) {
  final normalized = path.replaceAll('\\', '/');
  final index = normalized.lastIndexOf('/');
  return index < 0 ? normalized : normalized.substring(index + 1);
}
