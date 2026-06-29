import 'dart:async';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/song.dart';
import '../../lyrics_window/lyrics_window_channel.dart';
import '../../lyrics_window/lyrics_window_manager.dart';
import '../../playback/playback_actions.dart';
import '../../playback/playback_commands.dart';
import '../../playback/playback_providers.dart';
import '../../services/app_settings.dart';
import '../../services/auth_service.dart';
import '../../services/library_service.dart';

final desktopLyricsWindowOpenProvider = StateProvider<bool>((ref) => false);

final desktopLyricsWindowManagerProvider = Provider<LyricsWindowManager>((ref) {
  final manager = LyricsWindowManager(
    onClosed: () {
      ref.read(desktopLyricsWindowOpenProvider.notifier).state = false;
    },
  );
  ref.onDispose(manager.dispose);
  return manager;
});

class DesktopLyricsWindowController extends ConsumerStatefulWidget {
  const DesktopLyricsWindowController({super.key});

  @override
  ConsumerState<DesktopLyricsWindowController> createState() =>
      _DesktopLyricsWindowControllerState();
}

class _DesktopLyricsWindowControllerState
    extends ConsumerState<DesktopLyricsWindowController> {
  final WindowMethodChannel _actionChannel = const WindowMethodChannel(
    lyricsWindowActionChannelName,
    mode: ChannelMode.unidirectional,
  );
  Timer? _retryTimer;

  @override
  void initState() {
    super.initState();
    unawaited(
      _actionChannel
          .setMethodCallHandler(_handleLyricsAction)
          .catchError((_) {}),
    );
  }

  @override
  void dispose() {
    _retryTimer?.cancel();
    unawaited(_actionChannel.setMethodCallHandler(null).catchError((_) {}));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<bool>(desktopLyricsWindowOpenProvider, (previous, next) async {
      final manager = ref.read(desktopLyricsWindowManagerProvider);
      if (next) {
        await manager.openWindow();
        manager.startPositionSync();
        _syncLyricsWindow();
      } else {
        await manager.closeWindow();
      }
    });

    ref.listen(currentSongProvider, (_, next) => _syncLyricsWindow());
    ref.listen(playbackPositionProvider, (_, next) {
      final position = next.valueOrNull ?? Duration.zero;
      final manager = ref.read(desktopLyricsWindowManagerProvider);
      manager.updatePosition(position.inMilliseconds);
      _syncLyricsWindow();
    });
    ref.listen(playbackPlayingProvider, (_, next) => _syncLyricsWindow());
    ref.listen(libraryProvider, (_, next) => _syncLyricsWindow());
    ref.listen(authProvider, (_, next) => _syncLyricsWindow());
    ref.listen(appSettingsProvider, (_, next) => _syncLyricsWindow());

    final open = ref.watch(desktopLyricsWindowOpenProvider);
    final song = ref.watch(currentSongProvider);
    final isPlaying = ref.watch(playbackPlayingProvider).value ?? false;
    _scheduleLyricsRetry(open ? song : null, isPlaying);

    return const SizedBox.shrink();
  }

  Future<dynamic> _handleLyricsAction(MethodCall call) async {
    switch (call.method) {
      case 'previous':
        return _previous();
      case 'playPause':
        return _togglePlayPause();
      case 'next':
        return _next();
      case 'toggleFavorite':
        return _toggleFavorite();
      case 'close':
        ref.read(desktopLyricsWindowOpenProvider.notifier).state = false;
        return null;
      default:
        return null;
    }
  }

  void _syncLyricsWindow() {
    if (!mounted || !ref.read(desktopLyricsWindowOpenProvider)) return;
    final manager = ref.read(desktopLyricsWindowManagerProvider);
    if (!manager.isOpen) return;

    final song = ref.read(currentSongProvider);
    final position =
        ref.read(playbackPositionProvider).valueOrNull ?? Duration.zero;
    final settings = ref.read(appSettingsProvider);
    final auth = ref.read(authProvider);
    final library = ref.read(libraryProvider);
    final lyricsText = _windowLyricsText(song);
    final songId = song?['id']?.toString() ?? '';
    final isFavorite =
        songId.isNotEmpty &&
        library.likedSongs.any((item) => item.id == songId);

    unawaited(
      manager.sendLyricsData(
        lyricsText: lyricsText,
        positionMs: position.inMilliseconds,
        fontSize: settings.lyricsFontSize,
        colorValue: settings.lyricsColorValue,
        isLocked: false,
        isPlaying: ref.read(playbackPlayingProvider).value ?? false,
        isFavorite: isFavorite,
        canFavorite: song != null && auth.isLoggedIn,
      ),
    );
  }

  String _windowLyricsText(Map<String, dynamic>? song) {
    if (song == null) return '';
    final lyricsText = song['lyrics']?.toString().trim() ?? '';
    final lyricsStatus = song['lyricsStatus']?.toString() ?? '';
    if (lyricsStatus == lyricsStatusLoading &&
        lyricsText.isEmpty &&
        !isLyricsLoadingExpired(song)) {
      return '歌词加载中...';
    }
    return lyricsText;
  }

  void _scheduleLyricsRetry(Map<String, dynamic>? song, bool isPlaying) {
    if (song == null || !isPlaying) return;
    final status = song['lyricsStatus']?.toString() ?? '';
    final lyrics = song['lyrics']?.toString().trim() ?? '';
    if (lyrics.isNotEmpty) return;
    if (status != lyricsStatusTimeout && status != lyricsStatusEmpty) return;

    _retryTimer?.cancel();
    _retryTimer = Timer(const Duration(seconds: 8), () {
      if (!mounted) return;
      final current = ref.read(currentSongProvider);
      if (current == null ||
          current['id']?.toString() != song['id']?.toString()) {
        return;
      }
      final currentLyrics = current['lyrics']?.toString().trim() ?? '';
      if (currentLyrics.isNotEmpty) return;
      requestLyricsForCurrentSong(ref);
    });
  }

  Future<void> _togglePlayPause() async {
    await togglePlayPause(ref);
  }

  Future<void> _previous() async {
    await playPreviousTrack(ref);
  }

  Future<void> _next() async {
    await playNextTrack(ref);
  }

  Future<void> _toggleFavorite() async {
    final song = ref.read(currentSongProvider);
    final token = ref.read(authProvider).token;
    if (song == null || token == null || token.isEmpty) return;
    await ref
        .read(libraryProvider.notifier)
        .toggleLike(token, Song.fromJson(song));
    _syncLyricsWindow();
  }
}
