import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/models/song.dart';
import '../../core/models/playlist.dart';
import '../../core/song_identity.dart';
import '../../services/auth_service.dart';
import '../../services/library_service.dart';
import '../../services/music_service.dart';
import '../../services/music_provider.dart';
import '../../playback/playback_actions.dart';
import '../../playback/playback_providers.dart';
import '../desktop_app_shell.dart';
import '../playlist_song_status.dart';

/// Search state providers
final searchQueryProvider = StateProvider<String>((ref) => '');
final searchResultsProvider = StateProvider<List<Song>>((ref) => []);
final searchLoadingProvider = StateProvider<bool>((ref) => false);
final searchLoadingMoreProvider = StateProvider<bool>((ref) => false);
final searchPageProvider = StateProvider<int>((ref) => 1);
final searchHasMoreProvider = StateProvider<bool>((ref) => false);
final searchTabProvider = StateProvider<SearchTab>((ref) => SearchTab.all);

/// Hint used to decide whether another page is likely available.
const kSearchPageSizeHint = 20;

/// PRD §7.1: 搜索页 — search bar with Ctrl+F hint, tabs All/Songs/Playlists/Artists,
/// song table, empty/loading/error states. Tech doc §8.1: search is purely local
/// filtering over existing data, no external API call in the first scaffold.
class DesktopSearchScreen extends ConsumerStatefulWidget {
  const DesktopSearchScreen({super.key});

  @override
  ConsumerState<DesktopSearchScreen> createState() =>
      _DesktopSearchScreenState();
}

