import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../services/app_settings.dart';
import '../../services/shortcut_input.dart';
import '../../services/shortcut_settings.dart';

class SettingsShortcutsSection extends ConsumerStatefulWidget {
  final DeepVibeColors colors;

  const SettingsShortcutsSection({super.key, required this.colors});

  @override
  ConsumerState<SettingsShortcutsSection> createState() =>
      _SettingsShortcutsSectionState();
}

class _SettingsShortcutsSectionState
    extends ConsumerState<SettingsShortcutsSection> {
  final FocusNode _recordingFocusNode = FocusNode(
    debugLabel: 'shortcut-recorder',
  );
  ShortcutAction? _recordingAction;

  @override
  void dispose() {
    _recordingFocusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(appSettingsProvider).shortcutSettings;
    final c = widget.colors;

    return Focus(
      focusNode: _recordingFocusNode,
      onKeyEvent: (_, event) => _handleRecordingKey(event, settings),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final compact = constraints.maxWidth < 560;
              final title = Text(
                '快捷键',
                style: TextStyle(
                  color: c.textSecondary,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              );
              final controls = Row(
                mainAxisSize: compact ? MainAxisSize.max : MainAxisSize.min,
                children: [
                  if (compact) const Spacer(),
                  Text(
                    '启用全局快捷键',
                    style: TextStyle(color: c.textSecondary, fontSize: 12),
                  ),
                  const SizedBox(width: 6),
                  Transform.scale(
                    scale: 0.82,
                    child: Switch(
                      key: const ValueKey('settings-global-shortcuts-switch'),
                      value: settings.globalHotkeysEnabled,
                      activeThumbColor: c.accent,
                      onChanged: (value) {
                        _save(settings.copyWith(globalHotkeysEnabled: value));
                      },
                    ),
                  ),
                  const SizedBox(width: 4),
                  _ShortcutHeaderButton(
                    key: const ValueKey('settings-shortcuts-reset-button'),
                    icon: Icons.restart_alt_outlined,
                    label: '恢复默认',
                    colors: c,
                    onTap: () => _save(ShortcutSettings.defaults()),
                  ),
                ],
              );

              return Padding(
                padding: const EdgeInsets.only(left: 2, bottom: 8),
                child: compact
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [title, const SizedBox(height: 6), controls],
                      )
                    : Row(children: [title, const Spacer(), controls]),
              );
            },
          ),
          Container(
            decoration: BoxDecoration(
              color: c.surface,
              borderRadius: BorderRadius.circular(kCardRadius),
              border: Border.all(color: c.divider),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _ShortcutGroup(
                  title: '播放控制',
                  actions: const [
                    ShortcutAction.playPauseInApp,
                    ShortcutAction.playPauseGlobal,
                    ShortcutAction.previousTrack,
                    ShortcutAction.nextTrack,
                    ShortcutAction.volumeUp,
                    ShortcutAction.volumeDown,
                    ShortcutAction.mute,
                  ],
                  settings: settings,
                  recordingAction: _recordingAction,
                  colors: c,
                  onEdit: _startRecording,
                ),
                Divider(height: 1, color: c.divider),
                _ShortcutGroup(
                  title: '窗口与歌词',
                  actions: const [
                    ShortcutAction.toggleDesktopLyrics,
                    ShortcutAction.toggleFocusMode,
                  ],
                  settings: settings,
                  recordingAction: _recordingAction,
                  colors: c,
                  onEdit: _startRecording,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _startRecording(ShortcutAction action) {
    setState(() => _recordingAction = action);
    _recordingFocusNode.requestFocus();
  }

  KeyEventResult _handleRecordingKey(
    KeyEvent event,
    ShortcutSettings settings,
  ) {
    final action = _recordingAction;
    if (action == null) return KeyEventResult.ignored;
    if (event is! KeyDownEvent) return KeyEventResult.handled;

    if (event.logicalKey == LogicalKeyboardKey.escape) {
      setState(() => _recordingAction = null);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.backspace) {
      _save(settings.copyWithShortcut(action, null));
      setState(() => _recordingAction = null);
      return KeyEventResult.handled;
    }

    final shortcut = shortcutFromKeyEvent(event);
    if (shortcut == null) return KeyEventResult.handled;
    _save(settings.copyWithShortcut(action, shortcut));
    setState(() => _recordingAction = null);
    return KeyEventResult.handled;
  }

  void _save(ShortcutSettings value) {
    ref.read(appSettingsProvider.notifier).setShortcutSettings(value);
  }
}

class _ShortcutHeaderButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final DeepVibeColors colors;
  final VoidCallback onTap;

  const _ShortcutHeaderButton({
    super.key,
    required this.icon,
    required this.label,
    required this.colors,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 15),
      label: Text(label),
      style:
          TextButton.styleFrom(
            foregroundColor: colors.textSecondary,
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
            minimumSize: const Size(0, 30),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(6),
            ),
          ).copyWith(
            overlayColor: WidgetStatePropertyAll(
              colors.accent.withValues(alpha: 0.08),
            ),
          ),
    );
  }
}

