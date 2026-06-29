import 'dart:io';

import 'package:deepvibe_desktop/services/audio_cache_service.dart';
import 'package:deepvibe_desktop/services/music_provider.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'audio cache reuses a stable file for the same playback identity',
    () async {
      final dir = await Directory.systemTemp.createTemp('deepvibe-cache-test-');
      addTearDown(() => dir.delete(recursive: true));
      var downloadCount = 0;
      final service = AudioCacheService(
        downloader: (_, outputPath, headers) async {
          expect(headers['Referer'], 'https://example.test');
          downloadCount += 1;
          await File(outputPath).writeAsString('audio-bytes');
        },
      );

      final first = await service.getOrDownload(
        playUrl: const PlaybackUrl(
          'https://example.test/audio.m4s',
          headers: {'Referer': 'https://example.test'},
          resolvedId: 'bilibili:BVcache:p1',
        ),
        cacheDirectory: dir.path,
      );
      final second = await service.getOrDownload(
        playUrl: const PlaybackUrl(
          'https://example.test/changed.m4s',
          headers: {'Referer': 'https://example.test'},
          resolvedId: 'bilibili:BVcache:p1',
        ),
        cacheDirectory: dir.path,
      );

      expect(first.cacheHit, isFalse);
      expect(second.cacheHit, isTrue);
      expect(second.path, first.path);
      expect(downloadCount, 1);
    },
  );

  test('audio cache cleanup only removes generated audio files', () async {
    final dir = await Directory.systemTemp.createTemp('deepvibe-cache-clean-');
    addTearDown(() => dir.delete(recursive: true));
    final audio = File('${dir.path}${Platform.pathSeparator}audio_old.m4s');
    final partial = File(
      '${dir.path}${Platform.pathSeparator}audio_new.m4s.part',
    );
    final other = File('${dir.path}${Platform.pathSeparator}notes.txt');
    await audio.writeAsString('old');
    await partial.writeAsString('partial');
    await other.writeAsString('keep');

    final result = await AudioCacheService().clear(dir.path);

    expect(result.fileCount, 2);
    expect(await audio.exists(), isFalse);
    expect(await partial.exists(), isFalse);
    expect(await other.exists(), isTrue);
  });
}
