import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'theme.dart';
import '../desktop/desktop_app_shell.dart';

/// Active surface mode (dark / light). Playback set persists the user's pick.
final themeModeProvider = StateProvider<ThemeMode>((ref) => ThemeMode.light);

class DeepVibeApp extends ConsumerWidget {
  const DeepVibeApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(themeModeProvider);
    return MaterialApp(
      title: 'IMusic',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: mode,
      home: const DesktopAppShell(),
      builder: (context, child) {
        final media = MediaQuery.of(context);
        final scale = (media.textScaler.scale(1) * 1.08)
            .clamp(1.0, 1.3)
            .toDouble();
        return MediaQuery(
          data: media.copyWith(textScaler: TextScaler.linear(scale)),
          child: child ?? const SizedBox.shrink(),
        );
      },
      // Desktop uses a single app shell with in-shell routing, not Navigator
      // pushing new routes, so the shell keeps the four-zone layout persistent
      // (sidebar + workbench + right rail + bottom bar) per PRD §6 and
      // tech doc §5.1. Page switches only swap the central workbench.
    );
  }
}
