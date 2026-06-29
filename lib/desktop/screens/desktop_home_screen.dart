import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/models/song.dart';
import '../../core/models/playlist.dart';
import '../../playback/playback_actions.dart';
import '../../playback/playback_providers.dart';
import '../../services/app_settings.dart';
import '../../services/auth_service.dart';
import '../../services/library_service.dart';
import '../../services/music_service.dart';
import '../../services/recommendation_service.dart';
import '../desktop_app_shell.dart';
import '../widgets/components/network_cover_image.dart';

/// PRD §8.1: 首页 — continue playing, hot playlists with load-more-no-jump,
/// recent plays. Tech doc §10.2 success criterion: hot playlist "加载更多" must
/// not scroll-jump when new items arrive (stable anchoring).
final homeHotPlaylistsProvider = StateProvider<List<Playlist>>(
  (ref) => const <Playlist>[],
);
final homeRecommendedSongsProvider = StateProvider<List<Song>>(
  (ref) => const <Song>[],
);
final homeLoadingProvider = StateProvider<bool>((ref) => true);
final homeHotPlaylistsLoadingProvider = StateProvider<bool>((ref) => false);
final homeRecommendedSongsLoadingProvider = StateProvider<bool>((ref) => false);
final homeLoadingMoreProvider = StateProvider<bool>((ref) => false);
final homeLoadedCountProvider = StateProvider<int>((ref) => 0);
final homeInitializedProvider = StateProvider<bool>((ref) => false);
final homePersonalizedRecommendationsProvider =
    FutureProvider<PersonalizedRecommendations>((ref) async {
      final settings = ref.watch(appSettingsProvider);
      if (!settings.aiRecommendationsEnabled) {
        return const PersonalizedRecommendations.empty();
      }

      final auth = ref.watch(authProvider);
      final token = auth.token;
      final history = ref.watch(libraryProvider).playHistory;
      if (token == null || token.isEmpty || history.isEmpty) {
        return const PersonalizedRecommendations.empty();
      }

      return ref
          .watch(recommendationServiceProvider)
          .getPersonalizedRecommendations(token, history: history);
    });

const _homeInitialDataTimeout = Duration(seconds: 5);
const _homeLoadMoreTimeout = Duration(seconds: 6);

class DesktopHomeScreen extends ConsumerStatefulWidget {
  const DesktopHomeScreen({super.key});

  @override
  ConsumerState<DesktopHomeScreen> createState() => _DesktopHomeScreenState();
}

