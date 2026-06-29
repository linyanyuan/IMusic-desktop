import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:window_manager/window_manager.dart';

import '../app/theme.dart';
import '../playback/playback_providers.dart';
import '../playback/playback_actions.dart';
import '../services/auth_service.dart';
import '../services/app_settings.dart';
import '../services/audio_cache_service.dart';
import '../services/library_service.dart';
import '../core/models/song.dart';
import 'widgets/desktop_sidebar.dart';
import 'widgets/desktop_player_bar.dart';
import 'widgets/desktop_lyrics_window_controller.dart';
import 'widgets/desktop_shortcut_controller.dart';
import 'widgets/playback_completion_controller.dart';
import 'widgets/settings_shortcuts_section.dart';
import 'widgets/animated_equalizer_icon.dart';
import 'screens/desktop_home_screen.dart';
import 'screens/desktop_search_screen.dart';
import 'screens/desktop_playlist_detail_screen.dart';
import 'screens/desktop_library_screen.dart';
import 'screens/desktop_focus_screen.dart';

/// In-shell route. We keep a single persistent shell (sidebar + workbench +
/// right rail + bottom bar) and swap only the central workbench, matching
/// PRD §6 (always-visible context) and tech doc §5.1 (no Navigator pushing
/// that hides the rails).
enum DeskRoute {
  home,
  search,
  playlistDetail,
  library,
  settings,
  focus,
  profile,
  favorites,
  history,
}

final deskRouteProvider = StateProvider<DeskRoute>((ref) => DeskRoute.home);

/// Previous route before entering focus mode - for returning to the previous level.
final previousRouteProvider = StateProvider<DeskNavigationEntry?>(
  (ref) => null,
);

/// Optional payload for the playlist detail route so the central workbench
/// knows which playlist to render. Kept as a simple holder rather than a
/// GoRouter path param because routing lives entirely inside the shell.
final playlistDetailProvider = StateProvider<String?>((ref) => null);

/// Previous route before entering playlist detail.
final playlistBackRouteProvider = StateProvider<DeskRoute?>((ref) => null);

class DeskNavigationEntry {
  final DeskRoute route;
  final String? playlistId;

  const DeskNavigationEntry({required this.route, this.playlistId});

  bool sameAs(DeskNavigationEntry other) {
    return route == other.route && playlistId == other.playlistId;
  }
}

final routeBackStackProvider = StateProvider<List<DeskNavigationEntry>>(
  (ref) => const [],
);
final routeForwardStackProvider = StateProvider<List<DeskNavigationEntry>>(
  (ref) => const [],
);

DeskNavigationEntry _currentNavigationEntry(WidgetRef ref) {
  final route = ref.read(deskRouteProvider);
  return DeskNavigationEntry(
    route: route,
    playlistId: route == DeskRoute.playlistDetail
        ? ref.read(playlistDetailProvider)
        : null,
  );
}

void _applyNavigationEntry(WidgetRef ref, DeskNavigationEntry entry) {
  if (entry.route == DeskRoute.playlistDetail) {
    ref.read(playlistDetailProvider.notifier).state = entry.playlistId;
  } else {
    ref.read(playlistDetailProvider.notifier).state = null;
    ref.read(playlistBackRouteProvider.notifier).state = null;
  }
  ref.read(deskRouteProvider.notifier).state = entry.route;
}

void navigateDeskRoute(WidgetRef ref, DeskRoute route, {String? playlistId}) {
  final next = DeskNavigationEntry(route: route, playlistId: playlistId);
  final current = _currentNavigationEntry(ref);
  if (next.sameAs(current)) return;

  ref.read(routeBackStackProvider.notifier).state = [
    ...ref.read(routeBackStackProvider),
    current,
  ];
  ref.read(routeForwardStackProvider.notifier).state = const [];
  if (route == DeskRoute.playlistDetail) {
    ref.read(playlistBackRouteProvider.notifier).state = current.route;
  }
  _applyNavigationEntry(ref, next);
}

void navigateDeskBack(WidgetRef ref) {
  final backStack = ref.read(routeBackStackProvider);
  if (backStack.isEmpty) return;

  final previous = backStack.last;
  ref.read(routeBackStackProvider.notifier).state = backStack.sublist(
    0,
    backStack.length - 1,
  );
  ref.read(routeForwardStackProvider.notifier).state = [
    _currentNavigationEntry(ref),
    ...ref.read(routeForwardStackProvider),
  ];
  _applyNavigationEntry(ref, previous);
}

void navigateDeskForward(WidgetRef ref) {
  final forwardStack = ref.read(routeForwardStackProvider);
  if (forwardStack.isEmpty) return;

  final next = forwardStack.first;
  ref.read(routeForwardStackProvider.notifier).state = forwardStack.sublist(1);
  ref.read(routeBackStackProvider.notifier).state = [
    ...ref.read(routeBackStackProvider),
    _currentNavigationEntry(ref),
  ];
  _applyNavigationEntry(ref, next);
}

void toggleDeskFocusRoute(WidgetRef ref) {
  final current = _currentNavigationEntry(ref);
  if (current.route == DeskRoute.focus) {
    final previous =
        ref.read(previousRouteProvider) ??
        const DeskNavigationEntry(route: DeskRoute.home);
    final target = previous.route == DeskRoute.focus
        ? const DeskNavigationEntry(route: DeskRoute.home)
        : previous;
    final backStack = ref.read(routeBackStackProvider);
    if (backStack.isNotEmpty && backStack.last.sameAs(target)) {
      navigateDeskBack(ref);
    } else {
      _applyNavigationEntry(ref, target);
    }
    ref.read(previousRouteProvider.notifier).state = null;
    return;
  }

  ref.read(previousRouteProvider.notifier).state = current;
  navigateDeskRoute(ref, DeskRoute.focus);
}

/// Which tab the right rail shows: queue / lyrics / info (tech doc §6.1).
final rightRailTabProvider = StateProvider<RightRailTab>(
  (ref) => RightRailTab.lyrics,
);

/// Queue drawer visibility
final queueDrawerVisibleProvider = StateProvider<bool>((ref) => false);

enum RightRailTab { lyrics, queue, info }

class DesktopAppShell extends ConsumerWidget {
  const DesktopAppShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final route = ref.watch(deskRouteProvider);
    final colors = _colors(context);

