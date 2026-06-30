import 'dart:async';

import 'package:deepvibe_desktop/services/update_service.dart';
import 'package:deepvibe_desktop/desktop/update/update_providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';

void main() {
  group('isUpdateAvailable', () {
    test('remote newer than current → true', () {
      expect(isUpdateAvailable('1.0.0+1', '1.1.0'), isTrue);
    });

    test('remote equal to current → false', () {
      expect(isUpdateAvailable('1.0.0', '1.0.0'), isFalse);
    });

    test('remote older than current → false', () {
      expect(isUpdateAvailable('1.2.0', '1.1.0'), isFalse);
    });

    test('current with build number still compares by semver core', () {
      // 1.0.0+1 vs 1.0.0 → not newer (pre-release/build ignored by pub_semver >).
      expect(isUpdateAvailable('1.0.0+1', '1.0.0'), isFalse);
      // 1.0.0+1 vs 1.0.1 → newer.
      expect(isUpdateAvailable('1.0.0+1', '1.0.1'), isTrue);
    });

    test('malformed input → false (never throw)', () {
      expect(isUpdateAvailable('not-a-version', '1.0.0'), isFalse);
      expect(isUpdateAvailable('1.0.0', 'garbage'), isFalse);
      expect(isUpdateAvailable('', ''), isFalse);
    });
  });

  group('UpdateManifest.fromJson', () {
    test('parses camelCase contract', () {
      final m = UpdateManifest.fromJson({
        'version': '1.2.0',
        'downloadUrl': '/releases/imusic.exe',
        'sha256': 'abc123',
        'changelog': 'fixes',
      });
      expect(m.version, '1.2.0');
      expect(m.downloadUrl, '/releases/imusic.exe');
      expect(m.sha256, 'abc123');
      expect(m.changelog, 'fixes');
      expect(m.isValid, isTrue);
    });

    test('parses snake_case fallbacks', () {
      final m = UpdateManifest.fromJson({
        'version': '1.2.0',
        'download_url': '/x.exe',
        'sha256': 'deadbeef',
        'change_log': 'notes',
      });
      expect(m.downloadUrl, '/x.exe');
      expect(m.changelog, 'notes');
    });

    test('empty required fields → isValid false', () {
      final m = UpdateManifest.fromJson({
        'version': '',
        'downloadUrl': '',
        'sha256': '',
        'changelog': '',
      });
      expect(m.isValid, isFalse);
    });
  });

  group('release endpoint', () {
    test('uses the static releases manifest path', () {
      expect(updateManifestPath, '/releases/desktop-update.json');
      expect(defaultUpdateBaseUrl, 'http://60.205.218.90:8787');
      expect(defaultDownloadBaseUrl, 'http://60.205.218.90:8787/releases');
    });
  });

  group('installer safety', () {
    test('uses a fixed local file name for exe installers', () {
      final m = UpdateManifest.fromJson({
        'version': '1.2.0',
        'downloadUrl': 'http://example.test/releases/evil name.exe?x=1&y=2',
        'sha256': 'abc123',
      });

      expect(installerFileNameFor(m), 'imusic-update-1.2.0.exe');
    });

    test('uses a fixed local file name for zip update packages', () {
      final m = UpdateManifest.fromJson({
        'version': '1.2.0',
        'downloadUrl': 'http://example.test/releases/imusic-1.2.0.zip',
        'sha256': 'abc123',
      });

      expect(installerFileNameFor(m), 'imusic-update-1.2.0.zip');
    });

    test('builds installer launch commands without using the shell', () {
      final exe = installerLaunchCommand(r'C:\Temp\imusic-update-1.2.0.exe');
      expect(exe.executable, r'C:\Temp\imusic-update-1.2.0.exe');
      expect(exe.arguments, isEmpty);
      expect(exe.runInShell, isFalse);

      final msi = installerLaunchCommand(r'C:\Temp\imusic-update-1.2.0.msi');
      expect(msi.executable, 'msiexec.exe');
      expect(msi.arguments, [r'/i', r'C:\Temp\imusic-update-1.2.0.msi']);
      expect(msi.runInShell, isFalse);
    });

    test('builds zip updater commands without using the shell', () {
      final command = zipUpdaterLaunchCommand(
        scriptPath: r'C:\Temp\updater.ps1',
        zipPath: r'C:\Temp\imusic-update-1.2.0.zip',
        targetDir: r'C:\App\IMusic',
        exePath: r'C:\App\IMusic\imusic.exe',
        currentPid: 1234,
      );

      expect(command.executable, 'powershell.exe');
      expect(command.runInShell, isFalse);
      expect(command.arguments, [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        r'C:\Temp\updater.ps1',
        '-ZipPath',
        r'C:\Temp\imusic-update-1.2.0.zip',
        '-TargetDir',
        r'C:\App\IMusic',
        '-ExePath',
        r'C:\App\IMusic\imusic.exe',
        '-CurrentPid',
        '1234',
      ]);
    });

    test('rejects unsupported installer extensions', () {
      final m = UpdateManifest.fromJson({
        'version': '1.2.0',
        'downloadUrl': 'http://example.test/releases/update.7z',
        'sha256': 'abc123',
      });

      expect(() => installerFileNameFor(m), throwsFormatException);
    });
  });

  group('UpdateCheckNotifier', () {
    test('manual 404 check explains missing release manifest', () async {
      PackageInfo.setMockInitialValues(
        appName: 'IMusic',
        packageName: 'imusic',
        version: '1.0.0',
        buildNumber: '1',
        buildSignature: '',
      );
      final notifier = _TestUpdateCheckNotifier(
        _MissingManifestUpdateService(),
      );
      addTearDown(notifier.dispose);

      await notifier.checkForUpdates(manual: true);

      final state = notifier.state;
      expect(state, isA<UpdateError>());
      expect((state as UpdateError).message, contains('未找到更新文件'));
      expect(state.message, contains('/releases/desktop-update.json'));
      expect(state.message, contains('dist\\releases'));
    });

    test('download cancellation returns to idle instead of error', () async {
      final service = _CancellableUpdateService();
      final notifier = _TestUpdateCheckNotifier(service);
      addTearDown(notifier.dispose);

      notifier.setAvailable(_manifest());
      final download = notifier.startDownload();
      await _waitFor(
        () => notifier.state is UpdateDownloading,
        reason: 'download should enter progress state',
      );

      notifier.dismiss();
      await download;

      expect(notifier.state, isA<UpdateIdle>());
    });
  });
}

