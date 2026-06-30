import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pub_semver/pub_semver.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Public update host. The server maps `/releases` to
/// `/opt/imusic-desktop/releases`.
const defaultUpdateBaseUrl = 'http://60.205.218.90:8787';
const defaultDownloadBaseUrl = '$defaultUpdateBaseUrl/releases';
const updateManifestPath = '/releases/desktop-update.json';

/// Parsed remote update manifest. Field names follow the agreed backend
/// contract (camelCase); fromJson tolerates snake_case as well.
class UpdateManifest {
  final String version;
  final String downloadUrl;
  final String sha256;
  final String changelog;

  const UpdateManifest({
    required this.version,
    required this.downloadUrl,
    required this.sha256,
    required this.changelog,
  });

  factory UpdateManifest.fromJson(Map<String, dynamic> json) {
    String read2(String camel, String snake) {
      final v = json[camel] ?? json[snake];
      return v?.toString() ?? '';
    }

    return UpdateManifest(
      version: read2('version', 'version'),
      downloadUrl: read2('downloadUrl', 'download_url'),
      sha256: read2('sha256', 'sha256'),
      changelog: read2('changelog', 'change_log'),
    );
  }

  bool get isValid =>
      version.isNotEmpty && downloadUrl.isNotEmpty && sha256.isNotEmpty;
}

/// Progress of an in-flight asset download.
class DownloadProgress {
  final int received;
  final int? total;

  const DownloadProgress({required this.received, this.total});

  double? get fraction =>
      total != null && total! > 0 ? received / total! : null;
}

class InstallerLaunchCommand {
  final String executable;
  final List<String> arguments;
  final bool runInShell;

  const InstallerLaunchCommand({
    required this.executable,
    required this.arguments,
    required this.runInShell,
  });
}

String installerFileNameFor(UpdateManifest manifest) {
  final ext = _installerExtension(manifest.downloadUrl);
  final version = manifest.version.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
  final safeVersion = version.isEmpty ? 'unknown' : version;
  return 'imusic-update-$safeVersion$ext';
}

InstallerLaunchCommand installerLaunchCommand(String path) {
  final lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.exe')) {
    return InstallerLaunchCommand(
      executable: path,
      arguments: const [],
      runInShell: false,
    );
  }
  if (lowerPath.endsWith('.msi')) {
    return InstallerLaunchCommand(
      executable: 'msiexec.exe',
      arguments: ['/i', path],
      runInShell: false,
    );
  }
  throw FormatException('Unsupported installer type: $path');
}

String _installerExtension(String downloadUrl) {
  final uri = Uri.tryParse(downloadUrl);
  final path = (uri?.path.isNotEmpty ?? false) ? uri!.path : downloadUrl;
  final lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.exe')) return '.exe';
  if (lowerPath.endsWith('.msi')) return '.msi';
  throw FormatException('Unsupported installer URL: $downloadUrl');
}

/// Whether [remote] is a newer version than [current]. Returns false on
/// unparseable input so a malformed manifest never triggers an update.
bool isUpdateAvailable(String current, String remote) {
  try {
    final cur = Version.parse(current);
    final rem = Version.parse(remote);
    return rem > cur;
  } catch (_) {
    return false;
  }
}

/// Desktop in-app updater: fetch manifest, stream download, verify SHA256,
/// launch the installer.
class UpdateService {
  final Dio _dio;
  final Future<SharedPreferences> Function() _prefsLoader;

  static const _lastCheckKey = 'update_last_check_iso';
  static const _checkInterval = Duration(hours: 24);

  UpdateService({Dio? dio, Future<SharedPreferences> Function()? prefsLoader})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: defaultUpdateBaseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 30),
            ),
          ),
      _prefsLoader = prefsLoader ?? SharedPreferences.getInstance;

  /// Fetch the manifest. Returns null when the auto-check is throttled within
  /// [_checkInterval] (skipped for [manual] = true) or the remote version is
  /// not newer than [currentVersion]. Throws on network/parse errors so the
  /// caller can surface an error state.
  Future<UpdateManifest?> fetchManifest({
    required String currentVersion,
    bool manual = false,
  }) async {
    if (!manual) {
      final prefs = await _prefsLoader();
      final last = prefs.getString(_lastCheckKey);
      if (last != null) {
        final lastAt = DateTime.tryParse(last);
        if (lastAt != null &&
            DateTime.now().difference(lastAt) < _checkInterval) {
          return null;
        }
      }
    }

    final response = await _dio.get<Map<String, dynamic>>(updateManifestPath);
    final json = response.data ?? const {};
    final manifest = UpdateManifest.fromJson(json);
    if (!manifest.isValid) {
      // Record the check so we don't hammer the server on a bad manifest.
      await _markChecked();
      return null;
    }
    await _markChecked();
    if (!isUpdateAvailable(currentVersion, manifest.version)) {
      return null;
    }
    return manifest;
  }

  Future<void> _markChecked() async {
    final prefs = await _prefsLoader();
    await prefs.setString(_lastCheckKey, DateTime.now().toIso8601String());
  }

  /// Stream-download [manifest.downloadUrl] into [savePath], emitting progress.
  /// Resolves relative downloadUrl against the configured [BaseOptions.baseUrl].
  Stream<DownloadProgress> downloadAsset(
    UpdateManifest manifest, {
    required String savePath,
    CancelToken? cancelToken,
  }) {
    final controller = StreamController<DownloadProgress>();
    int lastEmitted = 0;
    _dio
        .download(
          manifest.downloadUrl,
          savePath,
          onReceiveProgress: (received, total) {
            if (received - lastEmitted >= 1 << 20 || received == total) {
              lastEmitted = received;
              controller.add(
                DownloadProgress(received: received, total: total),
              );
            }
          },
          cancelToken: cancelToken,
        )
        .then<void>(
          (_) {
            if (!controller.isClosed) controller.close();
          },
          // onError absorbs the failure into the stream so callers see it
          // via `await for` instead of an unhandled Future error.
          onError: (Object e, StackTrace st) {
            if (!controller.isClosed) controller.addError(e, st);
          },
        );
    return controller.stream;
  }

  /// Verify a downloaded file's SHA256 against the manifest. Streams the file
  /// to avoid loading large installers into memory.
  Future<bool> verifySha256(String path, String expected) async {
    final file = File(path);
    if (!await file.exists()) return false;
    final digest = await _digestOfFile(file);
    final actual = digest.toString();
    // Be lenient about case — backend hex may be upper or lower.
    return actual.toLowerCase() == expected.toLowerCase();
  }

  Future<Digest> _digestOfFile(File file) async {
    final stream = file.openRead();
    return await sha256.bind(stream).first;
  }

  /// Resolve a path for the downloaded installer in the system temp dir.
  Future<String> resolveInstallerPath(UpdateManifest manifest) async {
    final dir = await getTemporaryDirectory();
    return '${dir.path}${Platform.pathSeparator}${installerFileNameFor(manifest)}';
  }

  /// Launch the installer (EXE/MSI) and quit the current process.
  Future<void> launchInstaller(String path) async {
    final command = installerLaunchCommand(path);
    await Process.start(
      command.executable,
      command.arguments,
      runInShell: command.runInShell,
    );
    // Give the installer a moment to take over before we exit.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    exit(0);
  }
}

final updateServiceProvider = Provider<UpdateService>((ref) {
  return UpdateService();
});
