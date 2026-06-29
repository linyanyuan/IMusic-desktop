import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Windows runner disables DWM border and rounded corners', () {
    final source = File('windows/runner/win32_window.cpp').readAsStringSync();

    expect(source, contains('DWMWA_BORDER_COLOR'));
    expect(source, contains('DWMWA_COLOR_NONE'));
    expect(source, contains('DWMWA_WINDOW_CORNER_PREFERENCE'));
    expect(source, contains('DWMWCP_DONOTROUND'));
    expect(
      source,
      contains('DwmSetWindowAttribute(window, DWMWA_WINDOW_CORNER_PREFERENCE'),
    );
  });

  test(
    'main window is resizable and lyrics window is a compact tool layer',
    () {
      final source = File('lib/main.dart').readAsStringSync();
      final manager = File(
        'lib/lyrics_window/lyrics_window_manager.dart',
      ).readAsStringSync();
      final shell = File(
        'lib/desktop/desktop_app_shell.dart',
      ).readAsStringSync();
      final runner = File('windows/runner/win32_window.cpp').readAsStringSync();

      expect(source, contains('setResizable(true)'));
      expect(source, contains('setResizable(false)'));
      expect(source, contains('setBackgroundColor(const Color(0x00000000))'));
      expect(source, contains('skipTaskbar: true'));
      expect(source, isNot(contains('windowManager.focus();\n  });\n}')));
      expect(source, contains('applyLyricsToolWindowStyle'));
      expect(source, contains('isLyricsWindowArguments'));
      expect(shell, contains('DragToResizeArea'));
      expect(runner, contains('WS_THICKFRAME'));
      expect(manager, contains('_controller!.show()'));
    },
  );

  test(
    'Windows runner can turn the lyrics window into a non-activating tool window',
    () {
      final runner = File(
        'windows/runner/flutter_window.cpp',
      ).readAsStringSync();

      expect(runner, contains('imusic/lyrics_window_style'));
      expect(runner, contains('applyLyricsToolWindowStyle'));
      expect(runner, contains('WS_EX_TOOLWINDOW'));
      expect(runner, contains('WS_EX_NOACTIVATE'));
      expect(runner, contains('WS_EX_APPWINDOW'));
      expect(runner, contains('SWP_NOACTIVATE'));
      expect(runner, contains('HWND_TOPMOST'));
    },
  );

  test('Windows runner registers and dispatches global hotkeys', () {
    final header = File('windows/runner/flutter_window.h').readAsStringSync();
    final source = File('windows/runner/flutter_window.cpp').readAsStringSync();

    expect(source, contains('imusic/global_hotkeys'));
    expect(source, contains('registerHotkeys'));
    expect(source, contains('unregisterHotkeys'));
    expect(source, contains('RegisterHotKey'));
    expect(source, contains('UnregisterHotKey'));
    expect(source, contains('WM_HOTKEY'));
    expect(source, contains('hotkeyPressed'));
    expect(header, contains('global_hotkey_channel_'));
  });
}
