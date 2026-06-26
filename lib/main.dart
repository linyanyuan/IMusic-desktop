import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:window_manager/window_manager.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:desktop_multi_window/desktop_multi_window.dart';

import 'app/deepvibe_app.dart';
import 'services/auth_service.dart';
import 'services/library_service.dart';
import 'services/music_service.dart';
import 'lyrics_window/lyrics_window_app.dart';
import 'lyrics_window/lyrics_window_args.dart';

const _lyricsWindowStyleChannel = MethodChannel('imusic/lyrics_window_style');

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  await windowManager.ensureInitialized();

  // Check if this is a child window created by desktop_multi_window
  try {
    final windowController = await WindowController.fromCurrentEngine();
    if (isLyricsWindowArguments(windowController.arguments)) {
      // This is a lyrics child window — render just the lyrics UI
      _configureLyricsWindow();
      runApp(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          color: Colors.transparent,
          home: LyricsWindowApp(
            windowId: windowController.windowId,
            arguments: windowController.arguments,
          ),
        ),
      );
      return;
    }
  } catch (_) {
    // Not a multi-window context, proceed as main window
  }

  // === Main window setup ===
  final prefs = await SharedPreferences.getInstance();

  const windowOptions = WindowOptions(
    size: Size(1440, 900),
    minimumSize: Size(1024, 700),
    center: true,
    backgroundColor: Color(0xFF121417),
    skipTaskbar: false,
    titleBarStyle: TitleBarStyle.hidden,
  );

  windowManager.waitUntilReadyToShow(windowOptions, () async {
    await windowManager.setAsFrameless();
    await windowManager.setResizable(true);
    await windowManager.setHasShadow(false);
    await windowManager.show();
    await windowManager.focus();
  });

  runApp(
    ProviderScope(
      overrides: [
        authProvider.overrideWith(
          (ref) => AuthNotifier(ref.watch(authServiceProvider), prefs, ref),
        ),
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(
            ref.watch(libraryServiceProvider),
            ref,
            prefs,
            playbackResolver: (song) async {
              final service = ref.read(musicServiceProvider);
              service.rememberSong(song.toJson());
              final playUrl = await service.getPlayUrl(song.id);
              return {
                ...song.toJson(),
                if (playUrl.resolvedId.isNotEmpty)
                  'playbackId': playUrl.resolvedId,
                if (playUrl.lyrics.isNotEmpty) 'lyrics': playUrl.lyrics,
                'playbackSource': 'bilibili',
                'playbackSourceLabel': 'B站',
                if (playUrl.resolvedId.isNotEmpty) ...{
                  'playbackSourceId': playUrl.resolvedId,
                  'sourceId': playUrl.resolvedId,
                  'bvid': _bvidFromPlaybackId(playUrl.resolvedId),
                },
              };
            },
          ),
        ),
      ],
      child: const DeepVibeApp(),
    ),
  );
}

String _bvidFromPlaybackId(String playbackId) {
  if (!playbackId.startsWith('bilibili:')) return '';
  final parts = playbackId.split(':');
  return parts.length >= 2 ? parts[1] : '';
}

/// Configure the lyrics child window: frameless, transparent background,
/// always-on-top, compact tool layer.
Future<void> _configureLyricsWindow() async {
  const lyricsOptions = WindowOptions(
    size: Size(760, 112),
    minimumSize: Size(420, 72),
    center: true,
    backgroundColor: Color(0x00000000), // transparent
    skipTaskbar: true,
    titleBarStyle: TitleBarStyle.hidden,
    windowButtonVisibility: false,
  );

  windowManager.waitUntilReadyToShow(lyricsOptions, () async {
    await windowManager.setAsFrameless();
    await windowManager.setResizable(false);
    await windowManager.setBackgroundColor(const Color(0x00000000));
    await windowManager.setHasShadow(false);
    await _applyLyricsToolWindowStyle();
    await windowManager.setAlwaysOnTop(true);
    await windowManager.show();
  });
}

Future<void> _applyLyricsToolWindowStyle() async {
  try {
    await _lyricsWindowStyleChannel.invokeMethod('applyLyricsToolWindowStyle');
  } catch (_) {
    // Non-Windows platforms or older runners can still show desktop lyrics.
  }
}