class _DesktopSearchScreenState extends ConsumerState<DesktopSearchScreen> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  int _searchRequestId = 0;

  @override
  void initState() {
    super.initState();
    // Restore search query from provider
    final savedQuery = ref.read(searchQueryProvider);
    if (savedQuery.isNotEmpty) {
      _controller.text = savedQuery;
    }
    final pendingResults = ref
        .read(searchResultsProvider)
        .where(
          (song) => song.extra['playlistSummaryState']?.toString() == 'loading',
        )
        .toList();
    if (pendingResults.isNotEmpty) {
      final requestId = ++_searchRequestId;
      final musicService = ref.read(musicServiceProvider);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || requestId != _searchRequestId) return;
        unawaited(
          _enrichPlaylistResults(
            pendingResults,
            requestId: requestId,
            musicService: musicService,
          ),
        );
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  MusicSearchScope _scopeForTab(SearchTab tab) => switch (tab) {
    SearchTab.songs => MusicSearchScope.metadataSongs,
    SearchTab.playlists => MusicSearchScope.bilibiliPlaylists,
    SearchTab.all => MusicSearchScope.all,
  };

  Future<void> _search(String q) async {
    final query = q.trim();
    final tab = ref.read(searchTabProvider);
    final scope = _scopeForTab(tab);
    final requestId = ++_searchRequestId;
    print('[SearchScreen] 搜索关键词: $query tab=$tab scope=$scope id=$requestId');

    ref.read(searchQueryProvider.notifier).state = query;
    ref.read(searchLoadingProvider.notifier).state = true;
    ref.read(searchLoadingMoreProvider.notifier).state = false;
    ref.read(searchPageProvider.notifier).state = 1;
    ref.read(searchHasMoreProvider.notifier).state = false;
    ref.read(searchResultsProvider.notifier).state = [];

    if (query.isEmpty) {
      if (requestId == _searchRequestId) {
        ref.read(searchLoadingProvider.notifier).state = false;
      }
      return;
    }

    final musicService = ref.read(musicServiceProvider);

    try {
      print('[SearchScreen] 开始搜索 page=1...');
      final results = await musicService.searchSongs(
        query,
        scope: scope,
        page: 1,
      );
      print('[SearchScreen] 搜索结果: ${results.length} 首');
      if (!mounted || requestId != _searchRequestId) return;
      final visibleResults = _toVisibleResults(results);
      ref.read(searchResultsProvider.notifier).state = visibleResults;
      ref.read(searchPageProvider.notifier).state = 1;
      ref.read(searchHasMoreProvider.notifier).state =
          results.length >= kSearchPageSizeHint;
      ref.read(searchLoadingProvider.notifier).state = false;
      unawaited(
        _enrichPlaylistResults(
          visibleResults,
          requestId: requestId,
          musicService: musicService,
        ),
      );
    } catch (e) {
      print('[SearchScreen] 搜索失败: $e');
      if (!mounted || requestId != _searchRequestId) return;
      ref.read(searchLoadingProvider.notifier).state = false;
      ref.read(searchHasMoreProvider.notifier).state = false;
    }
  }

  Future<void> _loadMore() async {
    final query = ref.read(searchQueryProvider).trim();
    if (query.isEmpty) return;
    if (ref.read(searchLoadingProvider) || ref.read(searchLoadingMoreProvider)) {
      return;
    }
    if (!ref.read(searchHasMoreProvider)) return;

    final tab = ref.read(searchTabProvider);
    final scope = _scopeForTab(tab);
    final nextPage = ref.read(searchPageProvider) + 1;
    final requestId = _searchRequestId;
    final musicService = ref.read(musicServiceProvider);

    ref.read(searchLoadingMoreProvider.notifier).state = true;
    print('[SearchScreen] 加载更多 page=$nextPage query=$query scope=$scope');

    try {
      final results = await musicService.searchSongs(
        query,
        scope: scope,
        page: nextPage,
      );
      if (!mounted || requestId != _searchRequestId) return;

      final existing = ref.read(searchResultsProvider);
      final existingIds = existing.map((s) => s.id).toSet();
      final visibleResults = _toVisibleResults(results);
      final newItems = visibleResults
          .where((song) => !existingIds.contains(song.id))
          .toList();

      if (newItems.isEmpty) {
        ref.read(searchHasMoreProvider.notifier).state = false;
        ref.read(searchLoadingMoreProvider.notifier).state = false;
        print('[SearchScreen] 加载更多无新结果，结束分页');
        return;
      }

      ref.read(searchResultsProvider.notifier).state = [
        ...existing,
        ...newItems,
      ];
      ref.read(searchPageProvider.notifier).state = nextPage;
      ref.read(searchHasMoreProvider.notifier).state =
          results.length >= kSearchPageSizeHint;
      ref.read(searchLoadingMoreProvider.notifier).state = false;
      unawaited(
        _enrichPlaylistResults(
          newItems,
          requestId: requestId,
          musicService: musicService,
        ),
      );
    } catch (e) {
      print('[SearchScreen] 加载更多失败: $e');
      if (!mounted || requestId != _searchRequestId) return;
      ref.read(searchLoadingMoreProvider.notifier).state = false;
    }
  }

  List<Song> _toVisibleResults(List<Song> results) {
    return results
        .where(
          (song) => song.resultType == 'song' || song.resultType == 'playlist',
        )
        .map(
          (song) => song.isPlaylist
              ? song.copyWith(
                  extra: {...song.extra, 'playlistSummaryState': 'loading'},
                )
              : song,
        )
        .toList();
  }

  Future<void> _enrichPlaylistResults(
    List<Song> results, {
    required int requestId,
    required MusicService musicService,
  }) async {
    final playlists = results.where((song) => song.isPlaylist).toList();
    var nextIndex = 0;

    Future<void> worker() async {
      while (nextIndex < playlists.length) {
        final playlist = playlists[nextIndex++];
        final summary = await musicService.getPlaylistSummary(playlist);
        if (!mounted || requestId != _searchRequestId) return;

        final current = ref.read(searchResultsProvider);
        final index = current.indexWhere(
          (song) => song.id == playlist.id && song.isPlaylist,
        );
        if (index < 0) continue;

        final existing = current[index];
        final count = summary.kind == PlaylistSummaryKind.multiPage
            ? summary.songCount
            : existing.songCount > 1
            ? existing.songCount
            : summary.songCount;
        final updated = existing.copyWith(
          songCount: count,
          extra: {
            ...existing.extra,
            'playlistSummaryState': summary.available ? 'ready' : 'unavailable',
            'playlistSummaryKind': summary.kind?.name,
            'playlistSummaryDurationSeconds': summary.durationSeconds,
          },
        );
        ref.read(searchResultsProvider.notifier).state = [
          ...current.take(index),
          updated,
          ...current.skip(index + 1),
        ];
      }
    }

    await Future.wait(List.generate(min(4, playlists.length), (_) => worker()));
  }

  void _onTabChanged(SearchTab tab) {
    ref.read(searchTabProvider.notifier).state = tab;
    final query = ref.read(searchQueryProvider);
    if (query.isNotEmpty) {
      _search(query);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;

    final tab = ref.watch(searchTabProvider);
    final loading = ref.watch(searchLoadingProvider);
    final loadingMore = ref.watch(searchLoadingMoreProvider);
    final hasMore = ref.watch(searchHasMoreProvider);
    final searchResults = ref.watch(searchResultsProvider);
    final query = ref.watch(searchQueryProvider);

    return Container(
      color: c.background,
      child: Column(
        children: [
          _SearchBar(
            controller: _controller,
            focusNode: _focusNode,
            c: c,
            loading: loading,
            onSearch: () => _search(_controller.text),
          ),
          _Tabs(c: c, tab: tab, onTabChanged: _onTabChanged),
          Expanded(
            child: loading
                ? Center(
                    child: SizedBox(
                      width: 28,
                      height: 28,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        valueColor: AlwaysStoppedAnimation(c.accent),
                      ),
                    ),
                  )
                : query.isEmpty
                ? _EmptyState(c: c)
                : _Results(
                    c: c,
                    songs: searchResults,
                    tab: tab,
                    hasMore: hasMore,
                    loadingMore: loadingMore,
                    onLoadMore: _loadMore,
                  ),
          ),
        ],
      ),
    );
  }
}

