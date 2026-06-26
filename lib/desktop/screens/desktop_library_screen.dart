import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/models/song.dart';
import '../../playback/playback_actions.dart';
import '../../services/library_service.dart';
import '../desktop_app_shell.dart';
import '../widgets/components/desktop_cover_placeholder.dart';

class DesktopLibraryScreen extends ConsumerWidget {
  const DesktopLibraryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final tab = ref.watch(_libraryTabProvider);

    return Container(
      color: c.background,
      child: Column(
        children: [
          _Header(c: c, tab: tab),
          Expanded(
            child: switch (tab) {
              LibraryTab.favorites => _FavoritesTab(c: c),
              LibraryTab.playlists => _PlaylistsTab(c: c),
              LibraryTab.history => _HistoryTab(c: c),
              LibraryTab.offline => _OfflineTab(c: c),
            },
          ),
        ],
      ),
    );
  }
}

enum LibraryTab { favorites, playlists, history, offline }

final _libraryTabProvider = StateProvider<LibraryTab>(
  (ref) => LibraryTab.favorites,
);

class _Header extends StatelessWidget {
  final DeepVibeColors c;
  final LibraryTab tab;

  const _Header({required this.c, required this.tab});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '我的音乐',
            style: TextStyle(
              color: c.textPrimary,
              fontSize: 28,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 20),
          _Tabs(c: c, tab: tab),
        ],
      ),
    );
  }
}

class _Tabs extends ConsumerWidget {
  final DeepVibeColors c;
  final LibraryTab tab;

  const _Tabs({required this.c, required this.tab});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Row(
      children: LibraryTab.values.map((item) {
        final selected = item == tab;
        return Padding(
          padding: const EdgeInsets.only(right: 24),
          child: GestureDetector(
            onTap: () => ref.read(_libraryTabProvider.notifier).state = item,
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 8),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: selected ? c.accent : Colors.transparent,
                    width: 2,
                  ),
                ),
              ),
              child: Text(
                _label(item),
                style: TextStyle(
                  color: selected ? c.accent : c.textSecondary,
                  fontSize: 14,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  String _label(LibraryTab tab) => switch (tab) {
    LibraryTab.favorites => '我喜欢',
    LibraryTab.playlists => '我的歌单',
    LibraryTab.history => '播放历史',
    LibraryTab.offline => '离线缓存',
  };
}

class _FavoritesTab extends ConsumerWidget {
  final DeepVibeColors c;
  const _FavoritesTab({required this.c});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final songs = ref.watch(libraryProvider).likedSongs;
    if (songs.isEmpty) {
      return _EmptyState(
        c: c,
        icon: Icons.favorite_border,
        message: '还没有收藏的歌曲',
      );
    }
    return _SongList(c: c, songs: songs);
  }
}

class _HistoryTab extends ConsumerWidget {
  final DeepVibeColors c;
  const _HistoryTab({required this.c});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final songs = ref.watch(libraryProvider).playHistory;
    if (songs.isEmpty) {
      return _EmptyState(c: c, icon: Icons.history, message: '没有播放历史');
    }
    return _SongList(c: c, songs: songs);
  }
}

class _SongList extends ConsumerWidget {
  final DeepVibeColors c;
  final List<Song> songs;

  const _SongList({required this.c, required this.songs});

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
              // 标题行
              _SongListHeader(c: c),
              ...List.generate(
                songs.length,
                (index) => _SongRow(
                  song: songs[index],
                  index: index + 1,
                  c: c,
                  onTap: () {
                    final queue = songs.map((song) => song.toJson()).toList();
                    startSongPlayback(
                      ref,
                      song: queue[index],
                      index: index,
                      queue: queue,
                    );
                  },
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

class _PlaylistsTab extends ConsumerWidget {
  final DeepVibeColors c;
  const _PlaylistsTab({required this.c});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final playlists = ref.watch(libraryProvider).userPlaylists;
    if (playlists.isEmpty) {
      return _EmptyState(c: c, icon: Icons.queue_music, message: '还没有创建歌单');
    }
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 220,
        childAspectRatio: 0.75,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
      ),
      itemCount: playlists.length,
      itemBuilder: (context, index) {
        final playlist = playlists[index];
        final id = playlist['id']?.toString() ?? '';
        return _PlaylistCard(
          playlist: playlist,
          c: c,
          onTap: () {
            if (id.isEmpty) return;
            navigateDeskRoute(ref, DeskRoute.playlistDetail, playlistId: id);
          },
        );
      },
    );
  }
}

class _PlaylistCard extends StatefulWidget {
  final Map<String, dynamic> playlist;
  final DeepVibeColors c;
  final VoidCallback onTap;

