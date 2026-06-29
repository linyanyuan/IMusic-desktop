import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:deepvibe_desktop/services/app_settings.dart';
import 'package:deepvibe_desktop/services/shortcut_settings.dart';

void main() {
  test('default shortcuts match the first keyboard iteration', () {
    final settings = ShortcutSettings.defaults();

    expect(
      settings.shortcutFor(ShortcutAction.playPauseInApp)?.displayLabel,
      'Space',
    );
    expect(
      settings.shortcutFor(ShortcutAction.playPauseGlobal)?.displayLabel,
      'Ctrl + Alt + P',
    );
    expect(
      settings.shortcutFor(ShortcutAction.previousTrack)?.displayLabel,
      'Ctrl + Alt + Left',
    );
    expect(
      settings.shortcutFor(ShortcutAction.nextTrack)?.displayLabel,
      'Ctrl + Alt + Right',
    );
    expect(
      settings.shortcutFor(ShortcutAction.volumeUp)?.displayLabel,
      'Ctrl + Alt + Up',
    );
    expect(
      settings.shortcutFor(ShortcutAction.volumeDown)?.displayLabel,
      'Ctrl + Alt + Down',
    );
    expect(
      settings.shortcutFor(ShortcutAction.mute)?.displayLabel,
      'Ctrl + Alt + M',
    );
    expect(
      settings.shortcutFor(ShortcutAction.toggleDesktopLyrics)?.displayLabel,
      'Ctrl + Alt + D',
    );
    expect(
      settings.shortcutFor(ShortcutAction.toggleFocusMode)?.displayLabel,
      'F',
    );
  });

  test('detects conflicts only within the same shortcut scope', () {
    final settings = ShortcutSettings.defaults().copyWithShortcut(
      ShortcutAction.toggleFocusMode,
      const KeyboardShortcut(key: ShortcutKey.space),
    );

    expect(settings.conflictingActions(ShortcutAction.toggleFocusMode), [
      ShortcutAction.playPauseInApp,
    ]);
    expect(
      settings.conflictingActions(ShortcutAction.playPauseGlobal),
      isEmpty,
    );
  });

  test('serializes custom shortcuts and global enablement', () {
    final settings = ShortcutSettings.defaults()
        .copyWith(globalHotkeysEnabled: false)
        .copyWithShortcut(
          ShortcutAction.mute,
          const KeyboardShortcut(
            control: true,
            alt: true,
            shift: true,
            key: ShortcutKey.m,
          ),
        )
        .copyWithShortcut(ShortcutAction.volumeDown, null);

    final restored = ShortcutSettings.fromJson(settings.toJson());

    expect(restored.globalHotkeysEnabled, isFalse);
    expect(
      restored.shortcutFor(ShortcutAction.mute)?.displayLabel,
      'Ctrl + Alt + Shift + M',
    );
    expect(restored.shortcutFor(ShortcutAction.volumeDown), isNull);
  });

  test('app settings persists shortcut settings', () async {
    SharedPreferences.setMockInitialValues({});
    final notifier = AppSettingsNotifier();
    await Future<void>.delayed(Duration.zero);

    final shortcuts = ShortcutSettings.defaults()
        .copyWith(globalHotkeysEnabled: false)
        .copyWithShortcut(ShortcutAction.toggleFocusMode, null);
    await notifier.setShortcutSettings(shortcuts);

    final restored = AppSettingsNotifier();
    await Future<void>.delayed(Duration.zero);

    expect(restored.state.shortcutSettings.globalHotkeysEnabled, isFalse);
    expect(
      restored.state.shortcutSettings.shortcutFor(
        ShortcutAction.toggleFocusMode,
      ),
      isNull,
    );
  });

  test('app settings persists cache cleanup preferences', () async {
    SharedPreferences.setMockInitialValues({});
    final notifier = AppSettingsNotifier();
    await Future<void>.delayed(Duration.zero);

    await notifier.setCacheAutoCleanupEnabled(false);
    await notifier.setCacheRetentionDays(14);

    final restored = AppSettingsNotifier();
    await Future<void>.delayed(Duration.zero);

    expect(restored.state.cacheAutoCleanupEnabled, isFalse);
    expect(restored.state.cacheRetentionDays, 14);
  });
}
