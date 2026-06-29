enum ShortcutScope { inApp, global }

enum ShortcutKey {
  space,
  f,
  p,
  m,
  d,
  arrowLeft,
  arrowRight,
  arrowUp,
  arrowDown,
}

enum ShortcutAction {
  playPauseInApp,
  playPauseGlobal,
  previousTrack,
  nextTrack,
  volumeUp,
  volumeDown,
  mute,
  toggleDesktopLyrics,
  toggleFocusMode,
}

class KeyboardShortcut {
  final bool control;
  final bool alt;
  final bool shift;
  final bool meta;
  final ShortcutKey key;

  const KeyboardShortcut({
    this.control = false,
    this.alt = false,
    this.shift = false,
    this.meta = false,
    required this.key,
  });

  factory KeyboardShortcut.fromJson(Map<String, dynamic> json) {
    return KeyboardShortcut(
      control: json['control'] == true,
      alt: json['alt'] == true,
      shift: json['shift'] == true,
      meta: json['meta'] == true,
      key:
          _enumByName(ShortcutKey.values, json['key']?.toString()) ??
          ShortcutKey.space,
    );
  }

  String get displayLabel {
    final parts = <String>[
      if (control) 'Ctrl',
      if (alt) 'Alt',
      if (shift) 'Shift',
      if (meta) 'Win',
      _keyLabel(key),
    ];
    return parts.join(' + ');
  }

  Map<String, dynamic> toJson() => {
    'control': control,
    'alt': alt,
    'shift': shift,
    'meta': meta,
    'key': key.name,
  };

  int? get windowsVirtualKeyCode {
    return switch (key) {
      ShortcutKey.space => 0x20,
      ShortcutKey.f => 0x46,
      ShortcutKey.p => 0x50,
      ShortcutKey.m => 0x4D,
      ShortcutKey.d => 0x44,
      ShortcutKey.arrowLeft => 0x25,
      ShortcutKey.arrowUp => 0x26,
      ShortcutKey.arrowRight => 0x27,
      ShortcutKey.arrowDown => 0x28,
    };
  }

  @override
  bool operator ==(Object other) {
    return other is KeyboardShortcut &&
        other.control == control &&
        other.alt == alt &&
        other.shift == shift &&
        other.meta == meta &&
        other.key == key;
  }

  @override
  int get hashCode => Object.hash(control, alt, shift, meta, key);
}

class ShortcutDefinition {
  final ShortcutAction action;
  final String title;
  final String description;
  final ShortcutScope scope;
  final KeyboardShortcut defaultShortcut;

  const ShortcutDefinition({
    required this.action,
    required this.title,
    required this.description,
    required this.scope,
    required this.defaultShortcut,
  });
}

class ShortcutSettings {
  final bool globalHotkeysEnabled;
  final Map<ShortcutAction, KeyboardShortcut?> shortcuts;

  const ShortcutSettings({
    this.globalHotkeysEnabled = true,
    required this.shortcuts,
  });

  factory ShortcutSettings.defaults() =>
      ShortcutSettings(shortcuts: defaultShortcutBindings);

  factory ShortcutSettings.fromJson(Map<String, dynamic> json) {
    final defaults = ShortcutSettings.defaults().shortcuts;
    final rawShortcuts = json['shortcuts'];
    final shortcuts = Map<ShortcutAction, KeyboardShortcut?>.from(defaults);

    if (rawShortcuts is Map) {
      for (final entry in rawShortcuts.entries) {
        final action = _enumByName(
          ShortcutAction.values,
          entry.key?.toString(),
        );
        if (action == null) continue;
        final value = entry.value;
        shortcuts[action] = value is Map
            ? KeyboardShortcut.fromJson(value.cast<String, dynamic>())
            : null;
      }
    }

    return ShortcutSettings(
      globalHotkeysEnabled: json['globalHotkeysEnabled'] != false,
      shortcuts: shortcuts,
    );
  }

  KeyboardShortcut? shortcutFor(ShortcutAction action) => shortcuts[action];

  ShortcutSettings copyWith({bool? globalHotkeysEnabled}) {
    return ShortcutSettings(
      globalHotkeysEnabled: globalHotkeysEnabled ?? this.globalHotkeysEnabled,
      shortcuts: Map<ShortcutAction, KeyboardShortcut?>.from(shortcuts),
    );
  }

  ShortcutSettings copyWithShortcut(
    ShortcutAction action,
    KeyboardShortcut? shortcut,
  ) {
    return ShortcutSettings(
      globalHotkeysEnabled: globalHotkeysEnabled,
      shortcuts: {...shortcuts, action: shortcut},
    );
  }

  List<ShortcutAction> conflictingActions(ShortcutAction action) {
    final shortcut = shortcutFor(action);
    final definition = definitionFor(action);
    if (shortcut == null) return const [];

    return shortcutDefinitions
        .where(
          (item) => item.action != action && item.scope == definition.scope,
        )
        .where((item) => shortcutFor(item.action) == shortcut)
        .map((item) => item.action)
        .toList();
  }

  Map<String, dynamic> toJson() => {
    'globalHotkeysEnabled': globalHotkeysEnabled,
    'shortcuts': {
      for (final entry in shortcuts.entries)
        entry.key.name: entry.value?.toJson(),
    },
  };
}

