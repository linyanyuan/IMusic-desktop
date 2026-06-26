import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('desktop shell uses standalone lyrics window controller', () {
    final shell = File('lib/desktop/desktop_app_shell.dart').readAsStringSync();
    final playerBar = File(
      'lib/desktop/widgets/desktop_player_bar.dart',
    ).readAsStringSync();
    final controller = File(
      'lib/desktop/widgets/desktop_lyrics_window_controller.dart',
    ).readAsStringSync();

    expect(shell, contains('DesktopLyricsWindowController'));
    expect(shell, isNot(contains('const DesktopLyricsOverlay()')));
    expect(playerBar, contains('desktopLyricsWindowOpenProvider'));
    expect(playerBar, isNot(contains('desktopLyricsVisibleProvider')));
    expect(controller, contains('LyricsWindowManager'));
    expect(controller, contains('lyricsWindowActionChannelName'));
    expect(controller, contains('ChannelMode.unidirectional'));
    expect(controller, contains("case 'toggleFavorite':"));
    expect(controller, contains('isFavorite'));
  });
}