class _DesktopHomeScreenState extends ConsumerState<DesktopHomeScreen> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || ref.read(homeInitializedProvider)) return;
      _loadInitialData();
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadInitialData() async {
    final container = ProviderScope.containerOf(context, listen: false);
    final musicService = container.read(musicServiceProvider);
    container.read(homeInitializedProvider.notifier).state = true;
    container.read(homeLoadingProvider.notifier).state = true;
    container.read(homeHotPlaylistsLoadingProvider.notifier).state = true;
    container.read(homeRecommendedSongsLoadingProvider.notifier).state = true;

    print('[HomeScreen] 开始加载数据...');
    _loadInitialHotPlaylists(container, musicService);
    _loadInitialRecommendations(container, musicService);
  }

  Future<void> _loadInitialHotPlaylists(
    ProviderContainer container,
    MusicService musicService,
  ) async {
    try {
      final playlists = await _loadPersonalizedHotPlaylists(
        container,
        musicService,
        limit: 6,
      );

      container.read(homeHotPlaylistsProvider.notifier).state = playlists
          .map(_mapPlaylist)
          .toList();
      container.read(homeLoadedCountProvider.notifier).state = playlists.length;
      print('[HomeScreen] 热门歌单: ${playlists.length} 个');
    } catch (e) {
      print('[HomeScreen] 热门歌单加载失败: $e');
    } finally {
      container.read(homeHotPlaylistsLoadingProvider.notifier).state = false;
      _syncHomeLoadingState(container);
    }
  }

  Future<void> _loadInitialRecommendations(
    ProviderContainer container,
    MusicService musicService,
  ) async {
    try {
      final songs = await _loadPersonalizedRecommendedSongs(
        container,
        musicService,
      );

      container.read(homeRecommendedSongsProvider.notifier).state = songs
          .take(8)
          .toList();
      print('[HomeScreen] 推荐歌曲: ${songs.length} 首');
    } catch (e) {
      print('[HomeScreen] 推荐歌曲加载失败: $e');
    } finally {
      container.read(homeRecommendedSongsLoadingProvider.notifier).state =
          false;
      _syncHomeLoadingState(container);
    }
  }

  Future<List<Map<String, dynamic>>> _loadPersonalizedHotPlaylists(
    ProviderContainer container,
    MusicService musicService, {
    required int limit,
  }) async {
    final fallback = () => musicService
        .getHotPlaylists(limit: limit, offset: 0)
        .timeout(_homeInitialDataTimeout, onTimeout: () => const []);

    if (!_canUsePersonalizedRecommendations(container)) {
      return await fallback();
    }

    try {
      final recommendations = await container
          .read(homePersonalizedRecommendationsProvider.future)
          .timeout(_homeInitialDataTimeout);
      if (recommendations.playlistQueries.isEmpty) return await fallback();

      final playlists = <Map<String, dynamic>>[];
      final seen = <String>{};
      for (final query in recommendations.playlistQueries) {
        final results = await musicService.searchSongs(query);
        for (final song in results) {
          if (!song.isPlaylist) continue;
          if (!seen.add(song.id)) continue;
          playlists.add(song.toJson());
          if (playlists.length >= limit) return playlists;
        }
      }
      return playlists.isEmpty ? await fallback() : playlists;
    } catch (e) {
      return await fallback();
    }
  }

  Future<List<Song>> _loadPersonalizedRecommendedSongs(
    ProviderContainer container,
    MusicService musicService,
  ) async {
    final fallback = () => musicService.getRecommendedSongs().timeout(
      _homeInitialDataTimeout,
      onTimeout: () => const [],
    );

    if (!_canUsePersonalizedRecommendations(container)) {
      return await fallback();
    }

    try {
      final recommendations = await container
          .read(homePersonalizedRecommendationsProvider.future)
          .timeout(_homeInitialDataTimeout);
      if (recommendations.songQueries.isEmpty) return await fallback();

      final songs = <Song>[];
      final seen = <String>{};
      for (final query in recommendations.songQueries) {
        final results = await musicService.searchSongs(query);
        for (final song in results) {
          if (song.isPlaylist) continue;
          if (!seen.add(song.id)) continue;
          songs.add(song);
          if (songs.length >= 8) return songs;
        }
      }
      return songs.isEmpty ? await fallback() : songs;
    } catch (e) {
      return await fallback();
    }
  }

  bool _canUsePersonalizedRecommendations(ProviderContainer container) {
    try {
      if (!container.read(appSettingsProvider).aiRecommendationsEnabled) {
        return false;
      }
      final token = container.read(authProvider).token;
      if (token == null || token.isEmpty) return false;
      return container.read(libraryProvider).playHistory.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  void _syncHomeLoadingState(ProviderContainer container) {
    final stillLoading =
        container.read(homeHotPlaylistsLoadingProvider) ||
        container.read(homeRecommendedSongsLoadingProvider);
    container.read(homeLoadingProvider.notifier).state = stillLoading;
    if (!stillLoading) print('[HomeScreen] 数据加载完成');
  }

  Future<void> _loadMore() async {
    final container = ProviderScope.containerOf(context, listen: false);
    if (container.read(homeLoadingMoreProvider)) return;
    if (_canUsePersonalizedRecommendations(container)) return;

    container.read(homeLoadingMoreProvider.notifier).state = true;
    final musicService = container.read(musicServiceProvider);
    final loadedCount = container.read(homeLoadedCountProvider);

    try {
      final morePlaylists = await musicService
          .getHotPlaylists(limit: 6, offset: loadedCount)
          .timeout(_homeLoadMoreTimeout, onTimeout: () => const []);
      final current = container.read(homeHotPlaylistsProvider);
      final appended = [...current, ...morePlaylists.map(_mapPlaylist)];
      container.read(homeHotPlaylistsProvider.notifier).state = appended;
      container.read(homeLoadedCountProvider.notifier).state = appended.length;
    } finally {
      container.read(homeLoadingMoreProvider.notifier).state = false;
    }
  }

  Playlist _mapPlaylist(Map<String, dynamic> data) {
    return Playlist(
      id: data['id']?.toString() ?? '',
      title: data['title']?.toString() ?? '未知歌单',
      subtitle: data['subtitle']?.toString() ?? '',
      source: data['source']?.toString() ?? 'Bilibili',
      songCount: data['songCount'] as int? ?? 0,
      coverUrl: data['coverUrl']?.toString(),
      songs: const [],
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final currentSong = ref.watch(currentSongProvider);
    final hotPlaylists = ref.watch(homeHotPlaylistsProvider);
    final hotPlaylistsLoading = ref.watch(homeHotPlaylistsLoadingProvider);
    final recommendedSongsLoading = ref.watch(
      homeRecommendedSongsLoadingProvider,
    );
    final loadingMore = ref.watch(homeLoadingMoreProvider);
    final recommendedSongs = ref.watch(homeRecommendedSongsProvider);

    return Container(
      color: c.background,
      child: ListView(
        controller: _scrollController,
        padding: const EdgeInsets.all(24),
        children: [
          if (currentSong != null)
            _ContinuePlayingCard(c: c, song: currentSong),
          if (currentSong != null) const SizedBox(height: 32),
          _SectionHeader(c: c, title: '热门歌单'),
          const SizedBox(height: 16),
          if (hotPlaylistsLoading && hotPlaylists.isEmpty)
            _HomeSectionLoading(c: c, message: '正在加载热门歌单')
          else
            _HotPlaylistsGrid(
              playlists: hotPlaylists,
              c: c,
              onTap: (pl) {
                navigateDeskRoute(
                  ref,
                  DeskRoute.playlistDetail,
                  playlistId: pl.id,
                );
              },
            ),
          if (hotPlaylists.isNotEmpty || loadingMore) ...[
            const SizedBox(height: 16),
            Center(
              child: loadingMore
                  ? SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation(c.accent),
                      ),
                    )
                  : TextButton(
                      onPressed: _loadMore,
                      child: Text(
                        '加载更多',
                        style: TextStyle(color: c.accent, fontSize: 13),
                      ),
                    ),
            ),
          ],
          const SizedBox(height: 32),
          _SectionHeader(c: c, title: '推荐歌曲'),
          const SizedBox(height: 16),
          _RecommendedSongsTable(
            c: c,
            songs: recommendedSongs,
            loading: recommendedSongsLoading,
          ),
          const SizedBox(height: 40),
        ],
      ),
    );
  }
}