    return PlaybackCompletionController(
      child: DesktopShortcutController(
        child: DragToResizeArea(
          resizeEdgeSize: 6,
          child: Scaffold(
            backgroundColor: colors.background,
            body: Stack(
              children: [
                // Main UI
                Column(
                  children: [
                    // Top drag area spanning full width (48px height)
                    _TopDragBar(colors: colors),
                    Expanded(
                      child: Row(
                        children: [
                          const DesktopSidebar(width: kSidebarWidth),
                          VerticalDivider(width: 1, color: colors.divider),
                          Expanded(child: _workbench(route, ref)),
                        ],
                      ),
                    ),
                    Divider(height: 1, color: colors.divider),
                    const DesktopPlayerBar(),
                  ],
                ),
                // Standalone desktop lyrics window controller.
                const DesktopLyricsWindowController(),
                // Queue drawer
                _QueueDrawer(colors: colors),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _workbench(DeskRoute route, WidgetRef ref) {
    // Route-based workbench - focus mode occupies this entire area
    switch (route) {
      case DeskRoute.home:
        return const DesktopHomeScreen();
      case DeskRoute.search:
        return const DesktopSearchScreen();
      case DeskRoute.playlistDetail:
        return const DesktopPlaylistDetailScreen();
      case DeskRoute.library:
        return const DesktopLibraryScreen();
      case DeskRoute.profile:
        return const _ProfileScreen();
      case DeskRoute.favorites:
        return const _FavoritesScreen();
      case DeskRoute.history:
        return const _HistoryScreen();
      case DeskRoute.settings:
        return const _SettingsPlaceholder();
      case DeskRoute.focus:
        return const DesktopFocusScreen();
    }
  }

  DeepVibeColors _colors(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return dark ? DeepVibeColors.dark : DeepVibeColors.light;
  }
}

/// Full-width top drag bar with window controls on the right
class _TopDragBar extends ConsumerWidget {
  final DeepVibeColors colors;
  const _TopDragBar({required this.colors});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(bottom: BorderSide(color: colors.divider)),
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: Row(
              children: [
                const SizedBox(width: 18),
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: colors.accent,
                    borderRadius: BorderRadius.circular(kCardRadius),
                  ),
                  child: Icon(
                    Icons.graphic_eq,
                    size: 18,
                    color: colors.background,
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  'IMusic',
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Expanded(
                  child: GestureDetector(
                    behavior: HitTestBehavior.translucent,
                    onPanStart: (details) {
                      windowManager.startDragging();
                    },
                    child: const SizedBox.expand(),
                  ),
                ),
                _UserLoginArea(colors: colors),
                Container(
                  width: 1,
                  height: 24,
                  margin: const EdgeInsets.symmetric(horizontal: 12),
                  color: colors.divider,
                ),
                _WindowButton(
                  icon: Icons.remove,
                  onTap: () => windowManager.minimize(),
                  colors: colors,
                ),
                _WindowButton(
                  icon: Icons.crop_square,
                  onTap: () async {
                    if (await windowManager.isMaximized()) {
                      windowManager.unmaximize();
                    } else {
                      windowManager.maximize();
                    }
                  },
                  colors: colors,
                ),
                _WindowButton(
                  icon: Icons.close,
                  onTap: () => windowManager.close(),
                  colors: colors,
                  isClose: true,
                ),
              ],
            ),
          ),
          Positioned(
            left: kSidebarWidth + 12,
            top: 9,
            child: Row(
              children: [
                _RouteHistoryButton(
                  key: const ValueKey('route-back-button'),
                  icon: Icons.arrow_back,
                  tooltip: '后退',
                  enabled: ref.watch(routeBackStackProvider).isNotEmpty,
                  colors: colors,
                  onTap: () => navigateDeskBack(ref),
                ),
                const SizedBox(width: 4),
                _RouteHistoryButton(
                  key: const ValueKey('route-forward-button'),
                  icon: Icons.arrow_forward,
                  tooltip: '前进',
                  enabled: ref.watch(routeForwardStackProvider).isNotEmpty,
                  colors: colors,
                  onTap: () => navigateDeskForward(ref),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RouteHistoryButton extends StatefulWidget {
  final IconData icon;
  final String tooltip;
  final bool enabled;
  final DeepVibeColors colors;
  final VoidCallback onTap;

  const _RouteHistoryButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.enabled,
    required this.colors,
    required this.onTap,
  });

  @override
  State<_RouteHistoryButton> createState() => _RouteHistoryButtonState();
}

class _RouteHistoryButtonState extends State<_RouteHistoryButton> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final color = widget.enabled
        ? widget.colors.textSecondary
        : widget.colors.textMuted.withValues(alpha: 0.35);
    return Tooltip(
      message: widget.tooltip,
      child: MouseRegion(
        onEnter: (_) => setState(() => _hover = true),
        onExit: (_) => setState(() => _hover = false),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: widget.enabled ? widget.onTap : null,
          child: Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              color: widget.enabled && _hover
                  ? widget.colors.surfaceVariant.withValues(alpha: 0.7)
                  : Colors.transparent,
              shape: BoxShape.circle,
            ),
            child: Icon(widget.icon, size: 17, color: color),
          ),
        ),
      ),
    );
  }
}

class _WindowButton extends StatefulWidget {
  final IconData icon;
  final VoidCallback onTap;
  final DeepVibeColors colors;
  final bool isClose;

  const _WindowButton({
    required this.icon,
    required this.onTap,
    required this.colors,
    this.isClose = false,
  });

  @override
  State<_WindowButton> createState() => _WindowButtonState();
}

class _WindowButtonState extends State<_WindowButton> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: Container(
          width: 46,
          height: 48,
          decoration: BoxDecoration(
            color: _hover
                ? (widget.isClose
                      ? Colors.red.shade600
                      : widget.colors.surfaceVariant)
                : Colors.transparent,
          ),
          child: Icon(
            widget.icon,
            size: 14,
            color: _hover && widget.isClose
                ? Colors.white
                : widget.colors.textSecondary,
          ),
        ),
      ),
    );
  }
}

class _SettingsPlaceholder extends ConsumerWidget {
  const _SettingsPlaceholder();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final settings = ref.watch(appSettingsProvider);
    final notifier = ref.read(appSettingsProvider.notifier);
    final colorOptions = const [
      0xFF1ED760,
      0xFF14B8A6,
      0xFFFFD166,
      0xFFFF5C8A,
      0xFFFFFFFF,
    ];

