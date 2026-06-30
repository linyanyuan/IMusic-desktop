import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../services/update_service.dart';

/// State of the in-app update flow.
sealed class UpdateCheckState {
  const UpdateCheckState();
}

class UpdateIdle extends UpdateCheckState {
  const UpdateIdle();
}

class UpdateChecking extends UpdateCheckState {
  const UpdateChecking();
}

class UpdateUpToDate extends UpdateCheckState {
  const UpdateUpToDate();
}

class UpdateAvailable extends UpdateCheckState {
  final UpdateManifest manifest;
  const UpdateAvailable(this.manifest);
}

class UpdateDownloading extends UpdateCheckState {
  final int received;
  final int? total;
  const UpdateDownloading({required this.received, this.total});
}

class UpdateDownloaded extends UpdateCheckState {
  final String filePath;
  final UpdateManifest manifest;
  const UpdateDownloaded({required this.filePath, required this.manifest});
}

class UpdateError extends UpdateCheckState {
  final String message;
  const UpdateError(this.message);
}

class UpdateCheckNotifier extends StateNotifier<UpdateCheckState> {
  UpdateCheckNotifier(this._service) : super(const UpdateIdle());

  final UpdateService _service;

  CancelToken? _cancelToken;
  String? _currentVersion;

  Future<String> _readCurrentVersion() async {
    if (_currentVersion != null) return _currentVersion!;
    final info = await PackageInfo.fromPlatform();
    _currentVersion = '${info.version}+${info.buildNumber}';
    return _currentVersion!;
  }

  /// Trigger a check. [manual] bypasses the 24h throttle and surfaces errors
  /// to the UI; auto-checks fail silently to idle.
  Future<void> checkForUpdates({bool manual = false}) async {
    if (state is UpdateChecking) return;
    state = const UpdateChecking();
    try {
      final current = await _readCurrentVersion();
      final manifest = await _service.fetchManifest(
        currentVersion: current,
        manual: manual,
      );
      if (manifest != null) {
        state = UpdateAvailable(manifest);
      } else if (manual) {
        state = const UpdateUpToDate();
      } else {
        state = const UpdateIdle();
      }
    } catch (e) {
      if (manual) {
        state = UpdateError(_describe(e));
      } else {
        state = const UpdateIdle();
      }
    }
  }

  Future<void> startDownload() async {
    final available = state;
    if (available is! UpdateAvailable) return;
    final savePath = await _service.resolveInstallerPath(available.manifest);
    final cancelToken = CancelToken();
    _cancelToken = cancelToken;
    state = const UpdateDownloading(received: 0, total: null);
    try {
      await for (final progress in _service.downloadAsset(
        available.manifest,
        savePath: savePath,
        cancelToken: cancelToken,
      )) {
        state = UpdateDownloading(
          received: progress.received,
          total: progress.total,
        );
      }
      final ok = await _service.verifySha256(
        savePath,
        available.manifest.sha256,
      );
      if (!ok) {
        state = const UpdateError('安装包校验失败，请稍后重试');
        return;
      }
      state = UpdateDownloaded(
        filePath: savePath,
        manifest: available.manifest,
      );
    } catch (e) {
      if (cancelToken.isCancelled ||
          (e is DioException && e.type == DioExceptionType.cancel)) {
        state = const UpdateIdle();
      } else {
        state = UpdateError(_describe(e));
      }
    } finally {
      if (identical(_cancelToken, cancelToken)) {
        _cancelToken = null;
      }
    }
  }

  Future<void> installAndQuit() async {
    final downloaded = state;
    if (downloaded is! UpdateDownloaded) return;
    await _service.launchInstaller(downloaded.filePath);
  }

  void dismiss() {
    _cancelToken?.cancel();
    state = const UpdateIdle();
  }

  static String _describe(Object e) {
    if (e is DioException) {
      return e.error != null ? '网络错误：${e.error}' : '网络错误：${e.message ?? '未知'}';
    }
    return '更新失败：$e';
  }
}

final updateCheckStateProvider =
    StateNotifierProvider<UpdateCheckNotifier, UpdateCheckState>((ref) {
      return UpdateCheckNotifier(ref.read(updateServiceProvider));
    });

/// Single cached source of the running app's version + build number, used by
/// the settings "关于" section. Format `version+buildNumber` (e.g. 1.0.0+1).
final currentVersionProvider = FutureProvider<String>((ref) async {
  final info = await PackageInfo.fromPlatform();
  return '${info.version}+${info.buildNumber}';
});

/// Top-level update actions, mirroring the style of playback_actions.dart.
class UpdateActions {
  const UpdateActions._();

  static Future<void> checkForUpdates(WidgetRef ref, {bool manual = false}) {
    return ref
        .read(updateCheckStateProvider.notifier)
        .checkForUpdates(manual: manual);
  }

  static Future<void> downloadUpdate(WidgetRef ref) {
    return ref.read(updateCheckStateProvider.notifier).startDownload();
  }

  static Future<void> installAndQuit(WidgetRef ref) {
    return ref.read(updateCheckStateProvider.notifier).installAndQuit();
  }

  static void dismissUpdate(WidgetRef ref) {
    ref.read(updateCheckStateProvider.notifier).dismiss();
  }
}