class _HomeSectionLoading extends StatelessWidget {
  final DeepVibeColors c;
  final String message;

  const _HomeSectionLoading({required this.c, required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 96,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(kCardRadius),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              valueColor: AlwaysStoppedAnimation(c.accent),
            ),
          ),
          const SizedBox(width: 10),
          Text(message, style: TextStyle(color: c.textMuted, fontSize: 13)),
        ],
      ),
    );
  }
}

class _ContinuePlayingCard extends ConsumerWidget {
  final DeepVibeColors c;
  final Map<String, dynamic> song;
  const _ContinuePlayingCard({required this.c, required this.song});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final title = song['title']?.toString() ?? '未知歌曲';
    final artist = song['artist']?.toString() ?? '未知艺人';
    final coverUrl = song['coverUrl']?.toString();
    final songId = song['id']?.toString() ?? '';
    final isPlaying = song['status']?.toString() == 'playing';
    return Material(
      color: c.surface,
      borderRadius: BorderRadius.circular(kCardRadius),
      child: InkWell(
        borderRadius: BorderRadius.circular(kCardRadius),
        onTap: () {
          startSongPlayback(
            ref,
            song: song,
            index: ref.read(currentSongIndexProvider),
            queue: ref.read(playbackQueueProvider).isEmpty
                ? [song]
                : ref.read(playbackQueueProvider),
          );
        },
        child: Container(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(kCardRadius),
                child: NetworkCoverImage(
                  imageUrl: coverUrl,
                  size: 80,
                  colorSeed: songId.hashCode,
                ),
              ),
              const SizedBox(width: 20),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '继续播放',
                      style: TextStyle(
                        color: c.textMuted,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.8,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: c.textPrimary,
                        fontSize: 17,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      artist,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: c.textSecondary, fontSize: 13),
                    ),
                  ],
                ),
              ),
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: c.accent,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  isPlaying ? Icons.pause : Icons.play_arrow,
                  color: c.background,
                  size: 28,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final DeepVibeColors c;
  final String title;
  const _SectionHeader({required this.c, required this.title});

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: TextStyle(
        color: c.textPrimary,
        fontSize: 19,
        fontWeight: FontWeight.w600,
      ),
    );
  }
}