    return Container(
      color: c.background,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(32, 26, 32, 40),
        children: [
          _AdaptiveContentWidth(
            key: const ValueKey('settings-adaptive-content'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  '设置',
                  style: TextStyle(
                    color: c.textPrimary,
                    fontSize: 26,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 22),
                _SettingsSection(
                  title: '缓存',
                  c: c,
                  children: [
                    _SettingsRow(
                      title: '缓存目录',
                      description: '用于保存需要临时下载的音频文件',
                      c: c,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _CacheDirectoryField(c: c, settings: settings),
                          const SizedBox(height: 10),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              _SettingsActionButton(
                                key: const ValueKey(
                                  'settings-cache-directory-choose-button',
                                ),
                                icon: Icons.folder_open_outlined,
                                label: '选择目录',
                                c: c,
                                onTap: () async {
                                  final selected = await ref
                                      .read(cacheDirectoryPickerProvider)
                                      .call();
                                  if (selected == null ||
                                      selected.trim().isEmpty) {
                                    return;
                                  }
                                  await notifier.setCacheDirectory(selected);
                                },
                              ),
                              _SettingsActionButton(
                                icon: Icons.restart_alt_outlined,
                                label: '使用默认缓存目录',
                                c: c,
                                onTap: notifier.useDefaultCacheDirectory,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    _SettingsRow(
                      title: '缓存管理',
                      description: '复用已下载音频，并定期清理旧缓存',
                      c: c,
                      child: _AudioCacheManagement(c: c),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _SettingsSection(
                  title: '歌词',
                  c: c,
                  children: [
                    _SettingsRow(
                      title: '歌词字号',
                      description: '${settings.lyricsFontSize.round()} px',
                      c: c,
                      child: SliderTheme(
                        data: SliderTheme.of(context).copyWith(
                          trackHeight: 3,
                          thumbShape: const RoundSliderThumbShape(
                            enabledThumbRadius: 8,
                          ),
                          overlayShape: const RoundSliderOverlayShape(
                            overlayRadius: 16,
                          ),
                          inactiveTrackColor: c.divider,
                        ),
                        child: Slider(
                          key: const ValueKey(
                            'settings-lyrics-font-size-slider',
                          ),
                          min: 16,
                          max: 32,
                          divisions: 16,
                          value: settings.lyricsFontSize.clamp(16, 32),
                          activeColor: c.accent,
                          onChanged: notifier.setLyricsFontSize,
                        ),
                      ),
                    ),
                    _SettingsRow(
                      title: '歌词颜色',
                      description: '影响桌面歌词浮窗当前行颜色',
                      c: c,
                      child: Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: colorOptions.map((value) {
                          return _LyricsColorSwatch(
                            key: value == 0xFF1ED760
                                ? const ValueKey('settings-lyrics-color-green')
                                : ValueKey('settings-lyrics-color-$value'),
                            color: Color(value),
                            selected: settings.lyricsColorValue == value,
                            c: c,
                            onTap: () => notifier.setLyricsColorValue(value),
                          );
                        }).toList(),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                SettingsShortcutsSection(colors: c),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AdaptiveContentWidth extends StatelessWidget {
  final Widget child;

  const _AdaptiveContentWidth({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final availableWidth = constraints.maxWidth;
        if (!availableWidth.isFinite) return child;

        final contentWidth = availableWidth < 920
            ? availableWidth
            : (availableWidth * 0.88).clamp(860.0, 1180.0).toDouble();

        return Align(
          alignment: Alignment.topCenter,
          child: SizedBox(width: contentWidth, child: child),
        );
      },
    );
  }
}

class _CacheDirectoryField extends ConsumerWidget {
  final DeepVibeColors c;
  final AppSettings settings;

  const _CacheDirectoryField({required this.c, required this.settings});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (settings.cacheDirectory.isNotEmpty) {
      return _fieldContainer(
        c: c,
        child: Text(
          '当前缓存目录: ${settings.cacheDirectory}',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: c.textPrimary, fontSize: 13),
        ),
      );
    }

    // When using default directory, show the actual default path
    final defaultDirAsync = ref.watch(defaultCacheDirectoryProvider);
    final displayText = defaultDirAsync.when(
      data: (path) => '当前缓存目录: $path（默认）',
      loading: () => '正在获取默认缓存目录...',
      error: (_, stackTrace) => '使用系统默认缓存目录（无法获取路径）',
    );

    return _fieldContainer(
      c: c,
      child: Text(
        displayText,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: c.textMuted, fontSize: 13),
      ),
    );
  }

  Widget _fieldContainer({required Widget child, required DeepVibeColors c}) {
    return Container(
      key: const ValueKey('settings-cache-directory-field'),
      constraints: const BoxConstraints(minHeight: 42),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: c.background.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: c.divider),
      ),
      alignment: Alignment.centerLeft,
      child: child,
    );
  }
}

class _AudioCacheManagement extends ConsumerStatefulWidget {
  final DeepVibeColors c;

  const _AudioCacheManagement({required this.c});

  @override
  ConsumerState<_AudioCacheManagement> createState() =>
      _AudioCacheManagementState();
}

class _AudioCacheManagementState extends ConsumerState<_AudioCacheManagement> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final c = widget.c;
    final settings = ref.watch(appSettingsProvider);
    final stats = ref.watch(audioCacheStatsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            _CacheMetric(
              c: c,
              label: '占用',
              value: stats.maybeWhen(
                data: (value) => value.displaySize,
                loading: () => '计算中',
                orElse: () => '无法读取',
              ),
            ),
            _CacheMetric(
              c: c,
              label: '文件',
              value: stats.maybeWhen(
                data: (value) => '${value.fileCount} 个',
                loading: () => '-',
                orElse: () => '-',
              ),
            ),
            _CacheMetric(
              c: c,
              label: '保留',
              value: '${settings.cacheRetentionDays} 天',
            ),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '自动清理',
                  style: TextStyle(color: c.textSecondary, fontSize: 12),
                ),
                const SizedBox(width: 6),
                Transform.scale(
                  scale: 0.82,
                  child: Switch(
                    key: const ValueKey('settings-cache-auto-cleanup-switch'),
                    value: settings.cacheAutoCleanupEnabled,
                    activeThumbColor: c.accent,
                    onChanged: (value) {
                      ref
                          .read(appSettingsProvider.notifier)
                          .setCacheAutoCleanupEnabled(value);
                    },
                  ),
                ),
              ],
            ),
            _CacheRetentionMenu(c: c, settings: settings),
            _SettingsActionButton(
              key: const ValueKey('settings-cache-clear-expired-button'),
              icon: Icons.auto_delete_outlined,
              label: '清理过期',
              c: c,
              onTap: _busy ? null : _clearExpired,
            ),
            _SettingsActionButton(
              key: const ValueKey('settings-cache-clear-button'),
              icon: Icons.delete_sweep_outlined,
              label: '立即清理',
              c: c,
              onTap: _busy ? null : _clearAll,
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _clearExpired() async {
    final settings = ref.read(appSettingsProvider);
    await _runCleanup(
      () => ref
          .read(audioCacheServiceProvider)
          .clearExpired(
            settings.cacheDirectory,
            retentionDays: settings.cacheRetentionDays,
          ),
    );
  }

  Future<void> _clearAll() async {
    final settings = ref.read(appSettingsProvider);
    await _runCleanup(
      () => ref.read(audioCacheServiceProvider).clear(settings.cacheDirectory),
    );
  }

  Future<void> _runCleanup(
    Future<AudioCacheCleanupResult> Function() cleanup,
  ) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final result = await cleanup();
      ref.invalidate(audioCacheStatsProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            result.fileCount == 0
                ? '没有需要清理的缓存'
                : '已清理 ${result.fileCount} 个缓存文件，释放 ${result.displayFreedSize}',
          ),
          duration: const Duration(seconds: 2),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('清理缓存失败'), duration: Duration(seconds: 2)),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _CacheRetentionMenu extends ConsumerWidget {
  final DeepVibeColors c;
  final AppSettings settings;

  const _CacheRetentionMenu({required this.c, required this.settings});

  static const _options = [3, 7, 14, 30];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return PopupMenuButton<int>(
      key: const ValueKey('settings-cache-retention-menu'),
      tooltip: '设置缓存保留天数',
      initialValue: settings.cacheRetentionDays,
      onSelected: (days) {
        ref.read(appSettingsProvider.notifier).setCacheRetentionDays(days);
      },
      itemBuilder: (context) => [
        for (final days in _options)
          PopupMenuItem(value: days, child: Text('$days 天')),
      ],
      child: Container(
        height: 32,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          color: c.background.withValues(alpha: 0.74),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: c.divider),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.schedule_outlined, size: 15, color: c.textSecondary),
            const SizedBox(width: 6),
            Text(
              '保留 ${settings.cacheRetentionDays} 天',
              style: TextStyle(color: c.textSecondary, fontSize: 12),
            ),
            const SizedBox(width: 4),
            Icon(Icons.expand_more, size: 16, color: c.textMuted),
          ],
        ),
      ),
    );
  }
}

class _CacheMetric extends StatelessWidget {
  final DeepVibeColors c;
  final String label;
  final String value;

  const _CacheMetric({
    required this.c,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 88, minHeight: 44),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: c.background.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: c.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: TextStyle(color: c.textMuted, fontSize: 11)),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              color: c.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final DeepVibeColors c;
  final VoidCallback? onTap;

  const _SettingsActionButton({
    super.key,
    required this.icon,
    required this.label,
    required this.c,
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
            foregroundColor: c.textSecondary,
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            minimumSize: const Size(0, 32),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(6),
            ),
          ).copyWith(
            overlayColor: WidgetStatePropertyAll(
              c.accent.withValues(alpha: 0.08),
            ),
          ),
    );
  }
}

class _SettingsSection extends StatelessWidget {
  final String title;
  final DeepVibeColors c;
  final List<Widget> children;

