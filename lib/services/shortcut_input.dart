import 'package:flutter/services.dart';

import 'shortcut_settings.dart';

KeyboardShortcut? shortcutFromKeyEvent(KeyEvent event) {
  final key = shortcutKeyFromLogicalKey(event.logicalKey);
  if (key == null) return null;

  return KeyboardShortcut(
    control:
        HardwareKeyboard.instance.isControlPressed ||
        event.logicalKey == LogicalKeyboardKey.controlLeft ||
        event.logicalKey == LogicalKeyboardKey.controlRight,
    alt:
        HardwareKeyboard.instance.isAltPressed ||
        event.logicalKey == LogicalKeyboardKey.altLeft ||
        event.logicalKey == LogicalKeyboardKey.altRight,
    shift:
        HardwareKeyboard.instance.isShiftPressed ||
        event.logicalKey == LogicalKeyboardKey.shiftLeft ||
        event.logicalKey == LogicalKeyboardKey.shiftRight,
    meta:
        HardwareKeyboard.instance.isMetaPressed ||
        event.logicalKey == LogicalKeyboardKey.metaLeft ||
        event.logicalKey == LogicalKeyboardKey.metaRight,
    key: key,
  );
}

ShortcutKey? shortcutKeyFromLogicalKey(LogicalKeyboardKey key) {
  if (key == LogicalKeyboardKey.space) return ShortcutKey.space;
  if (key == LogicalKeyboardKey.keyF) return ShortcutKey.f;
  if (key == LogicalKeyboardKey.keyP) return ShortcutKey.p;
  if (key == LogicalKeyboardKey.keyM) return ShortcutKey.m;
  if (key == LogicalKeyboardKey.keyD) return ShortcutKey.d;
  if (key == LogicalKeyboardKey.arrowLeft) return ShortcutKey.arrowLeft;
  if (key == LogicalKeyboardKey.arrowRight) return ShortcutKey.arrowRight;
  if (key == LogicalKeyboardKey.arrowUp) return ShortcutKey.arrowUp;
  if (key == LogicalKeyboardKey.arrowDown) return ShortcutKey.arrowDown;
  return null;
}

LogicalKeyboardKey logicalKeyForShortcut(ShortcutKey key) {
  return switch (key) {
    ShortcutKey.space => LogicalKeyboardKey.space,
    ShortcutKey.f => LogicalKeyboardKey.keyF,
    ShortcutKey.p => LogicalKeyboardKey.keyP,
    ShortcutKey.m => LogicalKeyboardKey.keyM,
    ShortcutKey.d => LogicalKeyboardKey.keyD,
    ShortcutKey.arrowLeft => LogicalKeyboardKey.arrowLeft,
    ShortcutKey.arrowRight => LogicalKeyboardKey.arrowRight,
    ShortcutKey.arrowUp => LogicalKeyboardKey.arrowUp,
    ShortcutKey.arrowDown => LogicalKeyboardKey.arrowDown,
  };
}
