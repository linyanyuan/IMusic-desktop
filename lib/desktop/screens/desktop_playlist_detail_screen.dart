import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/models/song.dart';
import '../../core/models/playlist.dart';
import '../../services/music_service.dart';
import '../../services/library_service.dart';
import '../../services/auth_service.dart';
import '../../playback/playback_actions.dart';
import '../../playback/playback_providers.dart';
import '../desktop_app_shell.dart';
import '../playlist_song_status.dart';
import '../widgets/components/network_cover_image.dart';
import '../widgets/animated_equalizer_icon.dart';

/// PRD §8.3: 歌单详情 — header with cover+title+actions, song table with
/// multi-select, right-click context menu. Tech doc §10.2: header covers top 1/3
/// of the workbench, song table fills the rest with stable row heights.
class DesktopPlaylistDetailScreen extends ConsumerStatefulWidget {
  const DesktopPlaylistDetailScreen({super.key});

  @override
  ConsumerState<DesktopPlaylistDetailScreen> createState() =>
      _DesktopPlaylistDetailScreenState();
}

class _DesktopPlaylistDetailScreenState
    extends ConsumerState<DesktopPlaylistDetailScreen> {
  final Set<int> _selected = {};
  Playlist? _playlist;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadPlaylist();
  }

  @override
  void didUpdateWidget(DesktopPlaylistDetailScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final playlistId = ref.read(playlistDetailProvider);
    if (playlistId != null) {
      _loadPlaylist();
    }
  }

  Future<void> _loadPlaylist() async {
    final playlistId = ref.read(playlistDetailProvider);
    if (playlistId == null) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    final localPlaylist = _localUserPlaylist(ref, playlistId);
    if (localPlaylist != null) {
      if (mounted) {
        setState(() {
          _playlist = localPlaylist;
          _loading = false;
        });
      }
      return;
    }

    final musicService = ref.read(musicServiceProvider);

    try {
      final data = await musicService.getPlaylist(playlistId);
      if (data == null) {
        setState(() {
          _error = '歌单不存在';
          _loading = false;
        });
        return;
      }

      final songs =
          (data['songs'] as List?)?.whereType<Map<String, dynamic>>().map((s) {
            return Song(
              id: s['id']?.toString() ?? '',
              title: s['title']?.toString() ?? '未知标题',
              artist: s['artist']?.toString() ?? '未知艺人',
              source: s['source']?.toString() ?? 'Bilibili',
              metaSource: s['metaSource']?.toString(),
              duration: _formatDurationValue(s['duration']),
              coverUrl: s['coverUrl']?.toString(),
              resultType: s['resultType']?.toString() ?? 'song',
              songCount: s['songCount'] as int? ?? 0,
              isFavorite: s['isFavorite'] as bool? ?? false,
              isCached: s['isCached'] as bool? ?? false,
            );
          }).toList() ??
          [];

      if (mounted) {
        setState(() {
          _playlist = Playlist(
            id: playlistId,
            title: data['title']?.toString() ?? '未知歌单',
            subtitle: data['subtitle']?.toString() ?? '',
            source: data['source']?.toString() ?? 'Bilibili',
            songCount: data['songCount'] as int? ?? songs.length,
            coverUrl: data['coverUrl']?.toString(),
            songs: songs,
          );
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '加载失败: ${e.toString()}';
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<String?>(playlistDetailProvider, (previous, next) {
      if (next != null && next != previous) {
        _loadPlaylist();
      }
    });
    try {
      ref.listen<LibraryState>(libraryProvider, (previous, next) {
        final playlistId = ref.read(playlistDetailProvider);
        if (playlistId != null && _localUserPlaylist(ref, playlistId) != null) {
          _loadPlaylist();
        }
      });
    } catch (_) {}

    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;

    if (_loading) {
      return Container(
        color: c.background,
        child: Center(
          child: CircularProgressIndicator(
            valueColor: AlwaysStoppedAnimation(c.accent),
          ),
        ),
      );
    }

    if (_error != null) {
      return Container(
        color: c.background,
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.error_outline, size: 64, color: c.textMuted),
              const SizedBox(height: 16),
              Text(_error!, style: TextStyle(color: c.textMuted, fontSize: 14)),
              const SizedBox(height: 16),
              TextButton(
                onPressed: _loadPlaylist,
                child: Text('重试', style: TextStyle(color: c.accent)),
              ),
            ],
          ),
        ),
      );
    }

    if (_playlist == null) {
      return Container(
        color: c.background,
        child: Center(
          child: Text(
            '歌单不存在',
            style: TextStyle(color: c.textMuted, fontSize: 14),
          ),
        ),
      );
    }

    final playlist = _playlist!;
    final canEditSongs = _localUserPlaylistData(ref, playlist.id) != null;

    return Container(
      color: c.background,
      child: Column(
        children: [
          _Header(playlist: playlist, c: c),
          Expanded(
            child: _SongTable(
              playlist: playlist,
              c: c,
              selected: _selected,
              canEditSongs: canEditSongs,
              onSelect: (i) => setState(() {
                if (_selected.contains(i)) {
                  _selected.remove(i);
                } else {
                  _selected.add(i);
                }
              }),
              onSelectAll: () => setState(() {
                if (_selected.length == playlist.songs.length) {
                  _selected.clear();
                } else {
                  _selected.addAll(
                    List.generate(playlist.songs.length, (i) => i),
                  );
                }
              }),
              onRemoveSelected: () async {
                final ids = _selected
                    .map((i) => playlist.songs[i].id)
                    .where((id) => id.isNotEmpty)
                    .toSet();
                await _removeSongsFromPlaylist(context, ref, playlist.id, ids);
                if (mounted) setState(_selected.clear);
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _Header extends ConsumerWidget {
  final Playlist playlist;
  final DeepVibeColors c;

  const _Header({required this.playlist, required this.c});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final library = ref.watch(libraryProvider);
    final localPlaylist = _localUserPlaylistData(ref, playlist.id);
    final isLocalCreated = localPlaylist?['isCollected'] == false;
    final isCollected = library.userPlaylists.any(
      (item) =>
          item['id']?.toString() == playlist.id && item['isCollected'] == true,
    );

    return Container(
      height: 280,
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [c.surface, c.surfaceVariant.withOpacity(0.3)],
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(kCardRadius),
            child: NetworkCoverImage(
              imageUrl: playlist.coverUrl,
              size: 160,
              colorSeed: playlist.id.hashCode,
            ),
          ),
          const SizedBox(width: 24),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: c.accent.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: c.accent.withOpacity(0.3)),
                  ),
                  child: Text(
                    '歌单',
                    style: TextStyle(
                      color: c.accent,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Flexible(
                  child: Text(
                    playlist.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: c.textPrimary,
                      fontSize: 24,
                      fontWeight: FontWeight.w600,
                      height: 1.2,
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  playlist.subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: c.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Text(
                      '${playlist.songCount} 首歌曲',
                      style: TextStyle(color: c.textMuted, fontSize: 13),
                    ),
                    const SizedBox(width: 12),
                    Text('·', style: TextStyle(color: c.textMuted)),
                    const SizedBox(width: 12),
                    Text(
                      playlist.source,
                      style: TextStyle(color: c.textMuted, fontSize: 13),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                Row(
                  children: [
                    _ActionButton(
                      icon: Icons.play_arrow,
                      label: '播放全部',
                      primary: true,
                      c: c,
                      onTap: () {
                        if (playlist.songs.isNotEmpty) {
                          final musicService = ref.read(musicServiceProvider);
                          final queueMaps = playlist.songs.map((s) {
                            return musicService.getCachedSongMap(s.id) ??
                                {
                                  'id': s.id,
                                  'title': s.title,
                                  'artist': s.artist,
                                  'source': s.source,
                                  'duration': _parseDuration(s.duration),
                                  'coverUrl': s.coverUrl,
                                  'resultType': s.resultType,
                                  'sourceLabel': s.sourceLabel,
                                };
                          }).toList();
                          startSongPlayback(
                            ref,
                            song: queueMaps.first,
                            index: 0,
                            queue: queueMaps,
                          );
                        }
                      },
                    ),
                    const SizedBox(width: 12),
                    if (!isLocalCreated)
                      _ActionButton(
                        key: const ValueKey('playlist-collect-button'),
                        icon: isCollected
                            ? Icons.favorite
                            : Icons.favorite_border,
                        label: isCollected ? '已收藏' : '收藏',
                        primary: isCollected,
                        c: c,
                        onTap: () => _collectPlaylist(context, ref, playlist),
                      ),
                    if (localPlaylist != null) ...[
                      const SizedBox(width: 12),
                      _ActionButton(
                        key: const ValueKey('playlist-delete-button'),
                        icon: Icons.delete_outline,
                        label: isCollected ? '取消收藏' : '删除歌单',
                        primary: false,
                        danger: true,
                        c: c,
                        onTap: () => _confirmDeletePlaylist(
                          context,
                          ref,
                          playlist,
                          isCollected: isCollected,
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _collectPlaylist(
    BuildContext context,
    WidgetRef ref,
    Playlist playlist,
  ) async {
    final auth = ref.read(authProvider);
    final token = auth.token;
    if (token == null || token.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('请先登录'), duration: Duration(seconds: 2)),
      );
      return;
    }

    try {
      // Convert playlist to Map format for storage
      final playlistMap = {
        'id': playlist.id,
        'name': playlist.title,
        'description': playlist.subtitle,
        'coverUrl': playlist.coverUrl,
        'songs': playlist.songs.map((s) => s.toJson()).toList(),
        'source': playlist.source,
        'songCount': playlist.songCount,
      };

      await ref
          .read(libraryProvider.notifier)
          .collectPlaylist(token, playlistMap);

      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('已收藏歌单：${playlist.title}'),
          duration: Duration(seconds: 2),
        ),
      );
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('收藏失败'), duration: Duration(seconds: 2)),
      );
    }
  }

  Future<void> _confirmDeletePlaylist(
    BuildContext context,
    WidgetRef ref,
    Playlist playlist, {
    required bool isCollected,
  }) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(isCollected ? '取消收藏歌单' : '删除歌单'),
        content: Text(
          isCollected
              ? '确定从收藏的歌单中移除「${playlist.title}」吗？'
              : '确定删除「${playlist.title}」吗？',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(isCollected ? '取消收藏' : '删除'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!context.mounted) return;

    final auth = ref.read(authProvider);
    final token = auth.token;
    if (token == null || token.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('请先登录'), duration: Duration(seconds: 2)),
      );
      return;
    }

    try {
      await ref
          .read(libraryProvider.notifier)
          .deletePlaylist(token, playlist.id);
      if (!context.mounted) return;
      ref.read(playlistDetailProvider.notifier).state = null;
      final backRoute = ref.read(playlistBackRouteProvider);
      ref.read(deskRouteProvider.notifier).state =
          backRoute ?? DeskRoute.profile;
      ref.read(playlistBackRouteProvider.notifier).state = null;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            isCollected ? '已取消收藏：${playlist.title}' : '已删除歌单：${playlist.title}',
          ),
          duration: Duration(seconds: 2),
        ),
      );
    } catch (_) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(isCollected ? '取消收藏失败' : '删除失败'),
          duration: Duration(seconds: 2),
        ),
      );
    }
  }
}

class _ActionButton extends StatefulWidget {
  final IconData icon;
  final String label;
  final bool primary;
  final bool danger;
  final DeepVibeColors c;
  final VoidCallback onTap;

  const _ActionButton({
    super.key,
    required this.icon,
    required this.label,
    required this.primary,
    this.danger = false,
    required this.c,
    required this.onTap,
  });

  @override
  State<_ActionButton> createState() => _ActionButtonState();
}

class _ActionButtonState extends State<_ActionButton> {
  @override
  Widget build(BuildContext context) {
    final foreground = widget.danger
        ? Colors.redAccent
        : widget.primary
        ? widget.c.background
        : widget.c.textPrimary;
    return Material(
      color: widget.primary ? widget.c.accent : widget.c.surface,
      borderRadius: BorderRadius.circular(kCardRadius),
      child: InkWell(
        borderRadius: BorderRadius.circular(kCardRadius),
        onTap: widget.onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            border: widget.primary ? null : Border.all(color: widget.c.border),
            borderRadius: BorderRadius.circular(kCardRadius),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(widget.icon, size: 18, color: foreground),
              const SizedBox(width: 8),
              Text(
                widget.label,
                style: TextStyle(
                  color: foreground,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SongTable extends ConsumerWidget {
  final Playlist playlist;
  final DeepVibeColors c;
  final Set<int> selected;
  final bool canEditSongs;
  final ValueChanged<int> onSelect;
  final VoidCallback onSelectAll;
  final Future<void> Function() onRemoveSelected;

  const _SongTable({
    required this.playlist,
    required this.c,
    required this.selected,
    required this.canEditSongs,
    required this.onSelect,
    required this.onSelectAll,
    required this.onRemoveSelected,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      color: c.background,
      child: Column(
        children: [
          _TableHeader(
            c: c,
            selectedCount: selected.length,
            canEditSongs: canEditSongs,
            allSelected:
                selected.length == playlist.songs.length &&
                playlist.songs.isNotEmpty,
            onSelectAll: onSelectAll,
            onRemoveSelected: onRemoveSelected,
          ),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              itemCount: playlist.songs.length,
              itemBuilder: (context, i) {
                final song = playlist.songs[i];
                return _SongRow(
                  song: song,
                  index: i + 1,
                  c: c,
                  selected: selected.contains(i),
                  playlistId: playlist.id,
                  canRemoveFromPlaylist: canEditSongs,
                  onTap: () {
                    final musicService = ref.read(musicServiceProvider);
                    final queueMaps = playlist.songs.map((s) {
                      return musicService.getCachedSongMap(s.id) ??
                          {
                            'id': s.id,
                            'title': s.title,
                            'artist': s.artist,
                            'source': s.source,
                            'duration': _parseDuration(s.duration),
                            'coverUrl': s.coverUrl,
                            'resultType': s.resultType,
                            'sourceLabel': s.sourceLabel,
                          };
                    }).toList();
                    startSongPlayback(
                      ref,
                      song: queueMaps[i],
                      index: i,
                      queue: queueMaps,
                    );
                  },
                  onSelect: () => onSelect(i),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _TableHeader extends StatelessWidget {
  final DeepVibeColors c;
  final int selectedCount;
  final bool canEditSongs;
  final bool allSelected;
  final VoidCallback onSelectAll;
  final Future<void> Function() onRemoveSelected;

  const _TableHeader({
    required this.c,
    required this.selectedCount,
    required this.canEditSongs,
    required this.allSelected,
    required this.onSelectAll,
    required this.onRemoveSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: c.divider)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 32,
            child: Checkbox(
              value: allSelected,
              onChanged: (_) => onSelectAll(),
              activeColor: c.accent,
              side: BorderSide(color: c.border),
            ),
          ),
          const SizedBox(width: 12),
          if (canEditSongs && selectedCount > 0) ...[
            Text(
              '已选 $selectedCount 首',
              style: TextStyle(
                color: c.textSecondary,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 12),
            TextButton.icon(
              key: const ValueKey('playlist-remove-selected'),
              onPressed: onRemoveSelected,
              icon: const Icon(Icons.delete_outline, size: 16),
              label: const Text('移除'),
              style: TextButton.styleFrom(
                foregroundColor: Colors.redAccent,
                textStyle: const TextStyle(fontSize: 12),
              ),
            ),
            const Spacer(),
          ] else ...[
            SizedBox(
              width: 32,
              child: Text(
                '#',
                style: TextStyle(
                  color: c.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              flex: 3,
              child: Text(
                '标题',
                style: TextStyle(
                  color: c.textMuted,
                  fontSize: 12,
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
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Expanded(
              child: Text(
                '来源',
                style: TextStyle(
                  color: c.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            SizedBox(
              width: 48,
              child: Text(
                '时长',
                textAlign: TextAlign.right,
                style: TextStyle(
                  color: c.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SongRow extends ConsumerStatefulWidget {
  final Song song;
  final int index;
  final DeepVibeColors c;
  final bool selected;
  final String playlistId;
  final bool canRemoveFromPlaylist;
  final VoidCallback onTap;
  final VoidCallback onSelect;

  const _SongRow({
    required this.song,
    required this.index,
    required this.c,
    required this.selected,
    required this.playlistId,
    required this.canRemoveFromPlaylist,
    required this.onTap,
    required this.onSelect,
  });

  @override
  ConsumerState<_SongRow> createState() => _SongRowState();
}

class _SongRowState extends ConsumerState<_SongRow> {
  bool _hover = false;

  void _toggleFavorite() async {
    final auth = ref.read(authProvider);
    final token = auth.token;
    if (token == null || token.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('请先登录'), duration: Duration(seconds: 2)),
      );
      return;
    }

    final isLiked = ref
        .read(libraryProvider)
        .likedSongs
        .any((song) => song.id == widget.song.id);
    try {
      await ref
          .read(libraryProvider.notifier)
          .toggleLike(token, widget.song.copyWith(isFavorite: isLiked));
      if (!mounted) return;
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('操作失败'), duration: Duration(seconds: 2)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentSong = ref.watch(currentSongProvider);
    final library = ref.watch(libraryProvider);
    final isFavorite = library.likedSongs.any(
      (song) => song.id == widget.song.id,
    );
    final isCurrent =
        currentSong != null && currentSong['id']?.toString() == widget.song.id;

    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        onSecondaryTapDown: (details) => _showContextMenu(context, details),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: widget.onTap,
            child: Container(
              height: kSongRowHeight,
              padding: const EdgeInsets.symmetric(horizontal: 0),
              decoration: BoxDecoration(
                color: isCurrent
                    ? widget.c.accent.withOpacity(0.08)
                    : widget.selected
                    ? widget.c.accent.withOpacity(0.08)
                    : _hover
                    ? widget.c.surfaceVariant.withOpacity(0.5)
                    : Colors.transparent,
              ),
              child: Row(
                children: [
                  const SizedBox(width: 16),
                  SizedBox(
                    width: 32,
                    child: isCurrent
                        ? AnimatedEqualizerIcon(
                            color: widget.c.accent,
                            size: 16,
                          )
                        : Text(
                            '${widget.index}',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: widget.c.textMuted,
                              fontSize: 12,
                            ),
                          ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 24,
                    child: Checkbox(
                      key: ValueKey('playlist-select-${widget.song.id}'),
                      value: widget.selected,
                      onChanged: (_) => widget.onSelect(),
                      activeColor: widget.c.accent,
                      side: BorderSide(color: widget.c.border),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Heart icon for favorite
                  IconButton(
                    key: ValueKey('playlist-like-${widget.song.id}'),
                    icon: Icon(
                      isFavorite ? Icons.favorite : Icons.favorite_border,
                      size: 16,
                      color: isFavorite ? Colors.red : widget.c.textMuted,
                    ),
                    color: isFavorite ? Colors.red : widget.c.textMuted,
                    onPressed: () => _toggleFavorite(),
                    padding: EdgeInsets.zero,
                    constraints: BoxConstraints(minWidth: 24, minHeight: 24),
                    iconSize: 16,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 3,
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            widget.song.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: isCurrent
                                  ? widget.c.accent
                                  : widget.c.textPrimary,
                              fontSize: 13,
                              fontWeight: isCurrent
                                  ? FontWeight.w600
                                  : FontWeight.normal,
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
                      widget.song.duration,
                      textAlign: TextAlign.right,
                      style: TextStyle(color: widget.c.textMuted, fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _showContextMenu(BuildContext context, TapDownDetails details) {
    final library = ref.read(libraryProvider);
    final playlists = library.userPlaylists;

    showMenu(
      context: context,
      position: RelativeRect.fromLTRB(
        details.globalPosition.dx,
        details.globalPosition.dy,
        details.globalPosition.dx,
        details.globalPosition.dy,
      ),
      items: [
        PopupMenuItem(
          onTap: () {
            // Play this song
            Future.delayed(Duration.zero, widget.onTap);
          },
          child: Row(
            children: [
              Icon(Icons.play_arrow, size: 16, color: widget.c.textSecondary),
              const SizedBox(width: 12),
              Text('播放', style: TextStyle(fontSize: 13)),
            ],
          ),
        ),
        PopupMenuItem(
          onTap: () {
            // Play next - insert after current song
            Future.delayed(Duration.zero, () {
              _playNext();
            });
          },
          child: Row(
            children: [
              Icon(Icons.skip_next, size: 16, color: widget.c.textSecondary),
              const SizedBox(width: 12),
              Text('下一首播放', style: TextStyle(fontSize: 13)),
            ],
          ),
        ),
        PopupMenuItem(
          enabled: false,
          child: Row(
            children: [
              Icon(Icons.playlist_add, size: 16, color: widget.c.textSecondary),
              const SizedBox(width: 12),
              Text('添加到歌单', style: TextStyle(fontSize: 13)),
              const Spacer(),
              Icon(Icons.arrow_right, size: 16, color: widget.c.textMuted),
            ],
          ),
        ),
        // Submenu items for playlists
        if (playlists.isEmpty)
          PopupMenuItem(
            enabled: false,
            child: Padding(
              padding: const EdgeInsets.only(left: 28),
              child: Text(
                '暂无歌单',
                style: TextStyle(fontSize: 12, color: widget.c.textMuted),
              ),
            ),
          )
        else
          ...playlists.map((playlist) {
            final name = _nonEmptyText(playlist['name']) ??
                _nonEmptyText(playlist['title']) ??
                '未命名歌单';
            final alreadyAdded = playlistContainsSong(playlist, widget.song);
            return PopupMenuItem(
              enabled: !alreadyAdded,
              onTap: alreadyAdded
                  ? null
                  : () {
                      Future.delayed(Duration.zero, () {
                        _addToPlaylist(playlist['id']?.toString() ?? '');
                      });
                    },
              child: Padding(
                padding: const EdgeInsets.only(left: 28),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textPrimary,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    if (alreadyAdded) ...[
                      const SizedBox(width: 12),
                      Icon(Icons.check, size: 14, color: widget.c.accent),
                      const SizedBox(width: 4),
                      Text(
                        '已添加',
                        style: TextStyle(
                          color: widget.c.textMuted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            );
          }),
        if (widget.canRemoveFromPlaylist)
          PopupMenuItem(
            onTap: () {
              Future.delayed(Duration.zero, () {
                _removeFromPlaylist();
              });
            },
            child: Row(
              children: [
                Icon(Icons.delete_outline, size: 16, color: Colors.redAccent),
                const SizedBox(width: 12),
                Text('从歌单移除', style: TextStyle(fontSize: 13)),
              ],
            ),
          ),
      ],
    );
  }

  void _playNext() async {
    final queue = ref.read(playbackQueueProvider);
    final currentIndex = ref.read(currentSongIndexProvider);

    // Insert song after current position
    final newQueue = List<Map<String, dynamic>>.from(queue);
    newQueue.insert(currentIndex + 1, widget.song.toJson());

    ref.read(playbackQueueProvider.notifier).state = newQueue;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('已添加到下一首：${widget.song.title}'),
        duration: Duration(seconds: 2),
      ),
    );
  }

  void _addToPlaylist(String playlistId) async {
    final auth = ref.read(authProvider);
    final token = auth.token;
    if (token == null || token.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('请先登录'), duration: Duration(seconds: 2)),
      );
      return;
    }

    try {
      await ref
          .read(libraryProvider.notifier)
          .addSongToPlaylist(token, playlistId, widget.song);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('已添加到歌单'), duration: Duration(seconds: 2)),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('添加失败'), duration: Duration(seconds: 2)),
      );
    }
  }

  void _removeFromPlaylist() async {
    await _removeSongsFromPlaylist(context, ref, widget.playlistId, {
      widget.song.id,
    });
  }
}

Future<void> _removeSongsFromPlaylist(
  BuildContext context,
  WidgetRef ref,
  String playlistId,
  Set<String> songIds,
) async {
  if (songIds.isEmpty) return;
  final auth = ref.read(authProvider);
  final token = auth.token;
  if (token == null || token.isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('请先登录'), duration: Duration(seconds: 2)),
    );
    return;
  }

  try {
    await ref
        .read(libraryProvider.notifier)
        .removeSongsFromPlaylist(token, playlistId, songIds);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('已从歌单移除'), duration: Duration(seconds: 2)),
    );
  } catch (_) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('移除失败'), duration: Duration(seconds: 2)),
    );
  }
}

Playlist? _localUserPlaylist(WidgetRef ref, String playlistId) {
  final data = _localUserPlaylistData(ref, playlistId);
  if (data == null) return null;

  final songs =
      (data['songs'] as List?)
          ?.whereType<Map>()
          .map((song) => song.cast<String, dynamic>())
          .map(
            (song) => Song.fromJson(
              song,
            ).copyWith(duration: _formatDurationValue(song['duration'])),
          )
          .toList() ??
      [];
  final title = _nonEmptyText(data['name']) ??
      _nonEmptyText(data['title']) ??
      '未命名歌单';
  final subtitle = _nonEmptyText(data['description']) ??
      _nonEmptyText(data['subtitle']) ??
      '';

  return Playlist(
    id: playlistId,
    title: title,
    subtitle: subtitle,
    source: data['source']?.toString() ?? '我的歌单',
    songCount: _playlistSongCount(data, songs.length),
    coverUrl: data['coverUrl']?.toString(),
    songs: songs,
  );
}

Map<String, dynamic>? _localUserPlaylistData(WidgetRef ref, String playlistId) {
  final LibraryState library;
  try {
    library = ref.read(libraryProvider);
  } catch (_) {
    return null;
  }
  for (final playlist in library.userPlaylists) {
    if (playlist['id']?.toString() == playlistId) {
      return playlist;
    }
  }
  return null;
}

int _playlistSongCount(Map<String, dynamic> playlist, int fallback) {
  final count = playlist['songCount'];
  if (count is int) return count;
  if (count is num) return count.round();
  return int.tryParse(count?.toString() ?? '') ?? fallback;
}

/// Helper function to parse duration string to milliseconds
int _parseDuration(String duration) {
  final parts = duration.split(':');
  if (parts.length == 2) {
    final minutes = int.tryParse(parts[0]) ?? 0;
    final seconds = int.tryParse(parts[1]) ?? 0;
    return (minutes * 60 + seconds) * 1000;
  }
  return 0;
}

String _formatDurationValue(Object? value) {
  final milliseconds = _durationMilliseconds(value);
  final minutes = milliseconds ~/ 60000;
  final seconds = (milliseconds ~/ 1000).remainder(60);
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}

int _durationMilliseconds(Object? value) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

String? _nonEmptyText(Object? value) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}