enum SearchTab { all, songs, playlists }

class _SearchBar extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focusNode;
  final DeepVibeColors c;
  final bool loading;
  final VoidCallback onSearch;

  const _SearchBar({
    required this.controller,
    required this.focusNode,
    required this.c,
    required this.loading,
    required this.onSearch,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 16),
      child: Container(
        height: 48,
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(kCardRadius),
          border: Border.all(color: c.border),
        ),
        child: Row(
          children: [
            const SizedBox(width: 14),
            Icon(Icons.search, size: 20, color: c.textMuted),
            const SizedBox(width: 10),
            Expanded(
              child: TextField(
                controller: controller,
                focusNode: focusNode,
                textInputAction: TextInputAction.search,
                // Desktop Enter / IME search action.
                onSubmitted: (_) {
                  if (!loading) onSearch();
                },
                onEditingComplete: () {
                  if (!loading) onSearch();
                },
                style: TextStyle(color: c.textPrimary, fontSize: 15),
                decoration: InputDecoration(
                  hintText: '搜索歌曲、歌单',
                  hintStyle: TextStyle(color: c.textMuted),
                  border: InputBorder.none,
                  isDense: true,
                ),
              ),
            ),
            Container(
              margin: const EdgeInsets.only(right: 12),
              child: TextButton.icon(
                key: const ValueKey('search-submit-button'),
                onPressed: loading ? null : onSearch,
                icon: loading
                    ? SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation(c.accent),
                        ),
                      )
                    : const Icon(Icons.search, size: 16),
                label: const Text('搜索'),
                style:
                    TextButton.styleFrom(
                      foregroundColor: c.accent,
                      disabledForegroundColor: c.textMuted,
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      minimumSize: const Size(0, 34),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(6),
                      ),
                    ).copyWith(
                      backgroundColor: WidgetStatePropertyAll(
                        c.accent.withValues(alpha: 0.1),
                      ),
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Tabs extends StatelessWidget {
  final DeepVibeColors c;
  final SearchTab tab;
  final ValueChanged<SearchTab> onTabChanged;

  const _Tabs({required this.c, required this.tab, required this.onTabChanged});

  @override
  Widget build(BuildContext context) {
    final tabs = SearchTab.values;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      height: 40,
      child: Row(
        children: tabs.map((t) {
          final selected = t == tab;
          return Padding(
            padding: const EdgeInsets.only(right: 24),
            child: GestureDetector(
              onTap: () => onTabChanged(t),
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
                  _label(t),
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
      ),
    );
  }

  String _label(SearchTab t) => switch (t) {
    SearchTab.all => '全部',
    SearchTab.songs => '歌曲',
    SearchTab.playlists => '歌单',
  };
}

class _EmptyState extends StatelessWidget {
  final DeepVibeColors c;
  const _EmptyState({required this.c});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.search, size: 64, color: c.textMuted.withOpacity(0.3)),
          const SizedBox(height: 16),
          Text(
            '搜索音乐内容',
            style: TextStyle(
              color: c.textMuted,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 6),
          Text('输入关键词开始搜索', style: TextStyle(color: c.textMuted, fontSize: 13)),
        ],
      ),
    );
  }
}

class _Results extends ConsumerWidget {
  final DeepVibeColors c;
  final List<Song> songs;
  final SearchTab tab;
  final bool hasMore;
  final bool loadingMore;
  final VoidCallback onLoadMore;

  const _Results({
    required this.c,
    required this.songs,
    required this.tab,
    required this.hasMore,
    required this.loadingMore,
    required this.onLoadMore,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final playlistResults = songs.where((song) => song.isPlaylist).toList();
    final songResults = songs.where((song) => !song.isPlaylist).toList();
    final showPlaylists = tab == SearchTab.all || tab == SearchTab.playlists;
    final showSongs = tab == SearchTab.all || tab == SearchTab.songs;
    final hasVisibleResults =
        (showPlaylists && playlistResults.isNotEmpty) ||
        (showSongs && songResults.isNotEmpty);

    if (songs.isEmpty || !hasVisibleResults) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.search_off,
              size: 56,
              color: c.textMuted.withOpacity(0.3),
            ),
            const SizedBox(height: 16),
            Text('未找到相关内容', style: TextStyle(color: c.textMuted, fontSize: 15)),
            const SizedBox(height: 6),
            Text(
              '尝试使用其他关键词',
              style: TextStyle(color: c.textMuted, fontSize: 13),
            ),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        if (showPlaylists && playlistResults.isNotEmpty) ...[
          _SectionHeader(c: c, title: '歌单', count: playlistResults.length),
          const SizedBox(height: 12),
          _PlaylistsList(
            playlists: playlistResults.map((song) {
              return Playlist(
                id: song.id,
                title: song.title,
                subtitle: _playlistSubtitle(song),
                source: song.source,
                songCount: song.songCount,
                coverUrl: song.coverUrl,
                songs: const [],
              );
            }).toList(),
            c: c,
            onTap: (playlist) {
              navigateDeskRoute(
                ref,
                DeskRoute.playlistDetail,
                playlistId: playlist.id,
              );
            },
          ),
          const SizedBox(height: 32),
        ],
        if (showSongs && songResults.isNotEmpty) ...[
          _SectionHeader(c: c, title: '歌曲', count: songResults.length),
          const SizedBox(height: 12),
          _SongsTable(songs: songResults, c: c),
          const SizedBox(height: 32),
        ],
        if (hasMore || loadingMore) ...[
          _LoadMoreBar(
            c: c,
            loading: loadingMore,
            onLoadMore: onLoadMore,
          ),
          const SizedBox(height: 16),
        ],
      ],
    );
  }

  String _playlistSubtitle(Song song) {
    final state = song.extra['playlistSummaryState']?.toString();
    final kind = song.extra['playlistSummaryKind']?.toString();
    final summaryDuration =
        song.extra['playlistSummaryDurationSeconds'] as int? ?? 0;
    final durationSeconds = summaryDuration > 0
        ? summaryDuration
        : _songDurationSeconds(song);
    String detail;

    if (state == 'ready' && kind == PlaylistSummaryKind.multiPage.name) {
      detail = '${song.songCount} 首歌曲 · 分P合集';
    } else if ((state == 'ready' &&
            kind == PlaylistSummaryKind.singleLongCollection.name) ||
        (state == 'loading' && durationSeconds >= 20 * 60)) {
      detail = '歌曲集合 · ${_formatDuration(durationSeconds)}';
    } else if (state == 'loading' && song.songCount <= 1) {
      detail = '正在获取曲目数...';
    } else if (song.songCount > 1) {
      detail = '${song.songCount} 首歌曲 · 歌曲集合';
    } else {
      detail = '歌曲集合';
    }

    return [
      song.artist,
      detail,
    ].where((part) => part.trim().isNotEmpty).join(' · ');
  }

  int _songDurationSeconds(Song song) {
    final rawDuration = song.extra['duration'];
    if (rawDuration is num) return rawDuration.round() ~/ 1000;
    final parts = song.duration
        .split(':')
        .map((part) => int.tryParse(part) ?? 0)
        .toList();
    if (parts.length == 2) return parts[0] * 60 + parts[1];
    if (parts.length == 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }

  String _formatDuration(int totalSeconds) {
    final hours = totalSeconds ~/ 3600;
    final minutes = (totalSeconds % 3600) ~/ 60;
    final seconds = totalSeconds % 60;
    if (hours > 0) {
      return '$hours:${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
    }
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }
}

class _SectionHeader extends StatelessWidget {
  final DeepVibeColors c;
  final String title;
  final int count;

  const _SectionHeader({
    required this.c,
    required this.title,
    required this.count,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          title,
          style: TextStyle(
            color: c.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: 8),
        Text('$count', style: TextStyle(color: c.textMuted, fontSize: 14)),
      ],
    );
  }
}

