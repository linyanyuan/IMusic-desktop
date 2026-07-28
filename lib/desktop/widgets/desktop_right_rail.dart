import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/song_identity.dart';
import '../../playback/playback_providers.dart';
import '../../playback/playback_actions.dart';
import '../../shared/lyrics_parser.dart';
import '../desktop_app_shell.dart';
import 'components/desktop_cover_placeholder.dart';

/// Right persistent context rail: current-track cover + basic info,
/// lyrics with loading / not-found states, current queue, priority next queue.
class DesktopRightRail extends ConsumerWidget {
  final double width;
  const DesktopRightRail({super.key, required this.width});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final tab = ref.watch(rightRailTabProvider);
    return Container(
      width: width,
      color: c.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _NowPlayingCard(),
          _SegmentedTabs(c: c, tab: tab),
          Expanded(
            child: switch (tab) {
              RightRailTab.lyrics => const _LyricsPanel(),
              RightRailTab.queue => const _QueuePanel(),
              RightRailTab.info => const _InfoPanel(),
            },
          ),
        ],
      ),
    );
  }
}

class _NowPlayingCard extends ConsumerWidget {
  const _NowPlayingCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final song = ref.watch(currentSongProvider);

    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(kCardRadius),
            child: DesktopCoverPlaceholder(
              size: width * 1,
              colorSeed: song?['id']?.toString().hashCode ?? 0,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            song?['title']?.toString() ?? '未在播放',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: c.textPrimary,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            song?['artist']?.toString() ?? 'DeepVibe',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: c.textSecondary, fontSize: 12),
          ),
          if (song != null) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              children: [
                if (song['sourceLabel']?.toString().isNotEmpty == true)
                  _Chip(
                    label: song['sourceLabel'].toString(),
                    accent: false,
                    c: c,
                  ),
                if (song['playbackSourceLabel']?.toString().isNotEmpty == true)
                  _Chip(
                    label: song['playbackSourceLabel'].toString(),
                    accent: true,
                    c: c,
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  static double get width => kRightRailWidth;
}

class _SegmentedTabs extends StatelessWidget {
  final DeepVibeColors c;
  final RightRailTab tab;
  const _SegmentedTabs({required this.c, required this.tab});

  @override
  Widget build(BuildContext context) {
    final tabs = RightRailTab.values;
    return Consumer(
      builder: (context, ref, _) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Container(
          decoration: BoxDecoration(
            color: c.surfaceVariant,
            borderRadius: BorderRadius.circular(kCardRadius),
          ),
          child: Row(
            children: tabs.map((t) {
              final selected = t == tab;
              return Expanded(
                child: GestureDetector(
                  onTap: () =>
                      ref.read(rightRailTabProvider.notifier).state = t,
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    decoration: BoxDecoration(
                      color: selected ? c.surface : Colors.transparent,
                      borderRadius: BorderRadius.circular(kCardRadius),
                    ),
                    child: Center(
                      child: Text(
                        _label(t),
                        style: TextStyle(
                          color: selected ? c.accent : c.textSecondary,
                          fontSize: 12,
                          fontWeight: selected
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                      ),
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ),
      ),
    );
  }

  String _label(RightRailTab t) => switch (t) {
    RightRailTab.lyrics => '歌词',
    RightRailTab.queue => '队列',
    RightRailTab.info => '信息',
  };
}

class _LyricsPanel extends ConsumerStatefulWidget {
  const _LyricsPanel();

  @override
  ConsumerState<_LyricsPanel> createState() => _LyricsPanelState();
}

class _LyricsPanelState extends ConsumerState<_LyricsPanel> {
  final ScrollController _scrollController = ScrollController();
  int _lastActiveIndex = -1;

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToActive(int activeIndex, int totalLines) {
    if (activeIndex < 0 || activeIndex >= totalLines) return;
    if (activeIndex == _lastActiveIndex) return;

    _lastActiveIndex = activeIndex;

    // Calculate target scroll position to center the active line
    final viewportHeight = _scrollController.position.viewportDimension;
    final lineHeight = 60.0; // Approximate height per line
    final targetOffset =
        (activeIndex * lineHeight) - (viewportHeight / 2) + (lineHeight / 2);
    final maxScroll = _scrollController.position.maxScrollExtent;
    final clampedOffset = targetOffset.clamp(0.0, maxScroll);

    _scrollController.animateTo(
      clampedOffset,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;

    final song = ref.watch(currentSongProvider);
    final positionAsync = ref.watch(playbackPositionProvider);
    final position = positionAsync.valueOrNull ?? Duration.zero;

    if (song == null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.lyrics_outlined,
              size: 48,
              color: c.textMuted.withOpacity(0.3),
            ),
            const SizedBox(height: 12),
            Text('未在播放', style: TextStyle(color: c.textMuted, fontSize: 13)),
          ],
        ),
      );
    }

    final lyricsText = song['lyrics']?.toString().trim() ?? '';
    final lyricsStatus = song['lyricsStatus']?.toString() ?? '';

    // Loading state
    if (lyricsStatus == lyricsStatusLoading &&
        lyricsText.isEmpty &&
        !isLyricsLoadingExpired(song)) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                valueColor: AlwaysStoppedAnimation(c.accent),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              '加载歌词中...',
              style: TextStyle(color: c.textMuted, fontSize: 12),
            ),
          ],
        ),
      );
    }

    // Empty / timeout state
    if (lyricsText.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.lyrics_outlined,
              size: 48,
              color: c.textMuted.withOpacity(0.3),
            ),
            const SizedBox(height: 12),
            Text('暂无歌词', style: TextStyle(color: c.textMuted, fontSize: 13)),
          ],
        ),
      );
    }

    // Parse and display lyrics
    final lines = parseLyricLines(lyricsText);
    if (lines.isEmpty) {
      return Center(
        child: Text(
          '歌词解析失败',
          style: TextStyle(color: c.textMuted, fontSize: 12),
        ),
      );
    }

    final activeIndex = activeLyricIndex(lines, position);

    // Auto-scroll to active line
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollToActive(activeIndex, lines.length);
      }
    });

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
      itemCount: lines.length,
      itemBuilder: (context, i) {
        final line = lines[i];
        final active = i == activeIndex;

        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Text(
            line.content,
            style: TextStyle(
              color: active ? c.accent : c.textSecondary,
              fontSize: active ? 15 : 13,
              fontWeight: active ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        );
      },
    );
  }
}