  const _SettingsSection({
    required this.title,
    required this.c,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 2, bottom: 8),
          child: Text(
            title,
            style: TextStyle(
              color: c.textSecondary,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: c.surface,
            borderRadius: BorderRadius.circular(kCardRadius),
            border: Border.all(color: c.divider),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0) Divider(height: 1, color: c.divider),
                children[i],
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _SettingsRow extends StatelessWidget {
  final String title;
  final String description;
  final DeepVibeColors c;
  final Widget child;

  const _SettingsRow({
    required this.title,
    required this.description,
    required this.c,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final stacked = constraints.maxWidth < 620;
        final label = _SettingsRowLabel(
          title: title,
          description: description,
          c: c,
        );

        if (stacked) {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [label, const SizedBox(height: 12), child],
            ),
          );
        }

        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              SizedBox(width: 210, child: label),
              const SizedBox(width: 22),
              Expanded(child: child),
            ],
          ),
        );
      },
    );
  }
}

class _SettingsRowLabel extends StatelessWidget {
  final String title;
  final String description;
  final DeepVibeColors c;

  const _SettingsRowLabel({
    required this.title,
    required this.description,
    required this.c,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: TextStyle(
            color: c.textPrimary,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          description,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: c.textMuted, fontSize: 12, height: 1.25),
        ),
      ],
    );
  }
}

class _LyricsColorSwatch extends StatelessWidget {
  final Color color;
  final bool selected;
  final DeepVibeColors c;
  final VoidCallback onTap;

  const _LyricsColorSwatch({
    super.key,
    required this.color,
    required this.selected,
    required this.c,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: '选择歌词颜色',
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            border: Border.all(
              color: selected ? c.accent : c.divider,
              width: selected ? 3 : 1,
            ),
          ),
          child: selected
              ? Icon(
                  Icons.check,
                  size: 16,
                  color: color.computeLuminance() > 0.6
                      ? Colors.black
                      : Colors.white,
                )
              : null,
        ),
      ),
    );
  }
}

class _UserAvatar extends StatelessWidget {
  final UserInfo user;
  final DeepVibeColors colors;
  final double radius;

  const _UserAvatar({
    required this.user,
    required this.colors,
    required this.radius,
  });

  @override
  Widget build(BuildContext context) {
    final image = _avatarImage(user.avatarUrl);
    return CircleAvatar(
      radius: radius,
      backgroundColor: colors.accent,
      foregroundImage: image,
      onForegroundImageError: image == null ? null : (exception, stackTrace) {},
      child: Text(
        user.avatarText,
        style: TextStyle(
          color: colors.background,
          fontSize: radius * 0.9,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

ImageProvider? _avatarImage(String avatarUrl) {
  final uri = Uri.tryParse(avatarUrl.trim());
  if (uri == null || uri.host.isEmpty) return null;
  if (uri.scheme != 'http' && uri.scheme != 'https') return null;
  return NetworkImage(uri.toString());
}

class _ProfileScreen extends ConsumerWidget {
  const _ProfileScreen();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final auth = ref.watch(authProvider);
    final library = ref.watch(libraryProvider);
    final user = auth.user;

    if (user == null) {
      return Container(
        color: c.background,
        child: _NotLoggedInState(c: c, message: '登录后查看我的主页'),
      );
    }

    final createdPlaylists = library.userPlaylists
        .where((playlist) => playlist['isCollected'] != true)
        .toList();
    final collectedPlaylists = library.userPlaylists
        .where((playlist) => playlist['isCollected'] == true)
        .toList();

    return Container(
      color: c.background,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(32, 26, 32, 40),
        children: [
          _AdaptiveContentWidth(
            key: const ValueKey('profile-adaptive-content'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _ProfileHero(
                  user: user,
                  c: c,
                  likedCount: library.likedSongs.length,
                  createdCount: createdPlaylists.length,
                  collectedCount: collectedPlaylists.length,
                ),
                const SizedBox(height: 20),
                _ProfilePanel(
                  title: '音乐库',
                  trailing: '${library.likedSongs.length} 首喜欢',
                  c: c,
                  child: _ProfileLikedCard(
                    key: const ValueKey('profile-liked-playlist'),
                    songCount: library.likedSongs.length,
                    c: c,
                    onTap: () {
                      navigateDeskRoute(ref, DeskRoute.favorites);
                    },
                  ),
                ),
                const SizedBox(height: 18),
                _ProfilePlaylistSection(
                  title: '创建的歌单',
                  emptyMessage: '暂无创建的歌单',
                  playlists: createdPlaylists,
                  keyPrefix: 'profile-created-playlist',
                  c: c,
                  onOpen: (id) => _openUserPlaylist(ref, id),
                ),
                const SizedBox(height: 18),
                _ProfilePlaylistSection(
                  title: '收藏的歌单',
                  emptyMessage: '暂无收藏的歌单',
                  playlists: collectedPlaylists,
                  keyPrefix: 'profile-collected-playlist',
                  c: c,
                  onOpen: (id) => _openUserPlaylist(ref, id),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfilePanel extends StatelessWidget {
  final String title;
  final String? trailing;
  final DeepVibeColors c;
  final Widget child;

  const _ProfilePanel({
    required this.title,
    required this.trailing,
    required this.c,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ProfileSectionTitle(title: title, trailing: trailing, c: c),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: c.surface,
            borderRadius: BorderRadius.circular(kCardRadius),
            border: Border.all(color: c.divider),
          ),
          clipBehavior: Clip.antiAlias,
          child: child,
        ),
      ],
    );
  }
}

class _ProfilePlaylistSection extends StatelessWidget {
  final String title;
  final String emptyMessage;
  final List<Map<String, dynamic>> playlists;
  final String keyPrefix;
  final DeepVibeColors c;
  final ValueChanged<String> onOpen;

  const _ProfilePlaylistSection({
    required this.title,
    required this.emptyMessage,
    required this.playlists,
    required this.keyPrefix,
    required this.c,
    required this.onOpen,
  });

  @override
  Widget build(BuildContext context) {
    if (playlists.isEmpty) {
      return _ProfilePanel(
        title: title,
        trailing: null,
        c: c,
        child: _ProfileEmptyRow(
          c: c,
          icon: Icons.queue_music,
          message: emptyMessage,
        ),
      );
    }

    return _ProfilePanel(
      title: title,
      trailing: '${playlists.length} 个',
      c: c,
      child: Column(
        children: [
          for (var i = 0; i < playlists.length; i++) ...[
            if (i > 0) Divider(height: 1, color: c.divider),
            _playlistCardFor(playlists[i]),
          ],
        ],
      ),
    );
  }

  Widget _playlistCardFor(Map<String, dynamic> playlist) {
    final id = playlist['id']?.toString() ?? '';
    final name =
        playlist['name']?.toString() ??
        playlist['title']?.toString() ??
        '未命名歌单';
    final description =
        playlist['description']?.toString() ??
        playlist['subtitle']?.toString() ??
        '';
    final songCount = _playlistSongCount(playlist);
    return _ProfilePlaylistCard(
      key: ValueKey('$keyPrefix-$id'),
      title: name,
      description: description,
      songCount: songCount,
      collected: playlist['isCollected'] == true,
      c: c,
      onTap: () => onOpen(id),
    );
  }
}

class _ProfileEmptyRow extends StatelessWidget {
  final DeepVibeColors c;
  final IconData icon;
  final String message;

  const _ProfileEmptyRow({
    required this.c,
    required this.icon,
    required this.message,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 68,
      padding: const EdgeInsets.symmetric(horizontal: 18),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: c.background.withValues(alpha: 0.74),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: c.divider),
            ),
            child: Icon(icon, size: 18, color: c.textMuted),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: c.textMuted, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileHero extends StatelessWidget {
  final UserInfo user;
  final DeepVibeColors c;
  final int likedCount;
  final int createdCount;
  final int collectedCount;

  const _ProfileHero({
    required this.user,
    required this.c,
    required this.likedCount,
    required this.createdCount,
    required this.collectedCount,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(kCardRadius),
        border: Border.all(color: c.divider),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 640;
          final identity = Row(
            children: [
              Container(
                padding: const EdgeInsets.all(2),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: c.divider),
                ),
                child: _UserAvatar(user: user, colors: c, radius: 40),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '我的主页',
                      style: TextStyle(
                        color: c.textMuted,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      user.nickname,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: c.textPrimary,
                        fontSize: 24,
                        height: 1.08,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    _ProfileHandlePill(text: '@${user.username}', c: c),
                  ],
                ),
              ),
            ],
          );
          final metrics = Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: compact ? WrapAlignment.start : WrapAlignment.end,
            children: [
              _ProfileMetricPill(
                icon: Icons.favorite,
                label: '喜欢',
                value: likedCount.toString(),
                c: c,
              ),
              _ProfileMetricPill(
                icon: Icons.library_music,
                label: '创建',
                value: createdCount.toString(),
                c: c,
              ),
              _ProfileMetricPill(
                icon: Icons.bookmark,
                label: '收藏',
                value: collectedCount.toString(),
                c: c,
              ),
            ],
          );

          if (compact) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [identity, const SizedBox(height: 16), metrics],
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(child: identity),
              const SizedBox(width: 18),
              metrics,
            ],
          );
        },
      ),
    );
  }
}

class _ProfileHandlePill extends StatelessWidget {
  final String text;
  final DeepVibeColors c;