const shortcutDefinitions = [
  ShortcutDefinition(
    action: ShortcutAction.playPauseInApp,
    title: '播放/暂停',
    description: '在应用窗口内控制当前歌曲',
    scope: ShortcutScope.inApp,
    defaultShortcut: KeyboardShortcut(key: ShortcutKey.space),
  ),
  ShortcutDefinition(
    action: ShortcutAction.playPauseGlobal,
    title: '播放/暂停',
    description: '窗口未聚焦时也可控制当前歌曲',
    scope: ShortcutScope.global,
    defaultShortcut: KeyboardShortcut(
      control: true,
      alt: true,
      key: ShortcutKey.p,
    ),
  ),
  ShortcutDefinition(
    action: ShortcutAction.previousTrack,
    title: '上一首',
    description: '播放队列中的上一首歌曲',
    scope: ShortcutScope.global,
    defaultShortcut: KeyboardShortcut(
      control: true,
      alt: true,
      key: ShortcutKey.arrowLeft,
    ),
  ),
  ShortcutDefinition(
    action: ShortcutAction.nextTrack,
    title: '下一首',
    description: '播放队列中的下一首歌曲',
    scope: ShortcutScope.global,
    defaultShortcut: KeyboardShortcut(
      control: true,
      alt: true,
      key: ShortcutKey.arrowRight,
    ),
  ),
  ShortcutDefinition(
    action: ShortcutAction.volumeUp,
    title: '音量增加',
    description: '提高播放器音量',
    scope: ShortcutScope.global,
    defaultShortcut: KeyboardShortcut(
      control: true,
      alt: true,
      key: ShortcutKey.arrowUp,
    ),
  ),
  ShortcutDefinition(
    action: ShortcutAction.volumeDown,
    title: '音量降低',
    description: '降低播放器音量',
    scope: ShortcutScope.global,
    defaultShortcut: KeyboardShortcut(
      control: true,
      alt: true,
      key: ShortcutKey.arrowDown,
    ),
  ),
  ShortcutDefinition(
    action: ShortcutAction.mute,
    title: '静音/取消静音',
    description: '快速切换播放器静音状态',
    scope: ShortcutScope.global,
    defaultShortcut: KeyboardShortcut(
      control: true,
      alt: true,
      key: ShortcutKey.m,
    ),
  ),
  ShortcutDefinition(
    action: ShortcutAction.toggleDesktopLyrics,
    title: '显示/隐藏桌面歌词',
    description: '切换独立桌面歌词窗口',
    scope: ShortcutScope.global,
    defaultShortcut: KeyboardShortcut(
      control: true,
      alt: true,
      key: ShortcutKey.d,
    ),
  ),
  ShortcutDefinition(
    action: ShortcutAction.toggleFocusMode,
    title: '进入/退出专注模式',
    description: '在主界面和专注聆听之间切换',
    scope: ShortcutScope.inApp,
    defaultShortcut: KeyboardShortcut(key: ShortcutKey.f),
  ),
];

const defaultShortcutBindings = <ShortcutAction, KeyboardShortcut?>{
  ShortcutAction.playPauseInApp: KeyboardShortcut(key: ShortcutKey.space),
  ShortcutAction.playPauseGlobal: KeyboardShortcut(
    control: true,
    alt: true,
    key: ShortcutKey.p,
  ),
  ShortcutAction.previousTrack: KeyboardShortcut(
    control: true,
    alt: true,
    key: ShortcutKey.arrowLeft,
  ),
  ShortcutAction.nextTrack: KeyboardShortcut(
    control: true,
    alt: true,
    key: ShortcutKey.arrowRight,
  ),
  ShortcutAction.volumeUp: KeyboardShortcut(
    control: true,
    alt: true,
    key: ShortcutKey.arrowUp,
  ),
  ShortcutAction.volumeDown: KeyboardShortcut(
    control: true,
    alt: true,
    key: ShortcutKey.arrowDown,
  ),
  ShortcutAction.mute: KeyboardShortcut(
    control: true,
    alt: true,
    key: ShortcutKey.m,
  ),
  ShortcutAction.toggleDesktopLyrics: KeyboardShortcut(
    control: true,
    alt: true,
    key: ShortcutKey.d,
  ),
  ShortcutAction.toggleFocusMode: KeyboardShortcut(key: ShortcutKey.f),
};

ShortcutDefinition definitionFor(ShortcutAction action) {
  return shortcutDefinitions.firstWhere((item) => item.action == action);
}

T? _enumByName<T extends Enum>(List<T> values, String? name) {
  if (name == null) return null;
  for (final value in values) {
    if (value.name == name) return value;
  }
  return null;
}

String _keyLabel(ShortcutKey key) {
  return switch (key) {
    ShortcutKey.space => 'Space',
    ShortcutKey.f => 'F',
    ShortcutKey.p => 'P',
    ShortcutKey.m => 'M',
    ShortcutKey.d => 'D',
    ShortcutKey.arrowLeft => 'Left',
    ShortcutKey.arrowRight => 'Right',
    ShortcutKey.arrowUp => 'Up',
    ShortcutKey.arrowDown => 'Down',
  };
}
