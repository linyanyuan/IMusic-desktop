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

  test('main and lyrics windows are explicitly resizable and transparent', () {
    final source = File('lib/main.dart').readAsStringSync();
    final manager = File(
      'lib/lyrics_window/lyrics_window_manager.dart',
    ).readAsStringSync();
    final shell = File('lib/desktop/desktop_app_shell.dart').readAsStringSync();
    final runner = File('windows/runner/win32_window.cpp').readAsStringSync();

    expect(source, contains('setResizable(true)'));
    expect(source, contains('setBackgroundColor(const Color(0x00000000))'));
    expect(source, contains('isLyricsWindowArguments'));
    expect(shell, contains('DragToResizeArea'));
    expect(runner, contains('WS_THICKFRAME'));
    expect(manager, contains('_controller!.show()'));
  });
}
