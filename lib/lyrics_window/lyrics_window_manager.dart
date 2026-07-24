import 'dart:async';
import 'package:desktop_multi_window/desktop_multi_window.dart';

/// Manages the lifecycle of the separate lyrics child window.
class LyricsWindowManager {
  LyricsWindowManager({this.onClosed});

  final void Function()? onClosed;

  WindowController? _controller;
  String? _windowId;
  Timer? _positionSyncTimer;
  StreamSubscription<void>? _windowsChangedSub;
  int _lastPositionMs = 0;
  String? _mainWindowId;

  /// Whether the separate lyrics window is currently open.
  bool get isOpen => _controller != null && _windowId != null;

  /// Create and show a separate lyrics window.
  Future<void> openWindow() async {
    if (isOpen) return;

    final mainWindowId = await _currentWindowId();
    _mainWindowId = mainWindowId;
    _controller = await WindowController.create(
      WindowConfiguration(
        arguments: mainWindowId == null
            ? 'lyrics'
            : '{"type":"lyrics","mainWindowId":"$mainWindowId"}',
        hiddenAtLaunch: true,
      ),
    );
    _windowId = _controller!.windowId;
    _listenForWindowClose();

    await _setWindowStyle();
    await _controller!.show();
  }

  Future<String?> _currentWindowId() async {
    try {
      return (await WindowController.fromCurrentEngine()).windowId;
    } catch (_) {
      return null;
    }
  }

  void _listenForWindowClose() {
    _windowsChangedSub?.cancel();
    _windowsChangedSub = onWindowsChanged.listen((_) async {
      final windowId = _windowId;
      if (windowId == null) return;

      try {
        final windows = await WindowController.getAll();
        final stillOpen = windows.any((window) => window.windowId == windowId);
        if (!stillOpen) _clearWindow(notify: true);
      } catch (_) {}
    });
  }

  Future<void> _setWindowStyle() async {
    try {
      await _controller!.invokeMethod('window_setFrame', {
        'frame': {'left': 100, 'top': 100, 'width': 760, 'height': 112},
      });
      await _controller!.invokeMethod('window_setTitle', {'title': ''});
      await _controller!.invokeMethod('window_setAlwaysOnTop', {
        'alwaysOnTop': true,
      });
    } catch (_) {
      // These are best-effort; the window still works without them.
    }
  }

  /// Send lyrics data to the child window.
  ///
  /// Does not include lock state — the child owns drag-lock as local UI state.
  Future<void> sendLyricsData({
    required String lyricsText,
    required int positionMs,
    required double fontSize,
    required int colorValue,
    required bool isPlaying,
    required bool isFavorite,
    required bool canFavorite,
  }) async {
    if (_windowId == null) return;
    try {
      final controller = WindowController.fromWindowId(_windowId!);
      await controller.invokeMethod('lyricsData', {
        'lyricsText': lyricsText,
        'positionMs': positionMs,
        'fontSize': fontSize,
        'colorValue': colorValue,
        'isPlaying': isPlaying,
        'isFavorite': isFavorite,
        'canFavorite': canFavorite,
        'mainWindowId': _mainWindowId,
      });
    } catch (_) {}
  }

  /// Start periodic position syncing to the lyrics window.
  void startPositionSync() {
    _positionSyncTimer?.cancel();
    _positionSyncTimer = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (_windowId == null) return;
      try {
        final controller = WindowController.fromWindowId(_windowId!);
        controller.invokeMethod('position', {'positionMs': _lastPositionMs});
      } catch (_) {}
    });
  }

  /// Update the cached position (called from the lyrics overlay).
  void updatePosition(int positionMs) {
    _lastPositionMs = positionMs;
  }

  /// Close the separate lyrics window.
  Future<void> closeWindow() async {
    final controller = _controller;
    if (controller != null) {
      try {
        await controller.invokeMethod('window_close');
      } catch (_) {
        try {
          await controller.hide();
        } catch (_) {}
      }
    }
    _clearWindow(notify: true);
  }

  void _clearWindow({required bool notify}) {
    _positionSyncTimer?.cancel();
    _positionSyncTimer = null;
    _windowsChangedSub?.cancel();
    _windowsChangedSub = null;
    _controller = null;
    _windowId = null;
    _mainWindowId = null;
    if (notify) onClosed?.call();
  }

  /// Dispose resources.
  void dispose() {
    _clearWindow(notify: false);
  }
}