UpdateManifest _manifest() {
  return UpdateManifest.fromJson({
    'version': '1.2.0',
    'downloadUrl': 'http://example.test/releases/imusic.exe',
    'sha256': 'abc123',
  });
}

class _TestUpdateCheckNotifier extends UpdateCheckNotifier {
  _TestUpdateCheckNotifier(super.service);

  void setAvailable(UpdateManifest manifest) {
    state = UpdateAvailable(manifest);
  }
}

class _CancellableUpdateService extends UpdateService {
  @override
  Future<String> resolveInstallerPath(UpdateManifest manifest) async {
    return r'C:\Temp\imusic-update-1.2.0.exe';
  }

  @override
  Stream<DownloadProgress> downloadAsset(
    UpdateManifest manifest, {
    required String savePath,
    CancelToken? cancelToken,
  }) async* {
    await cancelToken!.whenCancel;
    throw DioException(
      requestOptions: RequestOptions(path: manifest.downloadUrl),
      type: DioExceptionType.cancel,
    );
  }
}

class _MissingManifestUpdateService extends UpdateService {
  @override
  Future<UpdateManifest?> fetchManifest({
    required String currentVersion,
    bool manual = false,
  }) async {
    final request = RequestOptions(
      path: updateManifestPath,
      baseUrl: defaultUpdateBaseUrl,
    );
    throw DioException(
      requestOptions: request,
      response: Response<dynamic>(requestOptions: request, statusCode: 404),
    );
  }
}

Future<void> _waitFor(
  bool Function() predicate, {
  required String reason,
}) async {
  for (var i = 0; i < 20; i++) {
    if (predicate()) return;
    await Future<void>.delayed(Duration.zero);
  }
  fail(reason);
}
