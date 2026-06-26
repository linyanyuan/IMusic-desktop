import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'lyrics child window owns desktop lyrics UI and sends toolbar actions',
    () {
      final manager = File(
        'lib/lyrics_window/lyrics_window_manager.dart',
      ).readAsStringSync();
      final app = File(
        'lib/lyrics_window/lyrics_window_app.dart',
      ).readAsStringSync();
      final controller = File(
        'lib/desktop/widgets/desktop_lyrics_window_controller.dart',
      ).readAsStringSync();

      expect(manager, contains('onWindowsChanged.listen'));
      expect(manager, contains('WindowController.getAll'));
      expect(manager, contains('onClosed'));
      expect(manager, contains('mainWindowId'));
      expect(app, contains("case 'window_close':"));
      expect(app, contains('desktop-lyrics-window-favorite'));
      expect(app, contains("_sendAction('toggleFavorite')"));
      expect(app, contains('lyricsWindowActionChannelName'));
      expect(app, contains('parseLyricLines'));
      expect(controller, contains('closeWindow()'));
      expect(controller, contains('sendLyricsData'));
    },
  );
}