class _ShortcutGroup extends StatelessWidget {
  final String title;
  final List<ShortcutAction> actions;
  final ShortcutSettings settings;
  final ShortcutAction? recordingAction;
  final DeepVibeColors colors;
  final ValueChanged<ShortcutAction> onEdit;

  const _ShortcutGroup({
    required this.title,
    required this.actions,
    required this.settings,
    required this.recordingAction,
    required this.colors,
    required this.onEdit,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
          child: Text(
            title,
            style: TextStyle(
              color: colors.textMuted,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        for (var i = 0; i < actions.length; i++) ...[
          if (i > 0)
            Padding(
              padding: const EdgeInsets.only(left: 60),
              child: Divider(height: 1, color: colors.divider),
            ),
          _ShortcutRow(
            definition: definitionFor(actions[i]),
            shortcut: settings.shortcutFor(actions[i]),
            conflicts: settings.conflictingActions(actions[i]),
            isRecording: recordingAction == actions[i],
            colors: colors,
            onEdit: () => onEdit(actions[i]),
          ),
        ],
      ],
    );
  }
}

class _ShortcutRow extends StatelessWidget {
  final ShortcutDefinition definition;
  final KeyboardShortcut? shortcut;
  final List<ShortcutAction> conflicts;
  final bool isRecording;
  final DeepVibeColors colors;
  final VoidCallback onEdit;

  const _ShortcutRow({
    required this.definition,
    required this.shortcut,
    required this.conflicts,
    required this.isRecording,
    required this.colors,
    required this.onEdit,
  });

  @override
  Widget build(BuildContext context) {
    final conflictText = conflicts
        .map((action) => definitionFor(action).title)
        .join('、');

    return Container(
      constraints: const BoxConstraints(minHeight: 58),
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 620;
          final titleBlock = Row(
            children: [
              Container(
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: colors.background.withValues(alpha: 0.7),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Icon(
                  _iconFor(definition.action),
                  color: colors.textSecondary,
                  size: 16,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      definition.title,
                      style: TextStyle(
                        color: colors.textPrimary,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      definition.description,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: colors.textMuted, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ],
          );

          final controls = Row(
            mainAxisSize: compact ? MainAxisSize.max : MainAxisSize.min,
            children: [
              if (compact) const Spacer(),
              _ScopePill(scope: definition.scope, colors: colors),
              const SizedBox(width: 10),
              _Keycap(
                key: ValueKey('settings-shortcut-${definition.action.name}'),
                label: isRecording
                    ? '按下新的快捷键'
                    : shortcut?.displayLabel ?? '未设置',
                active: isRecording,
                muted: shortcut == null,
                colors: colors,
                onTap: onEdit,
              ),
              const SizedBox(width: 4),
              IconButton(
                tooltip: '编辑快捷键',
                icon: const Icon(Icons.edit_outlined, size: 17),
                onPressed: onEdit,
                visualDensity: VisualDensity.compact,
                color: colors.textSecondary,
              ),
            ],
          );

          return Column(
            children: [
              if (compact) ...[
                titleBlock,
                const SizedBox(height: 8),
                controls,
              ] else
                Row(
                  children: [
                    Expanded(child: titleBlock),
                    controls,
                  ],
                ),
              if (conflicts.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(left: 40, top: 6),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      '已与 $conflictText 冲突',
                      style: TextStyle(
                        color: Colors.red.shade400,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _ScopePill extends StatelessWidget {
  final ShortcutScope scope;
  final DeepVibeColors colors;

  const _ScopePill({required this.scope, required this.colors});

  @override
  Widget build(BuildContext context) {
    final global = scope == ShortcutScope.global;
    return Container(
      width: 52,
      height: 24,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: global
            ? colors.accent.withValues(alpha: 0.12)
            : colors.background.withValues(alpha: 0.76),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: global ? Colors.transparent : colors.divider),
      ),
      child: Text(
        global ? '全局' : '应用内',
        style: TextStyle(
          color: global ? colors.accent : colors.textSecondary,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _Keycap extends StatelessWidget {
  final String label;
  final bool active;
  final bool muted;
  final DeepVibeColors colors;
  final VoidCallback onTap;

  const _Keycap({
    super.key,
    required this.label,
    required this.active,
    required this.muted,
    required this.colors,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(6),
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minWidth: 108, maxWidth: 150),
        height: 30,
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          color: active
              ? colors.accent.withValues(alpha: 0.12)
              : colors.background.withValues(alpha: 0.74),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: active ? colors.accent : colors.divider),
        ),
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: muted
                ? colors.textMuted
                : active
                ? colors.accent
                : colors.textPrimary,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

IconData _iconFor(ShortcutAction action) {
  return switch (action) {
    ShortcutAction.playPauseInApp ||
    ShortcutAction.playPauseGlobal => Icons.play_arrow,
    ShortcutAction.previousTrack => Icons.skip_previous,
    ShortcutAction.nextTrack => Icons.skip_next,
    ShortcutAction.volumeUp => Icons.volume_up,
    ShortcutAction.volumeDown => Icons.volume_down,
    ShortcutAction.mute => Icons.volume_off,
    ShortcutAction.toggleDesktopLyrics => Icons.lyrics_outlined,
    ShortcutAction.toggleFocusMode => Icons.center_focus_strong_outlined,
  };
}
