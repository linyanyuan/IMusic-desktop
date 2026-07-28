import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:window_manager/window_manager.dart';

import '../app/theme.dart';
import '../playback/playback_providers.dart';
import '../playback/playback_actions.dart';
import 'widgets/desktop_sidebar.dart';
import 'widgets/desktop_player_bar.dart';
import 'widgets/desktop_lyrics_window_controller.dart';
import 'widgets/desktop_shortcut_controller.dart';
import 'widgets/update_checker_controller.dart';
import 'widgets/playback_completion_controller.dart';
import 'widgets/animated_equalizer_icon.dart';
import 'widgets/desktop_user_login_area.dart';
import 'screens/desktop_settings_screen.dart';
import 'screens/desktop_profile_screen.dart';
import 'screens/desktop_favorites_history_screens.dart';
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
                // In-app update auto-check + dialog owner.
                const UpdateCheckerController(),
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
        return const DesktopProfileScreen();
      case DeskRoute.favorites:
        return const DesktopFavoritesScreen();
      case DeskRoute.history:
        return const DesktopHistoryScreen();
      case DeskRoute.settings:
        return const DesktopSettingsScreen();
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
                DesktopUserLoginArea(colors: colors),
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