class _LoadMoreBar extends StatelessWidget {
  final DeepVibeColors c;
  final bool loading;
  final VoidCallback onLoadMore;

  const _LoadMoreBar({
    required this.c,
    required this.loading,
    required this.onLoadMore,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: TextButton(
        key: const ValueKey('search-load-more-button'),
        onPressed: loading ? null : onLoadMore,
        style: TextButton.styleFrom(
          foregroundColor: c.accent,
          disabledForegroundColor: c.textMuted,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
            side: BorderSide(color: c.border),
          ),
        ),
        child: loading
            ? Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation(c.accent),
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Text('加载中...'),
                ],
              )
            : const Text('加载更多'),
      ),
    );
  }
}

class _SongsTable extends ConsumerWidget {
  final List<Song> songs;
  final DeepVibeColors c;

  const _SongsTable({required this.songs, required this.c});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentSong = ref.watch(currentSongProvider);

    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(kCardRadius),
      ),
      child: Column(
        children: List.generate(
          songs.length,
          (i) => _SongRow(
            key: ValueKey('search-row-${songs[i].id}'),
            song: songs[i],
            index: i + 1,
            c: c,
            isCurrent:
                currentSong != null &&
                songsShareIdentity(songs[i].toJson(), currentSong),
            onTap: () {
              if (songs[i].isPlaylist) {
                navigateDeskRoute(
                  ref,
                  DeskRoute.playlistDetail,
                  playlistId: songs[i].id,
                );
                return;
              }

              final musicService = ref.read(musicServiceProvider);
              // Prefer full cached maps (gdstudio/meting fields). Fallback keeps
              // Song.extra so playback ids like gdstudio:joox:… survive.
              final queueMaps = songs.map((s) {
                final cached = musicService.getCachedSongMap(s.id);
                if (cached != null) return Map<String, dynamic>.from(cached);
                final map = Map<String, dynamic>.from(s.toJson());
                map['duration'] = _parseDuration(s.duration);
                return map;
              }).toList();

              startSongPlayback(
                ref,
                song: queueMaps[i],
                index: i,
                queue: queueMaps,
              );
            },
          ),
        ),
      ),
    );
  }

  int _parseDuration(String duration) {
    final parts = duration.split(':');
    if (parts.length != 2) return 0;
    final minutes = int.tryParse(parts[0]) ?? 0;
    final seconds = int.tryParse(parts[1]) ?? 0;
    return (minutes * 60 + seconds) * 1000;
  }
}

