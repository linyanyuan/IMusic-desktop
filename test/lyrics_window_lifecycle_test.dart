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
      expect(manager, contains("'width': 760"));
      expect(manager, contains("'height': 112"));
      expect(manager, contains("'title': ''"));
      expect(app, contains("case 'window_close':"));
      expect(app, contains('desktop-lyrics-window-favorite'));
      expect(app, contains("_sendAction('toggleFavorite')"));
      expect(app, contains('lyricsWindowActionChannelName'));
      expect(app, contains('parseLyricLines'));
      expect(controller, contains('closeWindow()'));
      expect(controller, contains('sendLyricsData'));
      // Lock is local to the child window; main-window sync must not reset it.
      expect(app, isNot(contains("_isLocked = args['isLocked']")));
      expect(manager, isNot(contains("'isLocked': isLocked")));
      expect(controller, isNot(contains('isLocked:')));
    },
  );
}
