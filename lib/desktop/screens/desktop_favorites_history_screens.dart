import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/models/song.dart';
import '../../playback/playback_actions.dart';
import '../../services/auth_service.dart';
import '../../services/library_service.dart';
import '../widgets/desktop_empty_states.dart';

/// Favorites screen - shows liked songs
class DesktopFavoritesScreen extends ConsumerStatefulWidget {
  const DesktopFavoritesScreen({super.key});

  @override
  ConsumerState<DesktopFavoritesScreen> createState() =>
      _DesktopFavoritesScreenState();
}

class _DesktopFavoritesScreenState
    extends ConsumerState<DesktopFavoritesScreen> {
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
                ? DesktopNotLoggedInState(c: c, message: '登录后查看收藏的歌曲')
                : libraryState.isLoading
                ? Center(child: CircularProgressIndicator(color: c.accent))
                : libraryState.likedSongs.isEmpty
                ? DesktopEmptyDataState(
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
class DesktopHistoryScreen extends ConsumerStatefulWidget {
  const DesktopHistoryScreen({super.key});

  @override
  ConsumerState<DesktopHistoryScreen> createState() =>
      _DesktopHistoryScreenState();
}

class _DesktopHistoryScreenState extends ConsumerState<DesktopHistoryScreen> {
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
                ? DesktopNotLoggedInState(c: c, message: '登录后查看播放历史')
                : libraryState.isLoading
                ? Center(child: CircularProgressIndicator(color: c.accent))
                : libraryState.playHistory.isEmpty
                ? DesktopEmptyDataState(
                    c: c,
                    icon: Icons.history,
                    message: '没有播放历史',
                  )
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