class _HotPlaylistsGrid extends StatelessWidget {
  final List<Playlist> playlists;
  final DeepVibeColors c;
  final ValueChanged<Playlist> onTap;
  const _HotPlaylistsGrid({
    required this.playlists,
    required this.c,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final cols = (constraints.maxWidth / 200).floor().clamp(2, 6);
        final spacing = 16.0;
        final cardWidth = (constraints.maxWidth - spacing * (cols - 1)) / cols;
        return Wrap(
          spacing: spacing,
          runSpacing: spacing,
          children: playlists.map((pl) {
            return SizedBox(
              width: cardWidth,
              child: _PlaylistCard(playlist: pl, c: c, onTap: () => onTap(pl)),
            );
          }).toList(),
        );
      },
    );
  }
}

class _PlaylistCard extends StatefulWidget {
  final Playlist playlist;
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
                ClipRRect(
                  borderRadius: BorderRadius.circular(kCardRadius),
                  child: Stack(
                    children: [
                      NetworkCoverImage(
                        imageUrl: widget.playlist.coverUrl,
                        size: 200,
                        colorSeed: widget.playlist.id.hashCode,
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
                const SizedBox(height: 10),
                Text(
                  widget.playlist.title,
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
                  widget.playlist.subtitle,
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

class _RecommendedSongsTable extends ConsumerWidget {
  final DeepVibeColors c;
  final List<Song> songs;
  final bool loading;

  const _RecommendedSongsTable({
    required this.c,
    required this.songs,
    required this.loading,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (loading && songs.isEmpty) {
      return _HomeSectionLoading(c: c, message: '正在加载推荐歌曲');
    }

    if (songs.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(40),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(kCardRadius),
        ),
        child: Center(
          child: Text(
            '暂无推荐歌曲',
            style: TextStyle(color: c.textMuted, fontSize: 13),
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(kCardRadius),
      ),
      child: Column(
        children: List.generate(
          songs.length,
          (i) => _SongRow(
            song: songs[i],
            index: i + 1,
            c: c,
            onTap: () {
              if (songs[i].isPlaylist) {
                navigateDeskRoute(
                  ref,
                  DeskRoute.playlistDetail,
                  playlistId: songs[i].id,
                );
                return;
              }

              final queue = songs.map((song) => song.toJson()).toList();
              startSongPlayback(ref, song: queue[i], index: i, queue: queue);
            },
          ),
        ),
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
                  ? widget.c.surfaceVariant.withOpacity(0.5)
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
                  child: Text(
                    widget.song.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: widget.c.textPrimary, fontSize: 13),
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
    );
  }
}
