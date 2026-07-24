import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import '../shared/lyrics_parser.dart';
import 'lyrics_window_args.dart';
import 'lyrics_window_channel.dart';

/// The widget rendered inside the standalone lyrics child window.
class LyricsWindowApp extends StatefulWidget {
  final String windowId;
  final Object? arguments;

  const LyricsWindowApp({super.key, required this.windowId, this.arguments});

  @override
  State<LyricsWindowApp> createState() => _LyricsWindowAppState();
}

class _LyricsWindowAppState extends State<LyricsWindowApp> {
  String _lyricsText = '';
  int _positionMs = 0;
  double _fontSize = 22.0;
  Color _lyricsColor = const Color(0xFF1ED760);
  bool _isLocked = false;
  bool _isPlaying = false;
  bool _isFavorite = false;
  bool _canFavorite = false;
  String? _mainWindowId;
  bool _hovering = false;

  @override
  void initState() {
    super.initState();
    _mainWindowId = lyricsMainWindowIdFromArguments(widget.arguments);
    _setupChannel();
  }

  void _setupChannel() {
    final controller = WindowController.fromWindowId(widget.windowId);
    controller.setWindowMethodHandler((call) async {
      switch (call.method) {
        case 'lyricsData':
          final args = Map<String, dynamic>.from(call.arguments as Map);
          setState(() {
            _lyricsText = args['lyricsText'] as String? ?? _lyricsText;
            _positionMs = args['positionMs'] as int? ?? _positionMs;
            _fontSize = (args['fontSize'] as num?)?.toDouble() ?? _fontSize;
            _lyricsColor = Color(
              args['colorValue'] as int? ?? _lyricsColor.toARGB32(),
            );
            // Lock is local UI state; never overwrite from main-window sync
            // (position/lyrics updates would otherwise unlock immediately).
            _isPlaying = args['isPlaying'] as bool? ?? _isPlaying;
            _isFavorite = args['isFavorite'] as bool? ?? _isFavorite;
            _canFavorite = args['canFavorite'] as bool? ?? _canFavorite;
            _mainWindowId = args['mainWindowId']?.toString() ?? _mainWindowId;
          });
          break;
        case 'position':
          final args = Map<String, dynamic>.from(call.arguments as Map);
          setState(() {
            _positionMs = args['positionMs'] as int? ?? _positionMs;
          });
          break;
        case 'window_close':
          await windowManager.close();
          break;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: MouseRegion(
        onEnter: (_) => setState(() => _hovering = true),
        onExit: (_) => setState(() => _hovering = false),
        child: GestureDetector(
          behavior: HitTestBehavior.translucent,
          onPanStart: _isLocked ? null : (_) => windowManager.startDragging(),
          child: Material(
            color: Colors.transparent,
            child: Stack(
              children: [
                Positioned.fill(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(18, 42, 18, 16),
                    child: Center(
                      child: _LyricsText(
                        view: _lyricsView(),
                        fontSize: _fontSize,
                      ),
                    ),
                  ),
                ),
                Positioned(
                  top: 6,
                  left: 0,
                  right: 0,
                  child: IgnorePointer(
                    ignoring: !_hovering,
                    child: AnimatedOpacity(
                      duration: const Duration(milliseconds: 140),
                      opacity: _hovering ? 1 : 0,
                      child: Center(
                        child: _Toolbar(
                          isPlaying: _isPlaying,
                          isLocked: _isLocked,
                          isFavorite: _isFavorite,
                          canFavorite: _canFavorite,
                          onPrevious: () => _sendAction('previous'),
                          onPlayPause: () => _sendAction('playPause'),
                          onNext: () => _sendAction('next'),
                          onFavorite: _canFavorite
                              ? () => _sendAction('toggleFavorite')
                              : null,
                          onLock: () async {
                            setState(() => _isLocked = !_isLocked);
                            await windowManager.setAlwaysOnTop(true);
                          },
                          onClose: () async {
                            await _sendAction('close');
                            await windowManager.close();
                          },
                        ),
                      ),
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

  _LyricsView _lyricsView() {
    final text = _lyricsText.trim();
    if (text.isEmpty) return _LyricsView(current: '暂无歌词', color: Colors.white);
    if (text == '歌词加载中...') {
      return _LyricsView(
        current: text,
        color: Colors.white.withValues(alpha: 0.76),
      );
    }

    final lines = parseLyricLines(text);
    if (lines.isEmpty) {
      return _LyricsView(current: text, color: _lyricsColor);
    }

    final activeIndex = activeLyricIndex(
      lines,
      Duration(milliseconds: _positionMs),
    );
    final current = activeIndex >= 0 && activeIndex < lines.length
        ? lines[activeIndex].content
        : lines.first.content;
    final nextIndex = activeIndex + 1;
    final next = nextIndex >= 0 && nextIndex < lines.length
        ? lines[nextIndex].content
        : null;
    return _LyricsView(current: current, next: next, color: _lyricsColor);
  }

  Future<void> _sendAction(String method) async {
    if (_mainWindowId == null || _mainWindowId!.isEmpty) return;
    const channel = WindowMethodChannel(
      lyricsWindowActionChannelName,
      mode: ChannelMode.unidirectional,
    );
    try {
      await channel.invokeMethod(method, {'sourceWindowId': widget.windowId});
    } catch (_) {}
  }
}

class _Toolbar extends StatelessWidget {
  final bool isPlaying;
  final bool isLocked;
  final bool isFavorite;
  final bool canFavorite;
  final VoidCallback onPrevious;
  final VoidCallback onPlayPause;
  final VoidCallback onNext;
  final VoidCallback? onFavorite;
  final VoidCallback onLock;
  final VoidCallback onClose;

  const _Toolbar({
    required this.isPlaying,
    required this.isLocked,
    required this.isFavorite,
    required this.canFavorite,
    required this.onPrevious,
    required this.onPlayPause,
    required this.onNext,
    required this.onFavorite,
    required this.onLock,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.42),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _ToolbarButton(
              tooltip: isFavorite ? '取消喜欢' : '喜欢',
              icon: isFavorite ? Icons.favorite : Icons.favorite_border,
              color: isFavorite ? const Color(0xFFFF4D6D) : null,
              onPressed: canFavorite ? onFavorite : null,
              key: const ValueKey('desktop-lyrics-window-favorite'),
            ),
            const SizedBox(width: 2),
            _ToolbarButton(
              tooltip: '上一首',
              icon: Icons.skip_previous,
              onPressed: onPrevious,
            ),
            _ToolbarButton(
              tooltip: isPlaying ? '暂停' : '播放',
              icon: isPlaying ? Icons.pause : Icons.play_arrow,
              onPressed: onPlayPause,
            ),
            _ToolbarButton(
              tooltip: '下一首',
              icon: Icons.skip_next,
              onPressed: onNext,
            ),
            const SizedBox(width: 2),
            _ToolbarButton(
              tooltip: isLocked ? '解锁拖动' : '锁定位置',
              icon: isLocked ? Icons.lock_outline : Icons.lock_open_outlined,
              onPressed: onLock,
              key: const ValueKey('desktop-lyrics-window-lock'),
            ),
            _ToolbarButton(
              tooltip: '关闭',
              icon: Icons.close,
              onPressed: onClose,
              key: const ValueKey('desktop-lyrics-window-close'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ToolbarButton extends StatelessWidget {
  final String tooltip;
  final IconData icon;
  final Color? color;
  final VoidCallback? onPressed;

  const _ToolbarButton({
    super.key,
    required this.tooltip,
    required this.icon,
    this.color,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    return SizedBox(
      width: 32,
      height: 32,
      child: IconButton(
        tooltip: tooltip,
        splashRadius: 16,
        padding: EdgeInsets.zero,
        icon: Icon(
          icon,
          size: 18,
          color: enabled
              ? color ?? Colors.white
              : Colors.white.withValues(alpha: 0.36),
        ),
        onPressed: onPressed,
      ),
    );
  }
}

class _LyricsView {
  final String current;
  final String? next;
  final Color color;

  const _LyricsView({required this.current, this.next, required this.color});
}

class _LyricsText extends StatelessWidget {
  final _LyricsView view;
  final double fontSize;

  const _LyricsText({required this.view, required this.fontSize});

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 160),
      child: Column(
        key: ValueKey('${view.current}-${view.next ?? ''}'),
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            view.current,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: view.color,
              fontSize: fontSize,
              height: 1.12,
              fontWeight: FontWeight.w800,
              shadows: _textShadow,
            ),
          ),
          if (view.next != null) ...[
            const SizedBox(height: 8),
            Text(
              view.next!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.88),
                fontSize: (fontSize - 3).clamp(15.0, 30.0),
                height: 1.12,
                fontWeight: FontWeight.w700,
                shadows: _textShadow,
              ),
            ),
          ],
        ],
      ),
    );
  }

  List<Shadow> get _textShadow => [
    Shadow(
      color: Colors.black.withValues(alpha: 0.7),
      blurRadius: 5,
      offset: const Offset(0, 1),
    ),
    Shadow(
      color: Colors.black.withValues(alpha: 0.42),
      blurRadius: 14,
      offset: const Offset(0, 2),
    ),
  ];
}