  const _ProfileHandlePill({required this.text, required this.c});

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      key: const ValueKey('profile-handle-compact'),
      constraints: const BoxConstraints(maxWidth: 150),
      child: Container(
        height: 24,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: c.background.withValues(alpha: 0.74),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: c.divider),
        ),
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: c.textSecondary,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _ProfileMetricPill extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final DeepVibeColors c;

  const _ProfileMetricPill({
    required this.icon,
    required this.label,
    required this.value,
    required this.c,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 82,
      height: 46,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: c.background.withValues(alpha: 0.74),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: c.divider),
      ),
      child: Row(
        children: [
          Icon(icon, size: 15, color: c.accent),
          const SizedBox(width: 7),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: c.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: c.textMuted, fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileSectionTitle extends StatelessWidget {
  final String title;
  final String? trailing;
  final DeepVibeColors c;

  const _ProfileSectionTitle({
    required this.title,
    required this.trailing,
    required this.c,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          title,
          style: TextStyle(
            color: c.textSecondary,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
        const Spacer(),
        if (trailing != null)
          Text(
            trailing!,
            style: TextStyle(
              color: c.textMuted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
      ],
    );
  }
}

class _ProfileLikedCard extends StatefulWidget {
  final int songCount;
  final DeepVibeColors c;
  final VoidCallback onTap;

  const _ProfileLikedCard({
    super.key,
    required this.songCount,
    required this.c,
    required this.onTap,
  });

  @override
  State<_ProfileLikedCard> createState() => _ProfileLikedCardState();
}

class _ProfileLikedCardState extends State<_ProfileLikedCard> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            height: 72,
            padding: const EdgeInsets.symmetric(horizontal: 18),
            decoration: BoxDecoration(
              color: _hover
                  ? widget.c.surfaceVariant.withValues(alpha: 0.72)
                  : widget.c.surface,
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.red.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Icon(
                    Icons.favorite,
                    color: Colors.red,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '我喜欢的音乐',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        '${widget.songCount} 首喜欢的歌曲',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textMuted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right,
                  size: 20,
                  color: widget.c.textSecondary,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProfilePlaylistCard extends StatefulWidget {
  final String title;
  final String description;
  final int songCount;
  final bool collected;
  final DeepVibeColors c;
  final VoidCallback onTap;

  const _ProfilePlaylistCard({
    super.key,
    required this.title,
    required this.description,
    required this.songCount,
    required this.collected,
    required this.c,
    required this.onTap,
  });

  @override
  State<_ProfilePlaylistCard> createState() => _ProfilePlaylistCardState();
}

class _ProfilePlaylistCardState extends State<_ProfilePlaylistCard> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final subtitle = widget.description.isEmpty
        ? '${widget.songCount} 首歌曲'
        : '${widget.description} · ${widget.songCount} 首歌曲';

    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            constraints: const BoxConstraints(minHeight: 72),
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
            decoration: BoxDecoration(
              color: _hover
                  ? widget.c.surfaceVariant.withValues(alpha: 0.72)
                  : widget.c.surface,
            ),
            child: Row(
              children: [
                _PlaylistCoverMark(c: widget.c, collected: widget.collected),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        widget.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        subtitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textMuted,
                          fontSize: 12,
                          height: 1.25,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(Icons.chevron_right, size: 18, color: widget.c.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PlaylistCoverMark extends StatelessWidget {
  final DeepVibeColors c;
  final bool collected;

  const _PlaylistCoverMark({required this.c, required this.collected});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      width: 48,
      decoration: BoxDecoration(
        color: c.accent.withValues(alpha: collected ? 0.1 : 0.16),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Stack(
        children: [
          Positioned(
            left: 9,
            top: 10,
            child: Icon(
              collected ? Icons.bookmark : Icons.queue_music,
              color: c.accent,
              size: 21,
            ),
          ),
          Positioned(
            right: 7,
            bottom: 7,
            child: Icon(Icons.graphic_eq, color: c.textMuted, size: 14),
          ),
        ],
      ),
    );
  }
}

void _openUserPlaylist(WidgetRef ref, String playlistId) {
  if (playlistId.isEmpty) return;
  navigateDeskRoute(ref, DeskRoute.playlistDetail, playlistId: playlistId);
}

int _playlistSongCount(Map<String, dynamic> playlist) {
  final songs = playlist['songs'];
  if (songs is List) return songs.length;
  final count = playlist['songCount'];
  if (count is int) return count;
  if (count is num) return count.round();
  return int.tryParse(count?.toString() ?? '') ?? 0;
}

/// Favorites screen - shows liked songs
class _FavoritesScreen extends ConsumerStatefulWidget {
  const _FavoritesScreen();

  @override
  ConsumerState<_FavoritesScreen> createState() => _FavoritesScreenState();
}

class _FavoritesScreenState extends ConsumerState<_FavoritesScreen> {
  @override
  void initState() {
    super.initState();
    // Load liked songs when screen is opened
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final authState = ref.read(authProvider);
      if (authState.isLoggedIn && authState.token != null) {
        ref.read(libraryProvider.notifier).loadLikedSongs(authState.token!);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final authState = ref.watch(authProvider);
    final libraryState = ref.watch(libraryProvider);

    return Container(
      color: c.background,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '我喜欢的音乐',
                style: TextStyle(
                  color: c.textPrimary,
                  fontSize: 28,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
          Expanded(
            child: !authState.isLoggedIn
                ? _NotLoggedInState(c: c, message: '登录后查看收藏的歌曲')
                : libraryState.isLoading
                ? Center(child: CircularProgressIndicator(color: c.accent))
                : libraryState.likedSongs.isEmpty
                ? _EmptyDataState(
                    c: c,
                    icon: Icons.favorite_border,
                    message: '还没有收藏的歌曲',
                  )
                : _SongListView(
                    songs: libraryState.likedSongs,
                    c: c,
                    showFavoriteAction: true,
                  ),
          ),
        ],
      ),
    );
  }
}

/// History screen - shows play history
class _HistoryScreen extends ConsumerStatefulWidget {
  const _HistoryScreen();

  @override
  ConsumerState<_HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends ConsumerState<_HistoryScreen> {
  @override
  void initState() {
    super.initState();
    // Load play history when screen is opened
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final authState = ref.read(authProvider);
      if (authState.isLoggedIn && authState.token != null) {
        ref.read(libraryProvider.notifier).loadPlayHistory(authState.token!);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final authState = ref.watch(authProvider);
    final libraryState = ref.watch(libraryProvider);

    return Container(
      color: c.background,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '历史播放',
                style: TextStyle(
                  color: c.textPrimary,
                  fontSize: 28,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
          Expanded(
            child: !authState.isLoggedIn
                ? _NotLoggedInState(c: c, message: '登录后查看播放历史')
                : libraryState.isLoading
                ? Center(child: CircularProgressIndicator(color: c.accent))
                : libraryState.playHistory.isEmpty
                ? _EmptyDataState(c: c, icon: Icons.history, message: '没有播放历史')
                : _SongListView(songs: libraryState.playHistory, c: c),
          ),
        ],
      ),
    );
  }
}

class _SongListView extends ConsumerWidget {
  final List<Song> songs;
  final DeepVibeColors c;
  final bool showFavoriteAction;

  const _SongListView({
    required this.songs,
    required this.c,
    this.showFavoriteAction = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      children: [
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: c.surface,
            borderRadius: BorderRadius.circular(kCardRadius),
          ),
          child: Column(
            children: [
              _SongListHeader(c: c, showFavoriteAction: showFavoriteAction),
              ...List.generate(
                songs.length,
                (i) => _SimpleSongRow(
                  song: songs[i],
                  index: i + 1,
                  c: c,
                  showFavoriteAction: showFavoriteAction,
                  onTap: () => startSongPlayback(
                    ref,
                    song: songs[i].toJson(),
                    index: i,
                    queue: songs.map((song) => song.toJson()).toList(),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}

class _SongListHeader extends StatelessWidget {
  final DeepVibeColors c;
  final bool showFavoriteAction;

  const _SongListHeader({required this.c, required this.showFavoriteAction});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: c.divider)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 32,
            child: Text(
              '#',
              textAlign: TextAlign.center,
              style: TextStyle(color: c.textMuted, fontSize: 11),
            ),
          ),
          const SizedBox(width: 12),
          if (showFavoriteAction) ...[
            const SizedBox(width: 28),
            const SizedBox(width: 8),
          ],
          Expanded(
            flex: 3,
            child: Text(
              '歌曲',
              key: const ValueKey('song-list-header-title'),
              style: TextStyle(
                color: c.textMuted,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Expanded(
            flex: 2,
            child: Text(
              '歌手',
              key: const ValueKey('song-list-header-artist'),
              style: TextStyle(
                color: c.textMuted,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          SizedBox(
            width: 48,
            child: Text(
              '时长',
              key: const ValueKey('song-list-header-duration'),
              textAlign: TextAlign.right,
              style: TextStyle(
                color: c.textMuted,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SimpleSongRow extends ConsumerStatefulWidget {
  final Song song;
  final int index;
  final DeepVibeColors c;
  final bool showFavoriteAction;
  final VoidCallback onTap;

  const _SimpleSongRow({
    required this.song,
    required this.index,
    required this.c,
    required this.showFavoriteAction,
    required this.onTap,
  });

  @override
  ConsumerState<_SimpleSongRow> createState() => _SimpleSongRowState();
}

class _SimpleSongRowState extends ConsumerState<_SimpleSongRow> {
  bool _hover = false;

  Future<void> _toggleFavorite() async {
    final token = ref.read(authProvider).token;
    if (token == null || token.isEmpty) return;
    await ref.read(libraryProvider.notifier).toggleLike(token, widget.song);
  }

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.onTap,
          child: Container(
            height: 56,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: _hover
                  ? widget.c.surfaceVariant.withValues(alpha: 0.5)
                  : Colors.transparent,
            ),
            child: Row(
              children: [
                SizedBox(
                  width: 32,
                  child: Text(
                    '${widget.index}',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: widget.c.textMuted, fontSize: 12),
                  ),
                ),
                const SizedBox(width: 12),
                if (widget.showFavoriteAction) ...[
                  IconButton(
                    key: ValueKey('favorites-like-${widget.song.id}'),
                    icon: const Icon(Icons.favorite, size: 16),
                    color: Colors.red,
                    tooltip: '取消喜欢',
                    onPressed: _toggleFavorite,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(
                      minWidth: 28,
                      minHeight: 28,
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                Expanded(
                  flex: 3,
                  child: Row(
                    children: [
                      if (widget.song.isFavorite && !widget.showFavoriteAction)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: Icon(
                            Icons.favorite,
                            size: 14,
                            color: widget.c.accent,
                          ),
                        ),
                      Expanded(
                        child: Text(
                          widget.song.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: widget.c.textPrimary,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  flex: 2,
                  child: Text(
                    widget.song.artist,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: widget.c.textSecondary,
                      fontSize: 13,
                    ),
                  ),
                ),
                SizedBox(
                  width: 48,
                  child: Text(
                    _formatSongDuration(widget.song.duration),
                    textAlign: TextAlign.right,
                    style: TextStyle(color: widget.c.textMuted, fontSize: 12),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _formatSongDuration(Object? value) {
  final text = value?.toString().trim() ?? '';
  if (text.isEmpty) return '0:00';
  if (text.contains(':')) {
    final parts = text.split(':');
    if (parts.length == 2) {
      final minutes = int.tryParse(parts[0]) ?? 0;
      final seconds = int.tryParse(parts[1]) ?? 0;
      return '$minutes:${seconds.toString().padLeft(2, '0')}';
    }
    return text;
  }

  final raw = int.tryParse(text);
  if (raw == null) return text;
  final totalSeconds = raw >= 10000 ? raw ~/ 1000 : raw;
  final minutes = totalSeconds ~/ 60;
  final seconds = totalSeconds % 60;
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}

class _NotLoggedInState extends StatelessWidget {
  final DeepVibeColors c;
  final String message;

  const _NotLoggedInState({required this.c, required this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.account_circle_outlined,
            size: 64,
            color: c.textMuted.withOpacity(0.3),
          ),
          const SizedBox(height: 16),
          Text(message, style: TextStyle(color: c.textMuted, fontSize: 14)),
        ],
      ),
    );
  }
}

class _EmptyDataState extends StatelessWidget {
  final DeepVibeColors c;
  final IconData icon;
  final String message;

  const _EmptyDataState({
    required this.c,
    required this.icon,
    required this.message,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 64, color: c.textMuted.withOpacity(0.3)),
          const SizedBox(height: 16),
          Text(message, style: TextStyle(color: c.textMuted, fontSize: 14)),
        ],
      ),
    );
  }
}

/// Queue drawer - slides in from right
/// User login area with icon and dropdown
class _UserLoginArea extends ConsumerWidget {
  final DeepVibeColors colors;
  const _UserLoginArea({required this.colors});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);

    return authState.isLoggedIn
        ? _LoggedInUser(colors: colors, user: authState.user!)
        : _LoginButton(colors: colors);
  }
}

class _LoginButton extends StatelessWidget {
  final DeepVibeColors colors;
  const _LoginButton({required this.colors});

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: () {
        showGeneralDialog(
          context: context,
          barrierDismissible: true,
          barrierColor: Colors.black54,
          barrierLabel: 'Login',
          transitionDuration: const Duration(milliseconds: 200),
          pageBuilder: (context, animation, secondaryAnimation) {
            return _LoginDialog(colors: colors);
          },
          transitionBuilder: (context, animation, secondaryAnimation, child) {
            return FadeTransition(
              opacity: animation,
              child: ScaleTransition(
                scale: Tween<double>(begin: 0.9, end: 1.0).animate(
                  CurvedAnimation(parent: animation, curve: Curves.easeOut),
                ),
                child: child,
              ),
            );
          },
        );
      },
      style: TextButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        foregroundColor: colors.textPrimary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        overlayColor: colors.surfaceVariant.withOpacity(0.3),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.account_circle_outlined,
            size: 20,
            color: colors.textSecondary,
          ),
          const SizedBox(width: 6),
          Text(
            '登录',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }
}

class _LoggedInUser extends StatefulWidget {
  final DeepVibeColors colors;
  final UserInfo user;
  const _LoggedInUser({required this.colors, required this.user});

  @override
  State<_LoggedInUser> createState() => _LoggedInUserState();
}

class _LoggedInUserState extends State<_LoggedInUser> {
  OverlayEntry? _menuEntry;

  bool get _menuVisible => _menuEntry != null;

  @override
  void dispose() {
    _removeMenu();
    super.dispose();
  }

  void _toggleMenu() {
    if (_menuVisible) {
      _removeMenu();
    } else {
      _showMenu();
    }
    setState(() {});
  }

  void _showMenu() {
    final renderBox = context.findRenderObject() as RenderBox;
    final offset = renderBox.localToGlobal(Offset.zero);
    final size = renderBox.size;
    const menuWidth = 160.0;

    _menuEntry = OverlayEntry(
      builder: (context) => Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: () {
                _removeMenu();
                if (mounted) setState(() {});
              },
            ),
          ),
          Positioned(
            left: offset.dx + size.width - menuWidth,
            top: offset.dy + size.height + 4,
            child: _UserMenu(colors: widget.colors, onClose: _closeMenu),
          ),
        ],
      ),
    );
    Overlay.of(context, rootOverlay: true).insert(_menuEntry!);
  }

  void _closeMenu() {
    _removeMenu();
    if (mounted) setState(() {});
  }

  void _removeMenu() {
    _menuEntry?.remove();
    _menuEntry = null;
  }

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: _toggleMenu,
      style: TextButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        foregroundColor: widget.colors.textPrimary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        overlayColor: widget.colors.surfaceVariant.withOpacity(0.3),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _UserAvatar(user: widget.user, colors: widget.colors, radius: 12),
          const SizedBox(width: 8),
          Text(
            widget.user.nickname,
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          ),
          const SizedBox(width: 4),
          Icon(
            _menuVisible ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
            size: 16,
            color: widget.colors.textSecondary,
          ),
        ],
      ),
    );
  }
}

class _UserMenu extends ConsumerWidget {
  final DeepVibeColors colors;
  final VoidCallback onClose;
  const _UserMenu({required this.colors, required this.onClose});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return GestureDetector(
      onTap: () {},
      child: Material(
        elevation: 8,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          width: 160,
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: colors.border),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _UserMenuItem(
                icon: Icons.person_outline,
                label: '我的',
                colors: colors,
                onTap: () {
                  onClose();
                  navigateDeskRoute(ref, DeskRoute.profile);
                },
              ),
              Divider(height: 1, color: colors.divider),
              _UserMenuItem(
                icon: Icons.settings_outlined,
                label: '设置',
                colors: colors,
                onTap: () {
                  onClose();
                  navigateDeskRoute(ref, DeskRoute.settings);
                },
              ),
              Divider(height: 1, color: colors.divider),
              _UserMenuItem(
                icon: Icons.logout,
                label: '退出登录',
                colors: colors,
                onTap: () async {
                  onClose();
                  await ref.read(authProvider.notifier).logout();
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _UserMenuItem extends StatefulWidget {
  final IconData icon;
  final String label;
  final DeepVibeColors colors;
  final VoidCallback onTap;

  const _UserMenuItem({
    required this.icon,
    required this.label,
    required this.colors,
    required this.onTap,
  });

  @override
  State<_UserMenuItem> createState() => _UserMenuItemState();
}

class _UserMenuItemState extends State<_UserMenuItem> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: InkWell(
        onTap: widget.onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          color: _hover
              ? widget.colors.surfaceVariant.withOpacity(0.5)
              : Colors.transparent,
          child: Row(
            children: [
              Icon(widget.icon, size: 18, color: widget.colors.textSecondary),
              const SizedBox(width: 12),
              Text(
                widget.label,
                style: TextStyle(
                  color: widget.colors.textPrimary,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LoginDialog extends ConsumerStatefulWidget {
  final DeepVibeColors colors;
  const _LoginDialog({required this.colors});

  @override
  ConsumerState<_LoginDialog> createState() => _LoginDialogState();
}

class _LoginDialogState extends ConsumerState<_LoginDialog> {
  final _usernameController = TextEditingController();
  final _nicknameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _isLoading = false;
  bool _isRegistering = false;
  String? _errorMessage;

  @override
  void dispose() {
    _usernameController.dispose();
    _nicknameController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final username = _usernameController.text.trim();
    final password = _passwordController.text;
    final nickname = _nicknameController.text.trim();
    final confirmPassword = _confirmPasswordController.text;

    if (username.isEmpty || password.isEmpty) {
      setState(() => _errorMessage = '请输入用户名和密码');
      return;
    }
    if (_isRegistering && password != confirmPassword) {
      setState(() => _errorMessage = '两次输入的密码不一致');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      if (_isRegistering) {
        await ref
            .read(authProvider.notifier)
            .register(
              username,
              password,
              nickname: nickname.isEmpty ? null : nickname,
            );
      } else {
        await ref.read(authProvider.notifier).login(username, password);
      }
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = _isRegistering ? '注册失败，请稍后再试' : '登录失败，请检查用户名和密码';
      });
    }
  }

  void _setMode(bool registering) {
    setState(() {
      _isRegistering = registering;
      _errorMessage = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Material(
        color: Colors.transparent,
        child: Dialog(
          backgroundColor: widget.colors.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          child: Container(
            width: 400,
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Text(
                      _isRegistering ? '注册账户' : '登录',
                      style: TextStyle(
                        color: widget.colors.textPrimary,
                        fontSize: 20,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const Spacer(),
                    IconButton(
                      icon: Icon(Icons.close, size: 20),
                      color: widget.colors.textSecondary,
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Container(
                  height: 38,
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(
                    color: widget.colors.background,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: widget.colors.border),
                  ),
                  child: Row(
                    children: [
                      _AuthModeButton(
                        label: '登录',
                        selected: !_isRegistering,
                        colors: widget.colors,
                        onTap: _isLoading ? null : () => _setMode(false),
                      ),
                      _AuthModeButton(
                        label: '注册',
                        selected: _isRegistering,
                        colors: widget.colors,
                        onTap: _isLoading ? null : () => _setMode(true),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                TextField(
                  controller: _usernameController,
                  decoration: InputDecoration(
                    labelText: '用户名',
                    labelStyle: TextStyle(color: widget.colors.textSecondary),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide(color: widget.colors.border),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide(
                        color: widget.colors.accent,
                        width: 2,
                      ),
                    ),
                  ),
                  style: TextStyle(color: widget.colors.textPrimary),
                  enabled: !_isLoading,
                ),
                const SizedBox(height: 16),
                if (_isRegistering) ...[
                  TextField(
                    controller: _nicknameController,
                    decoration: _authInputDecoration(
                      label: '昵称（可选）',
                      colors: widget.colors,
                    ),
                    style: TextStyle(color: widget.colors.textPrimary),
                    enabled: !_isLoading,
                  ),
                  const SizedBox(height: 16),
                ],
                TextField(
                  controller: _passwordController,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: '密码',
                    labelStyle: TextStyle(color: widget.colors.textSecondary),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide(color: widget.colors.border),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide(
                        color: widget.colors.accent,
                        width: 2,
                      ),
                    ),
                  ),
                  style: TextStyle(color: widget.colors.textPrimary),
                  enabled: !_isLoading,
                  onSubmitted: (_) => _submit(),
                ),
                if (_isRegistering) ...[
                  const SizedBox(height: 16),
                  TextField(
                    controller: _confirmPasswordController,
                    obscureText: true,
                    decoration: _authInputDecoration(
                      label: '确认密码',
                      colors: widget.colors,
                    ),
                    style: TextStyle(color: widget.colors.textPrimary),
                    enabled: !_isLoading,
                    onSubmitted: (_) => _submit(),
                  ),
                ],
                if (_errorMessage != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _errorMessage!,
                    style: TextStyle(color: Colors.red.shade400, fontSize: 13),
                  ),
                ],
                const SizedBox(height: 24),
                ElevatedButton(
                  onPressed: _isLoading ? null : _submit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: widget.colors.accent,
                    foregroundColor: widget.colors.background,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: _isLoading
                      ? SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            valueColor: AlwaysStoppedAnimation(
                              widget.colors.background,
                            ),
                          ),
                        )
                      : Text(
                          _isRegistering ? '注册并登录' : '登录',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _authInputDecoration({
    required String label,
    required DeepVibeColors colors,
  }) {
    return InputDecoration(
      labelText: label,
      labelStyle: TextStyle(color: colors.textSecondary),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: colors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: colors.accent, width: 2),
      ),
    );
  }
}

class _AuthModeButton extends StatelessWidget {
  final String label;
  final bool selected;
  final DeepVibeColors colors;
  final VoidCallback? onTap;

  const _AuthModeButton({
    required this.label,
    required this.selected,
    required this.colors,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: onTap,
        child: Container(
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? colors.surfaceVariant : Colors.transparent,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? colors.textPrimary : colors.textSecondary,
              fontSize: 13,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
      ),
    );
  }
}

class _QueueDrawer extends ConsumerStatefulWidget {
  final DeepVibeColors colors;

  const _QueueDrawer({required this.colors});

  @override
  ConsumerState<_QueueDrawer> createState() => _QueueDrawerState();
}

class _QueueDrawerState extends ConsumerState<_QueueDrawer> {
  final ScrollController _scrollController = ScrollController();
  bool _hasScrolled = false;

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToCurrentSong(int currentIndex, int queueLength) {
    if (_hasScrolled || currentIndex < 0 || currentIndex >= queueLength) return;
    if (!_scrollController.hasClients) return;

    _hasScrolled = true;

    // Wait for frame to ensure ListView is built
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;

      final itemHeight = 72.0; // padding + content height
      final viewportHeight = _scrollController.position.viewportDimension;
      // Center the current song in viewport
      final targetOffset =
          (currentIndex * itemHeight) - (viewportHeight / 2) + (itemHeight / 2);
      final maxScroll = _scrollController.position.maxScrollExtent;
      final clampedOffset = targetOffset.clamp(0.0, maxScroll);

      _scrollController.animateTo(
        clampedOffset,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final visible = ref.watch(queueDrawerVisibleProvider);
    final queue = ref.watch(playbackQueueProvider);
    final currentIndex = ref.watch(currentSongIndexProvider);

    // Reset scroll flag when drawer becomes visible
    if (visible && !_hasScrolled) {
      _scrollToCurrentSong(currentIndex, queue.length);
    } else if (!visible) {
      _hasScrolled = false;
    }

    return Stack(
      children: [
        // Backdrop to detect outside clicks
        if (visible)
          Positioned.fill(
            child: GestureDetector(
              onTap: () {
                ref.read(queueDrawerVisibleProvider.notifier).state = false;
              },
              child: Container(color: Colors.transparent),
            ),
          ),
        // Queue drawer
        AnimatedPositioned(
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeInOut,
          right: visible ? 0 : -320,
          top: 0,
          bottom: 0,
          width: 320,
          child: Material(
            elevation: 8,
            child: Container(
              color: widget.colors.surface,
              child: Column(
                children: [
                  // Header
                  Container(
                    height: 56,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    decoration: BoxDecoration(
                      border: Border(
                        bottom: BorderSide(color: widget.colors.divider),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          Icons.queue_music,
                          size: 20,
                          color: widget.colors.textSecondary,
                        ),
                        const SizedBox(width: 12),
                        Text(
                          '播放队列',
                          style: TextStyle(
                            color: widget.colors.textPrimary,
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const Spacer(),
                        IconButton(
                          icon: Icon(Icons.close, size: 20),
                          color: widget.colors.textSecondary,
                          onPressed: () {
                            ref
                                    .read(queueDrawerVisibleProvider.notifier)
                                    .state =
                                false;
                          },
                          tooltip: '关闭',
                        ),
                      ],
                    ),
                  ),
                  // Queue list
                  Expanded(
                    child: queue.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  Icons.queue_music_outlined,
                                  size: 48,
                                  color: widget.colors.textMuted.withOpacity(
                                    0.3,
                                  ),
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  '播放队列为空',
                                  style: TextStyle(
                                    color: widget.colors.textMuted,
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                          )
                        : ListView.builder(
                            controller: _scrollController,
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            itemCount: queue.length,
                            itemBuilder: (context, i) {
                              final song = queue[i];
                              final isCurrent = i == currentIndex;

                              return Material(
                                color: Colors.transparent,
                                child: InkWell(
                                  onTap: () {
                                    startSongPlayback(
                                      ref,
                                      song: song,
                                      index: i,
                                      queue: queue,
                                    );
                                  },
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 16,
                                      vertical: 12,
                                    ),
                                    decoration: BoxDecoration(
                                      color: isCurrent
                                          ? widget.colors.accent.withOpacity(
                                              0.08,
                                            )
                                          : Colors.transparent,
                                      border: Border(
                                        left: BorderSide(
                                          color: isCurrent
                                              ? widget.colors.accent
                                              : Colors.transparent,
                                          width: 3,
                                        ),
                                      ),
                                    ),
                                    child: Row(
                                      children: [
                                        SizedBox(
                                          width: 28,
                                          child: Text(
                                            '${i + 1}',
                                            textAlign: TextAlign.center,
                                            style: TextStyle(
                                              color: isCurrent
                                                  ? widget.colors.accent
                                                  : widget.colors.textMuted,
                                              fontSize: 12,
                                              fontWeight: isCurrent
                                                  ? FontWeight.w600
                                                  : FontWeight.normal,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                song['title']?.toString() ??
                                                    '未知歌曲',
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                                style: TextStyle(
                                                  color: isCurrent
                                                      ? widget.colors.accent
                                                      : widget
                                                            .colors
                                                            .textPrimary,
                                                  fontSize: 13,
                                                  fontWeight: isCurrent
                                                      ? FontWeight.w600
                                                      : FontWeight.normal,
                                                ),
                                              ),
                                              const SizedBox(height: 2),
                                              Text(
                                                song['artist']?.toString() ??
                                                    '未知艺人',
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                                style: TextStyle(
                                                  color:
                                                      widget.colors.textMuted,
                                                  fontSize: 11,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        if (isCurrent)
                                          AnimatedEqualizerIcon(
                                            color: widget.colors.accent,
                                            size: 16,
                                          ),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
