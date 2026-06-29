import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../playback/playback_commands.dart';
import '../../playback/playback_providers.dart';
import '../../playback/playback_actions.dart';
import '../desktop_app_shell.dart';
import './components/network_cover_image.dart';
import './desktop_lyrics_window_controller.dart';

/// Fixed height desktop player bar with playback controls
class DesktopPlayerBar extends ConsumerWidget {
  static const double height = 80.0;

  const DesktopPlayerBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;

    final currentSong = ref.watch(currentSongProvider);
    final isPlayingAsync = ref.watch(playbackPlayingProvider);
    final positionAsync = ref.watch(playbackPositionProvider);
    final durationAsync = ref.watch(playbackDurationProvider);
    final mode = ref.watch(playbackModeProvider);

    final isPlaying = isPlayingAsync.value ?? false;
    final position = positionAsync.value ?? Duration.zero;
    final duration = durationAsync.value ?? Duration.zero;

    return Container(
      key: const ValueKey('desktop-player-bar'),
      height: height,
      color: c.surface,
      child: Stack(
        children: [
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: _ProgressBar(
              c: c,
              position: position,
              duration: duration,
              onSeek: (pos) => _seek(ref, pos),
            ),
          ),
          Positioned.fill(
            top: 4,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 300,
                          child: Row(
                            children: [
                              GestureDetector(
                                key: const ValueKey(
                                  'player-cover-focus-toggle',
                                ),
                                onTap: currentSong != null
                                    ? () => _toggleFocusMode(ref)
                                    : null,
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(4),
                                  child: currentSong?['coverUrl'] != null
                                      ? NetworkCoverImage(
                                          imageUrl: currentSong!['coverUrl']
                                              ?.toString(),
                                          size: 48,
                                          colorSeed: currentSong['id'].hashCode,
                                        )
                                      : Container(
                                          width: 48,
                                          height: 48,
                                          color: c.surfaceVariant,
                                          child: Icon(
                                            Icons.music_note,
                                            color: c.textMuted,
                                            size: 24,
                                          ),
                                        ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      currentSong?['title']?.toString() ??
                                          '未在播放',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        color: c.textPrimary,
                                        fontSize: 14,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      currentSong?['artist']?.toString() ??
                                          'DeepVibe',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        color: c.textMuted,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(
                    key: const ValueKey('player-transport-controls'),
                    width: 176,
                    height: 48,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        IconButton(
                          tooltip: '上一首',
                          icon: const Icon(Icons.skip_previous, size: 22),
                          onPressed: currentSong != null
                              ? () => _previous(ref)
                              : null,
                        ),
                        const SizedBox(width: 8),
                        _PlayPauseButton(
                          isPlaying: isPlaying,
                          enabled: currentSong != null,
                          onTap: () => _togglePlayPause(ref),
                        ),
                        const SizedBox(width: 8),
                        IconButton(
                          tooltip: '下一首',
                          icon: const Icon(Icons.skip_next, size: 22),
                          onPressed: currentSong != null
                              ? () => _next(ref)
                              : null,
                        ),
                      ],
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: SizedBox(
                      width: 220,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          _ModeButton(mode: mode, onTap: () => _cycleMode(ref)),
                          const SizedBox(width: 4),
                          Consumer(
                            builder: (context, ref, child) {
                              final lyricsVisible = ref.watch(
                                desktopLyricsWindowOpenProvider,
                              );
                              return IconButton(
                                icon: Icon(Icons.lyrics_outlined, size: 20),
                                color: lyricsVisible
                                    ? c.accent
                                    : c.textSecondary,
                                onPressed: () {
                                  final nextVisible = !lyricsVisible;
                                  ref
                                          .read(
                                            desktopLyricsWindowOpenProvider
                                                .notifier,
                                          )
                                          .state =
                                      nextVisible;
                                  if (nextVisible) {
                                    requestLyricsForCurrentSong(ref);
                                  }
                                },
                                tooltip: '歌词',
                              );
                            },
                          ),
                          const SizedBox(width: 4),
                          IconButton(
                            icon: Icon(Icons.queue_music, size: 20),
                            color: c.textSecondary,
                            onPressed: () {
                              final current = ref.read(
                                queueDrawerVisibleProvider,
                              );
                              ref
                                      .read(queueDrawerVisibleProvider.notifier)
                                      .state =
                                  !current;
                            },
                            tooltip: '播放队列',
                          ),
                          const SizedBox(width: 4),
                          _VolumeControl(c: c),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _togglePlayPause(WidgetRef ref) async {
    await togglePlayPause(ref);
  }

  void _next(WidgetRef ref) async {
    await playNextTrack(ref);
  }

  void _previous(WidgetRef ref) async {
    await playPreviousTrack(ref);
  }

  void _cycleMode(WidgetRef ref) {
    final current = ref.read(playbackModeProvider);
    final next = switch (current) {
      PlaybackMode.sequence => PlaybackMode.shuffle,
      PlaybackMode.shuffle => PlaybackMode.repeatOne,
      PlaybackMode.repeatOne => PlaybackMode.sequence,
    };
    ref.read(playbackModeProvider.notifier).state = next;
  }

  void _seek(WidgetRef ref, Duration position) {
    ref.read(audioPlayerProvider).seek(position);
  }

  void _toggleFocusMode(WidgetRef ref) {
    toggleDeskFocusRoute(ref);
  }
}

class _PlayPauseButton extends StatelessWidget {
  final bool isPlaying;
  final bool enabled;
  final VoidCallback onTap;

  const _PlayPauseButton({
    required this.isPlaying,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    return Material(
      color: enabled ? c.accent : c.surfaceVariant,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: enabled ? onTap : null,
        child: SizedBox(
          width: 40,
          height: 40,
          child: Icon(
            isPlaying ? Icons.pause : Icons.play_arrow,
            color: enabled ? c.background : c.textMuted,
            size: 24,
          ),
        ),
      ),
    );
  }
}

class _ModeButton extends StatelessWidget {
  final PlaybackMode mode;
  final VoidCallback onTap;
  const _ModeButton({required this.mode, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final icon = switch (mode) {
      PlaybackMode.sequence => Icons.repeat_outlined,
      PlaybackMode.shuffle => Icons.shuffle_outlined,
      PlaybackMode.repeatOne => Icons.repeat_one_outlined,
    };
    return IconButton(
      tooltip: switch (mode) {
        PlaybackMode.sequence => '顺序播放',
        PlaybackMode.shuffle => '随机播放',
        PlaybackMode.repeatOne => '单曲循环',
      },
      icon: Icon(icon, size: 18),
      color: c.textSecondary,
      onPressed: onTap,
    );
  }
}

class _ProgressBar extends StatefulWidget {
  final DeepVibeColors c;
  final Duration position;
  final Duration duration;
  final ValueChanged<Duration> onSeek;

  const _ProgressBar({
    required this.c,
    required this.position,
    required this.duration,
    required this.onSeek,
  });

  @override
  State<_ProgressBar> createState() => _ProgressBarState();
}

class _ProgressBarState extends State<_ProgressBar> {
  bool _isDragging = false;
  bool _isHovering = false;
  double _dragValue = 0.0;

  @override
  Widget build(BuildContext context) {
    final total = widget.duration.inMilliseconds.toDouble();
    final posMs = widget.position.inMilliseconds;
    final pos = posMs.clamp(0, total > 0 ? total.toInt() : posMs).toDouble();
    final frac = total > 0 ? (pos / total).clamp(0.0, 1.0) : 0.0;
    final displayValue = _isDragging ? _dragValue : frac;

    final trackHeight = (_isHovering || _isDragging) ? 6.0 : 3.0;
    final thumbSize = (_isHovering || _isDragging) ? 12.0 : 0.0;

    return MouseRegion(
      key: const ValueKey('player-progress-hit-area'),
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _isHovering = true),
      onExit: (_) => setState(() => _isHovering = false),
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onHorizontalDragStart: (details) {
          setState(() {
            _isDragging = true;
            _dragValue = frac;
          });
        },
        onHorizontalDragUpdate: (details) {
          if (!_isDragging) return;
          final box = context.findRenderObject() as RenderBox?;
          if (box == null) return;
          final width = box.size.width;
          setState(() {
            _dragValue = (details.localPosition.dx / width).clamp(0.0, 1.0);
          });
        },
        onHorizontalDragEnd: (_) {
          if (total > 0) {
            final newPosition = Duration(
              milliseconds: (_dragValue * total).round(),
            );
            widget.onSeek(newPosition);
          }
          setState(() => _isDragging = false);
        },
        onTapDown: (details) {
          if (total <= 0) return;
          final box = context.findRenderObject() as RenderBox?;
          if (box == null) return;
          final clickFrac = (details.localPosition.dx / box.size.width).clamp(
            0.0,
            1.0,
          );
          final newPosition = Duration(
            milliseconds: (clickFrac * total).round(),
          );
          widget.onSeek(newPosition);
        },
        child: SizedBox(
          height: 12,
          child: Align(
            alignment: Alignment.topCenter,
            child: LayoutBuilder(
              builder: (context, constraints) {
                final width = constraints.maxWidth;
                final thumbPosition = (width * displayValue).clamp(0.0, width);

                return Stack(
                  alignment: Alignment.topLeft,
                  children: [
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 120),
                      height: trackHeight,
                      decoration: BoxDecoration(
                        color: widget.c.divider,
                        borderRadius: BorderRadius.circular(trackHeight / 2),
                      ),
                    ),
                    AnimatedContainer(
                      key: const ValueKey('player-progress-active-track'),
                      duration: const Duration(milliseconds: 120),
                      width: width * displayValue,
                      height: trackHeight,
                      decoration: BoxDecoration(
                        color: widget.c.accent,
                        borderRadius: BorderRadius.circular(trackHeight / 2),
                      ),
                    ),
                    if (total > 0 && thumbSize > 0)
                      Positioned(
                        top: (trackHeight - thumbSize) / 2,
                        left: thumbPosition - thumbSize / 2,
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 120),
                          width: thumbSize,
                          height: thumbSize,
                          decoration: BoxDecoration(
                            color: widget.c.accent,
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.15),
                                blurRadius: 4,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

/// Hover-popup volume control with vertical slider
class _VolumeControl extends ConsumerStatefulWidget {
  final DeepVibeColors c;

  const _VolumeControl({required this.c});

  @override
  ConsumerState<_VolumeControl> createState() => _VolumeControlState();
}

class _VolumeControlState extends ConsumerState<_VolumeControl> {
  final LayerLink _layerLink = LayerLink();
  OverlayEntry? _overlayEntry;
  Timer? _hideTimer;

  @override
  void dispose() {
    _hideTimer?.cancel();
    _removePopup();
    super.dispose();
  }

  void _setVolume(double value) async {
    if (!mounted) return;
    _overlayEntry?.markNeedsBuild();
    await setPlaybackVolume(ref, value);
  }

  void _showPopup() {
    _hideTimer?.cancel();
    if (_overlayEntry != null) return;

    _overlayEntry = OverlayEntry(
      builder: (context) {
        return Positioned.fill(
          child: IgnorePointer(
            ignoring: false,
            child: CompositedTransformFollower(
              link: _layerLink,
              showWhenUnlinked: false,
              targetAnchor: Alignment.topLeft,
              followerAnchor: Alignment.topLeft,
              offset: const Offset(-6, -156),
              child: Align(
                alignment: Alignment.topLeft,
                widthFactor: 1,
                heightFactor: 1,
                child: MouseRegion(
                  onEnter: (_) => _hideTimer?.cancel(),
                  onExit: (_) => _removePopup(),
                  child: SizedBox(
                    width: 52,
                    height: 156,
                    child: Column(
                      children: [
                        Material(
                          key: const ValueKey('volume-popup'),
                          elevation: 8,
                          borderRadius: BorderRadius.circular(8),
                          color: widget.c.surface,
                          child: Container(
                            width: 52,
                            height: 140,
                            padding: const EdgeInsets.symmetric(
                              vertical: 12,
                              horizontal: 6,
                            ),
                            decoration: BoxDecoration(
                              border: Border.all(color: widget.c.border),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: RotatedBox(
                              quarterTurns: 3,
                              child: SliderTheme(
                                data: SliderThemeData(
                                  trackHeight: 3,
                                  thumbShape: const RoundSliderThumbShape(
                                    enabledThumbRadius: 5,
                                  ),
                                  overlayShape: const RoundSliderOverlayShape(
                                    overlayRadius: 10,
                                  ),
                                  activeTrackColor: widget.c.accent,
                                  inactiveTrackColor: widget.c.divider,
                                  thumbColor: widget.c.accent,
                                ),
                                child: Slider(
                                  value: ref.watch(playerVolumeProvider),
                                  onChanged: _setVolume,
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );

    Overlay.of(context).insert(_overlayEntry!);
  }

  void _scheduleHide() {
    _hideTimer?.cancel();
    _hideTimer = Timer(const Duration(milliseconds: 60), _removePopup);
  }

  void _removePopup() {
    _hideTimer?.cancel();
    _hideTimer = null;
    _overlayEntry?.remove();
    _overlayEntry = null;
  }

  @override
  Widget build(BuildContext context) {
    final volume = ref.watch(playerVolumeProvider);
    final icon = volume <= 0.0
        ? Icons.volume_mute
        : volume < 0.5
        ? Icons.volume_down
        : Icons.volume_up;

    return CompositedTransformTarget(
      link: _layerLink,
      child: MouseRegion(
        onEnter: (_) => _showPopup(),
        onExit: (_) => _scheduleHide(),
        child: SizedBox(
          key: const ValueKey('volume-button'),
          width: 40,
          height: 40,
          child: IconButton(
            icon: Icon(icon, size: 20),
            color: widget.c.textSecondary,
            tooltip: '音量',
            onPressed: () {
              togglePlaybackMute(ref);
            },
          ),
        ),
      ),
    );
  }
}
