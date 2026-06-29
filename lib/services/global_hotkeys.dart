import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'shortcut_settings.dart';

typedef GlobalHotkeyHandler = void Function(ShortcutAction action);

final globalHotkeyChannelProvider = Provider<GlobalHotkeyChannel>((ref) {
  final channel = GlobalHotkeyChannel();
  ref.onDispose(() => unawaited(channel.dispose()));
  return channel;
});

class GlobalHotkeyChannel {
  static const _channel = MethodChannel('imusic/global_hotkeys');
  GlobalHotkeyHandler? _handler;

  GlobalHotkeyChannel() {
    _channel.setMethodCallHandler(_handleMethodCall);
  }

  void setHandler(GlobalHotkeyHandler? handler) {
    _handler = handler;
  }

  Future<void> register(ShortcutSettings settings) async {
    if (!settings.globalHotkeysEnabled) {
      await unregisterAll();
      return;
    }

    final registrations = <Map<String, Object?>>[];
    for (final definition in shortcutDefinitions) {
      if (definition.scope != ShortcutScope.global) continue;
      final shortcut = settings.shortcutFor(definition.action);
      final keyCode = shortcut?.windowsVirtualKeyCode;
      if (shortcut == null || keyCode == null) continue;
      registrations.add({
        'id': definition.action.name,
        'control': shortcut.control,
        'alt': shortcut.alt,
        'shift': shortcut.shift,
        'meta': shortcut.meta,
        'keyCode': keyCode,
      });
    }

    try {
      await _channel.invokeMethod('registerHotkeys', registrations);
    } on MissingPluginException {
      // Widget tests and non-Windows builds do not expose the native channel.
    }
  }

  Future<void> unregisterAll() async {
    try {
      await _channel.invokeMethod('unregisterHotkeys');
    } on MissingPluginException {
      // Widget tests and non-Windows builds do not expose the native channel.
    }
  }

  Future<void> dispose() async {
    _handler = null;
    await unregisterAll();
    _channel.setMethodCallHandler(null);
  }

  Future<dynamic> _handleMethodCall(MethodCall call) async {
    if (call.method != 'hotkeyPressed') return null;
    final action = _actionFromName(call.arguments?.toString());
    if (action != null) _handler?.call(action);
    return null;
  }

  ShortcutAction? _actionFromName(String? name) {
    if (name == null) return null;
    for (final action in ShortcutAction.values) {
      if (action.name == name) return action;
    }
    return null;
  }
}
