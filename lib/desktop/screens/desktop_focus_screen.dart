import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../playback/playback_providers.dart';
import '../../playback/playback_actions.dart';
import '../../shared/lyrics_parser.dart';
import '../widgets/components/network_cover_image.dart';

/// Focus mode - immersive playback with large artwork and lyrics
class DesktopFocusScreen extends ConsumerWidget {
  const DesktopFocusScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final song = ref.watch(currentSongProvider);

    return Container(
      color: c.background,
      child: song == null ? _EmptyState(c: c) : _FocusContent(c: c, song: song),
    );
  }
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
          Icon(
            Icons.equalizer_outlined,
            size: 80,
            color: c.textMuted.withOpacity(0.3),
          ),
          const SizedBox(height: 20),
          Text(
            '专注模式',
            style: TextStyle(
              color: c.textPrimary,
              fontSize: 22,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '播放歌曲后进入专注聆听',
            style: TextStyle(color: c.textMuted, fontSize: 14),
          ),
        ],
      ),
    );
  }
}

/// Focus mode content - large cover on left, lyrics on right
class _FocusContent extends ConsumerStatefulWidget {
  final DeepVibeColors c;
  final Map<String, dynamic> song;

  const _FocusContent({required this.c, required this.song});

  @override
  ConsumerState<_FocusContent> createState() => _FocusContentState();
}

class _FocusContentState extends ConsumerState<_FocusContent> {
  final ScrollController _scrollController = ScrollController();
  final Map<int, GlobalKey> _lineKeys = {};
  int _lastActiveIndex = -1;

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToActive(int activeIndex, int totalLines) {
    if (activeIndex < 0 || activeIndex >= totalLines) return;
    if (activeIndex == _lastActiveIndex) return;
    if (!_scrollController.hasClients) return;

    _lastActiveIndex = activeIndex;

    // Delay to ensure the new active line has been rendered
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;

      // Get the actual rendered position of the active line
      final lineKey = _lineKeys[activeIndex];
      if (lineKey?.currentContext == null) {
        // Fallback: use estimated position if key not rendered yet
        _scrollToEstimatedPosition(activeIndex);
        return;
      }

      final renderBox =
          lineKey!.currentContext!.findRenderObject() as RenderBox?;
      if (renderBox == null) {
        _scrollToEstimatedPosition(activeIndex);
        return;
      }

      try {
        final linePosition = renderBox.localToGlobal(Offset.zero);
        final scrollPosition = _scrollController.position;

        // Calculate target offset to place active line at 1/3 from top
        final viewportHeight = scrollPosition.viewportDimension;
        final targetScreenPosition = viewportHeight / 3;
        final currentScreenPosition = linePosition.dy;
        final currentScrollOffset = scrollPosition.pixels;

        // New scroll offset = current + (current position - desired position)
        final targetOffset =
            currentScrollOffset +
            (currentScreenPosition - targetScreenPosition);
        final clampedOffset = targetOffset.clamp(
          0.0,
          scrollPosition.maxScrollExtent,
        );

        _scrollController.animateTo(
          clampedOffset,
          duration: const Duration(milliseconds: 400),
          curve: Curves.easeInOut,
        );
      } catch (e) {
        // If any error occurs, use estimated position
        _scrollToEstimatedPosition(activeIndex);
      }
    });
  }

  void _scrollToEstimatedPosition(int activeIndex) {
    if (!_scrollController.hasClients) return;

    // Estimated line height based on average
    final estimatedLineHeight = 70.0;
    final targetOffset =
        (activeIndex * estimatedLineHeight) - (estimatedLineHeight * 2);
    final clampedOffset = targetOffset.clamp(
      0.0,
      _scrollController.position.maxScrollExtent,
    );

    _scrollController.animateTo(
      clampedOffset,
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeInOut,
    );
  }

  GlobalKey _getLineKey(int index) {
    return _lineKeys.putIfAbsent(index, () => GlobalKey());
  }

  @override
  Widget build(BuildContext context) {
    final positionAsync = ref.watch(playbackPositionProvider);
    final position = positionAsync.valueOrNull ?? Duration.zero;

    return Row(
      children: [
        // Left: Large album cover
        Expanded(
          flex: 5,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(60),
              child: AspectRatio(
                aspectRatio: 1,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: widget.song['coverUrl'] != null
                      ? NetworkCoverImage(
                          imageUrl: widget.song['coverUrl']?.toString(),
                          size: 600,
                          colorSeed: widget.song['id'].hashCode,
                        )
                      : Container(
                          color: widget.c.surfaceVariant,
                          child: Icon(
                            Icons.music_note,
                            size: 120,
                            color: widget.c.textMuted,
                          ),
                        ),
                ),
              ),
            ),
          ),
        ),
        // Right: Lyrics
        Expanded(
          flex: 4,
          child: _LyricsPanel(
            c: widget.c,
            song: widget.song,
            position: position,
            scrollController: _scrollController,
            onScrollToActive: _scrollToActive,
            getLineKey: _getLineKey,
          ),
        ),
      ],
    );
  }
}

/// Lyrics panel for focus mode
class _LyricsPanel extends StatelessWidget {
  final DeepVibeColors c;
  final Map<String, dynamic> song;
  final Duration position;
  final ScrollController scrollController;
  final Function(int, int) onScrollToActive;
  final GlobalKey Function(int) getLineKey;

  const _LyricsPanel({
    required this.c,
    required this.song,
    required this.position,
    required this.scrollController,
    required this.onScrollToActive,
    required this.getLineKey,
  });

  @override
  Widget build(BuildContext context) {
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
              width: 32,
              height: 32,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                valueColor: AlwaysStoppedAnimation(c.accent),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              '加载歌词中...',
              style: TextStyle(color: c.textMuted, fontSize: 14),
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
              size: 60,
              color: c.textMuted.withOpacity(0.3),
            ),
            const SizedBox(height: 16),
            Text('暂无歌词', style: TextStyle(color: c.textMuted, fontSize: 14)),
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
          style: TextStyle(color: c.textMuted, fontSize: 14),
        ),
      );
    }

    final activeIndex = activeLyricIndex(lines, position);

    // Auto-scroll to active line
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (scrollController.hasClients) {
        onScrollToActive(activeIndex, lines.length);
      }
    });

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 60),
      child: ListView.builder(
        controller: scrollController,
        itemCount: lines.length,
        itemBuilder: (context, i) {
          final line = lines[i];
          final active = i == activeIndex;

          return Padding(
            key: getLineKey(i),
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text(
              line.content,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: active ? c.accent : c.textMuted,
                fontSize: active ? 28 : 20,
                fontWeight: active ? FontWeight.w600 : FontWeight.normal,
                height: 1.5,
              ),
            ),
          );
        },
      ),
    );
  }
}