class _SongRow extends ConsumerStatefulWidget {
  final Song song;
  final int index;
  final DeepVibeColors c;
  final bool isCurrent;
  final VoidCallback onTap;

  const _SongRow({
    super.key,
    required this.song,
    required this.index,
    required this.c,
    required this.isCurrent,
    required this.onTap,
  });

  @override
  ConsumerState<_SongRow> createState() => _SongRowState();
}

class _SongRowState extends ConsumerState<_SongRow> {
  bool _hover = false;

  Future<void> _toggleFavorite() async {
    final token = ref.read(authProvider).token;
    if (token == null || token.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请先登录'), duration: Duration(seconds: 2)),
      );
      return;
    }

    try {
      await ref.read(libraryProvider.notifier).toggleLike(token, widget.song);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('操作失败'), duration: Duration(seconds: 2)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    LibraryState? library;
    try {
      library = ref.watch(libraryProvider);
    } catch (_) {}
    final isFavorite =
        library?.likedSongs.any(
          (song) => songsShareIdentity(song.toJson(), widget.song.toJson()),
        ) ??
        false;
    final rowColor = widget.isCurrent
        ? widget.c.accent.withValues(alpha: _hover ? 0.12 : 0.08)
        : _hover
        ? widget.c.surfaceVariant.withValues(alpha: 0.5)
        : Colors.transparent;
    final titleColor = widget.isCurrent
        ? widget.c.accent
        : widget.c.textPrimary;

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
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: rowColor,
                border: Border(
                  left: BorderSide(
                    color: widget.isCurrent
                        ? widget.c.accent
                        : Colors.transparent,
                    width: 3,
                  ),
                ),
              ),
              child: Row(
                children: [
                  SizedBox(
                    key: ValueKey('search-song-index-${widget.song.id}'),
                    width: 30,
                    child: Text(
                      '${widget.index}',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: widget.c.textMuted, fontSize: 12),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    key: ValueKey('search-like-${widget.song.id}'),
                    tooltip: isFavorite ? '取消喜欢' : '喜欢',
                    icon: Icon(
                      isFavorite ? Icons.favorite : Icons.favorite_border,
                      size: 16,
                    ),
                    color: isFavorite ? Colors.red : widget.c.textMuted,
                    onPressed: _toggleFavorite,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(
                      minWidth: 28,
                      minHeight: 28,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 3,
                    child: Text(
                      widget.song.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: titleColor,
                        fontSize: 14,
                        fontWeight: widget.isCurrent
                            ? FontWeight.w600
                            : FontWeight.w400,
                      ),
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
                        fontSize: 14,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      widget.song.source,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: widget.c.textMuted, fontSize: 13),
                    ),
                  ),
                  SizedBox(
                    width: 48,
                    child: Text(
                      widget.song.duration,
                      textAlign: TextAlign.right,
                      style: TextStyle(color: widget.c.textMuted, fontSize: 13),
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
    List<Map<String, dynamic>> playlists = const [];
    try {
      playlists = ref.read(libraryProvider).userPlaylists;
    } catch (_) {}

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
          onTap: () => Future.delayed(Duration.zero, widget.onTap),
          child: Row(
            children: [
              Icon(Icons.play_arrow, size: 16, color: widget.c.textSecondary),
              const SizedBox(width: 12),
              const Text('播放', style: TextStyle(fontSize: 13)),
            ],
          ),
        ),
        PopupMenuItem(
          onTap: () => Future.delayed(Duration.zero, _playNext),
          child: Row(
            children: [
              Icon(Icons.skip_next, size: 16, color: widget.c.textSecondary),
              const SizedBox(width: 12),
              const Text('下一首播放', style: TextStyle(fontSize: 13)),
            ],
          ),
        ),
        PopupMenuItem(
          enabled: false,
          child: Row(
            children: [
              Icon(Icons.playlist_add, size: 16, color: widget.c.textSecondary),
              const SizedBox(width: 12),
              const Text('添加到歌单', style: TextStyle(fontSize: 13)),
              const Spacer(),
              Icon(Icons.arrow_right, size: 16, color: widget.c.textMuted),
            ],
          ),
        ),
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
            final name = () {
              final n = playlist['name']?.toString().trim() ?? '';
              if (n.isNotEmpty) return n;
              final t = playlist['title']?.toString().trim() ?? '';
              if (t.isNotEmpty) return t;
              return '未命名歌单';
            }();
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
      ],
    );
  }

  void _playNext() {
    final queue = ref.read(playbackQueueProvider);
    final currentIndex = ref.read(currentSongIndexProvider);
    final nextQueue = List<Map<String, dynamic>>.from(queue);
    nextQueue.insert(currentIndex + 1, widget.song.toJson());
    ref.read(playbackQueueProvider.notifier).state = nextQueue;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('已添加到下一首：${widget.song.title}'),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  Future<void> _addToPlaylist(String playlistId) async {
    final token = ref.read(authProvider).token;
    if (token == null || token.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请先登录'), duration: Duration(seconds: 2)),
      );
      return;
    }

    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      const SnackBar(
        content: Text('正在添加到歌单...'),
        duration: Duration(seconds: 30),
      ),
    );

    try {
      await ref
          .read(libraryProvider.notifier)
          .addSongToPlaylist(token, playlistId, widget.song);
      if (!mounted) return;
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(
        const SnackBar(content: Text('已添加到歌单'), duration: Duration(seconds: 2)),
      );
    } on LibraryMutationCancelled {
      if (!mounted) return;
      messenger.hideCurrentSnackBar();
    } catch (_) {
      if (!mounted) return;
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(
        const SnackBar(content: Text('添加失败'), duration: Duration(seconds: 2)),
      );
    }
  }
}