  const _PlaylistCard({
    required this.playlist,
    required this.c,
    required this.onTap,
  });

  @override
  State<_PlaylistCard> createState() => _PlaylistCardState();
}

class _PlaylistCardState extends State<_PlaylistCard> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final id = widget.playlist['id']?.toString() ?? '';
    final title =
        widget.playlist['name']?.toString() ??
        widget.playlist['title']?.toString() ??
        '未命名歌单';
    final subtitle = '${_playlistSongCount(widget.playlist)} 首歌曲';

    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: Material(
        color: widget.c.surface,
        borderRadius: BorderRadius.circular(kCardRadius),
        child: InkWell(
          borderRadius: BorderRadius.circular(kCardRadius),
          onTap: widget.onTap,
          child: Container(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(kCardRadius),
                    child: Stack(
                      children: [
                        DesktopCoverPlaceholder(
                          size: 200,
                          colorSeed: id.hashCode,
                        ),
                        if (_hover)
                          Positioned.fill(
                            child: Container(
                              color: Colors.black26,
                              child: Center(
                                child: Container(
                                  width: 44,
                                  height: 44,
                                  decoration: BoxDecoration(
                                    color: widget.c.accent,
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    Icons.play_arrow,
                                    color: widget.c.background,
                                    size: 26,
                                  ),
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: widget.c.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: widget.c.textMuted, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _OfflineTab extends StatelessWidget {
  final DeepVibeColors c;
  const _OfflineTab({required this.c});

  @override
  Widget build(BuildContext context) {
    return _EmptyState(
      c: c,
      icon: Icons.download_outlined,
      message: '没有离线缓存的歌曲',
    );
  }
}

class _SongListHeader extends StatelessWidget {
  final DeepVibeColors c;

  const _SongListHeader({required this.c});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: kSongRowHeight,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: c.border, width: 0.5),
        ),
      ),
      child: Row(
        children: [
          const SizedBox(width: 32, child: Text('#', textAlign: TextAlign.center)),
          const SizedBox(width: 12),
          Expanded(
            flex: 3,
            child: Text(
              '歌曲标题',
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
              '艺人',
              style: TextStyle(
                color: c.textMuted,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Expanded(
            child: Text(
              '来源',
              style: TextStyle(
                color: c.textMuted,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(
            width: 48,
            child: Text(
              '时长',
              textAlign: TextAlign.right,
              style: TextStyle(
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

class _SongRow extends StatefulWidget {
  final Song song;
  final int index;
  final DeepVibeColors c;
  final VoidCallback onTap;

  const _SongRow({
    required this.song,
    required this.index,
    required this.c,
    required this.onTap,
  });

  @override
  State<_SongRow> createState() => _SongRowState();
}

class _SongRowState extends State<_SongRow> {
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
          child: Container(
            height: kSongRowHeight,
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
                Expanded(
                  flex: 3,
                  child: Row(
                    children: [
                      if (widget.song.isFavorite)
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
                Expanded(
                  child: Text(
                    widget.song.source,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: widget.c.textMuted, fontSize: 12),
                  ),
                ),
                SizedBox(
                  width: 48,
                  child: Text(
                    _displayDuration(widget.song),
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

class _EmptyState extends StatelessWidget {
  final DeepVibeColors c;
  final IconData icon;
  final String message;

  const _EmptyState({
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
          Icon(icon, size: 64, color: c.textMuted.withValues(alpha: 0.3)),
          const SizedBox(height: 16),
          Text(message, style: TextStyle(color: c.textMuted, fontSize: 14)),
        ],
      ),
    );
  }
}

int _playlistSongCount(Map<String, dynamic> playlist) {
  final songs = playlist['songs'];
  if (songs is List) return songs.length;
  final count = playlist['songCount'];
  if (count is int) return count;
  if (count is num) return count.round();
  return int.tryParse(count?.toString() ?? '') ?? 0;
}

String _displayDuration(Song song) {
  final raw = song.extra['duration'];
  if (raw is int) return _formatDuration(Duration(milliseconds: raw));
  if (raw is num) return _formatDuration(Duration(milliseconds: raw.round()));
  final text = song.duration.trim();
  return text.isEmpty ? '0:00' : text;
}

String _formatDuration(Duration duration) {
  final minutes = duration.inMinutes;
  final seconds = duration.inSeconds.remainder(60);
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}
