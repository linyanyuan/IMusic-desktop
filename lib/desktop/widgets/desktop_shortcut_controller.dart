import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../playback/playback_actions.dart';
import '../../playback/playback_commands.dart';
import '../../services/app_settings.dart';
import '../../services/global_hotkeys.dart';
import '../../services/shortcut_input.dart';
import '../../services/shortcut_settings.dart';
import '../desktop_app_shell.dart';
import 'desktop_lyrics_window_controller.dart';

class DesktopShortcutController extends ConsumerStatefulWidget {
  final Widget child;

  const DesktopShortcutController({super.key, required this.child});

  @override
  ConsumerState<DesktopShortcutController> createState() =>
      _DesktopShortcutControllerState();
}

class _DesktopShortcutControllerState
    extends ConsumerState<DesktopShortcutController> {
  final FocusNode _focusNode = FocusNode(debugLabel: 'desktop-shortcuts');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _focusNode.requestFocus();
      _configureGlobalHotkeys(ref.read(appSettingsProvider).shortcutSettings);
    });
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(appSettingsProvider).shortcutSettings;

    ref.listen(appSettingsProvider, (_, next) {
      _configureGlobalHotkeys(next.shortcutSettings);
    });

    return Shortcuts(
      shortcuts: _shortcutMap(settings),
      child: Actions(
        actions: {
          _DesktopShortcutIntent: CallbackAction<_DesktopShortcutIntent>(
            onInvoke: (intent) {
              if (!_isEditableFocus()) _handleShortcutAction(intent.action);
              return null;
            },
          ),
        },
        child: Focus(
          focusNode: _focusNode,
          autofocus: true,
          child: widget.child,
        ),
      ),
    );
  }

  void _configureGlobalHotkeys(ShortcutSettings settings) {
    final channel = ref.read(globalHotkeyChannelProvider);
    channel.setHandler(_handleShortcutAction);
    unawaited(channel.register(settings));
  }

  Map<ShortcutActivator, Intent> _shortcutMap(ShortcutSettings settings) {
    final result = <ShortcutActivator, Intent>{};
    for (final definition in shortcutDefinitions) {
      if (definition.scope != ShortcutScope.inApp) continue;
      final shortcut = settings.shortcutFor(definition.action);
      if (shortcut == null) continue;
      result[SingleActivator(
        logicalKeyForShortcut(shortcut.key),
        control: shortcut.control,
        alt: shortcut.alt,
        shift: shortcut.shift,
        meta: shortcut.meta,
      )] = _DesktopShortcutIntent(
        definition.action,
      );
    }
    return result;
  }

  bool _isEditableFocus() {
    final context = FocusManager.instance.primaryFocus?.context;
    if (context == null) return false;
    if (context.widget is EditableText) return true;
    return context.findAncestorWidgetOfExactType<EditableText>() != null;
  }

  void _handleShortcutAction(ShortcutAction action) {
    switch (action) {
      case ShortcutAction.playPauseInApp:
      case ShortcutAction.playPauseGlobal:
        unawaited(togglePlayPause(ref));
      case ShortcutAction.previousTrack:
        unawaited(playPreviousTrack(ref));
      case ShortcutAction.nextTrack:
        unawaited(playNextTrack(ref));
      case ShortcutAction.volumeUp:
        unawaited(stepPlaybackVolume(ref, playbackVolumeStep));
      case ShortcutAction.volumeDown:
        unawaited(stepPlaybackVolume(ref, -playbackVolumeStep));
      case ShortcutAction.mute:
        unawaited(togglePlaybackMute(ref));
      case ShortcutAction.toggleDesktopLyrics:
        _toggleDesktopLyrics();
      case ShortcutAction.toggleFocusMode:
        toggleDeskFocusRoute(ref);
    }
  }

  void _toggleDesktopLyrics() {
    final open = ref.read(desktopLyricsWindowOpenProvider);
    ref.read(desktopLyricsWindowOpenProvider.notifier).state = !open;
    if (!open) requestLyricsForCurrentSong(ref);
  }
}

class _DesktopShortcutIntent extends Intent {
  final ShortcutAction action;

  const _DesktopShortcutIntent(this.action);
}