class _PlaylistsList extends StatelessWidget {
  final List<Playlist> playlists;
  final DeepVibeColors c;
  final ValueChanged<Playlist> onTap;

  const _PlaylistsList({
    required this.playlists,
    required this.c,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: playlists
          .map((pl) => _PlaylistRow(playlist: pl, c: c, onTap: () => onTap(pl)))
          .toList(),
    );
  }
}

class _PlaylistRow extends StatefulWidget {
  final Playlist playlist;
  final DeepVibeColors c;
  final VoidCallback onTap;

  const _PlaylistRow({
    required this.playlist,
    required this.c,
    required this.onTap,
  });

  @override
  State<_PlaylistRow> createState() => _PlaylistRowState();
}

class _PlaylistRowState extends State<_PlaylistRow> {
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
          borderRadius: BorderRadius.circular(kCardRadius),
          child: Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _hover
                  ? widget.c.surface
                  : widget.c.surface.withOpacity(0.6),
              borderRadius: BorderRadius.circular(kCardRadius),
            ),
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: widget.c.surfaceVariant,
                    borderRadius: BorderRadius.circular(kCardRadius),
                  ),
                  child: Icon(
                    Icons.queue_music,
                    size: 24,
                    color: widget.c.textMuted,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.playlist.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textPrimary,
                          fontSize: 15,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      Text(
                        widget.playlist.subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textMuted,
                          fontSize: 13,
                        ),
                      ),
                    ],
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