class _QueuePanel extends ConsumerWidget {
  const _QueuePanel();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final queue = ref.watch(playbackQueueProvider);
    final currentSong = ref.watch(currentSongProvider);

    if (queue.isEmpty) {
      return Center(
        child: Text(
          '当前队列为空',
          style: TextStyle(color: c.textMuted, fontSize: 12),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 24),
      itemCount: queue.length,
      itemBuilder: (context, i) {
        final song = queue[i];
        final current =
            currentSong != null && songsShareIdentity(song, currentSong);
        return _QueueRow(
          song: song,
          current: current,
          c: c,
          onTap: () async {
            await startSongPlayback(ref, song: song, index: i, queue: queue);
          },
        );
      },
    );
  }
}

class _QueueRow extends StatefulWidget {
  final Map<String, dynamic> song;
  final bool current;
  final DeepVibeColors c;
  final VoidCallback onTap;

  const _QueueRow({
    required this.song,
    required this.current,
    required this.c,
    required this.onTap,
  });

  @override
  State<_QueueRow> createState() => _QueueRowState();
}

class _QueueRowState extends State<_QueueRow> {
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
            height: kQueueRowHeight,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              color: widget.current
                  ? widget.c.accent.withOpacity(0.10)
                  : _hover
                  ? widget.c.surfaceVariant.withOpacity(0.5)
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(kCardRadius),
            ),
            child: Row(
              children: [
                Icon(
                  widget.current ? Icons.play_arrow : Icons.music_note,
                  size: 14,
                  color: widget.current ? widget.c.accent : widget.c.textMuted,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.song['title']?.toString() ?? '未知歌曲',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.current
                              ? widget.c.accent
                              : widget.c.textPrimary,
                          fontSize: 12,
                          fontWeight: widget.current
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                      ),
                      Text(
                        widget.song['artist']?.toString() ?? '未知艺人',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textMuted,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  _formatDuration(widget.song['duration']),
                  style: TextStyle(color: widget.c.textMuted, fontSize: 11),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _formatDuration(dynamic duration) {
    if (duration is int) {
      final d = Duration(milliseconds: duration);
      final minutes = d.inMinutes;
      final seconds = d.inSeconds.remainder(60);
      return '$minutes:${seconds.toString().padLeft(2, '0')}';
    }
    return duration?.toString() ?? '0:00';
  }
}

class _InfoPanel extends ConsumerWidget {
  const _InfoPanel();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;

    final song = ref.watch(currentSongProvider);
    if (song == null) {
      return Center(
        child: Text('未在播放', style: TextStyle(color: c.textMuted, fontSize: 12)),
      );
    }

    final rows = {
      'ID': song['id']?.toString() ?? '-',
      '来源':
          song['sourceLabel']?.toString() ?? song['source']?.toString() ?? '-',
      '播放源': song['playbackSourceLabel']?.toString() ?? '-',
      '时长': _formatDuration(song['duration']),
      '状态': song['status']?.toString() ?? '-',
      '歌词': song['lyricsStatus']?.toString() ?? '-',
    };

    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: rows.entries
            .map(
              (e) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Text(
                      e.key,
                      style: TextStyle(color: c.textMuted, fontSize: 12),
                    ),
                    const Spacer(),
                    Flexible(
                      child: Text(
                        e.value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.right,
                        style: TextStyle(color: c.textSecondary, fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ),
            )
            .toList(),
      ),
    );
  }

  String _formatDuration(dynamic duration) {
    if (duration is int) {
      final d = Duration(milliseconds: duration);
      final minutes = d.inMinutes;
      final seconds = d.inSeconds.remainder(60);
      return '$minutes:${seconds.toString().padLeft(2, '0')}';
    }
    return duration?.toString() ?? '0:00';
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final bool accent;
  final DeepVibeColors c;
  const _Chip({required this.label, required this.accent, required this.c});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: accent ? c.accent.withOpacity(0.14) : c.surfaceVariant,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: accent ? c.accent.withOpacity(0.4) : c.border,
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: accent ? c.accent : c.textSecondary,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
