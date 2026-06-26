import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/song.dart';
import '../../services/music_service.dart';
import '../../shared/lyrics_parser.dart';

/// Re-export LyricLine from shared parser
export '../../shared/lyrics_parser.dart' show LyricLine;

/// Lyrics state
class LyricsState {
  final List<LyricLine> lines;
  final bool loading;
  final bool empty;
  final String? error;

  const LyricsState({
    this.lines = const [],
    this.loading = false,
    this.empty = false,
    this.error,
  });

  LyricsState copyWith({
    List<LyricLine>? lines,
    bool? loading,
    bool? empty,
    String? error,
  }) =>
      LyricsState(
        lines: lines ?? this.lines,
        loading: loading ?? this.loading,
        empty: empty ?? this.empty,
        error: error ?? this.error,
      );
}

/// Lyrics notifier
class LyricsNotifier extends StateNotifier<LyricsState> {
  LyricsNotifier(this._musicService) : super(const LyricsState());

  final MusicService _musicService;
  Song? _currentSong;

  /// Load lyrics for a song
  Future<void> loadLyrics(Song song) async {
    print('[LyricsNotifier] loadLyrics - 歌曲: ${song.title} (${song.id})');

    if (_currentSong?.id == song.id && state.lines.isNotEmpty) {
      print('[LyricsNotifier] 歌词已加载，跳过');
      return; // Already loaded
    }

    _currentSong = song;
    state = const LyricsState(loading: true);

    try {
      // Get cached song data with lyrics
      print('[LyricsNotifier] 从缓存获取歌词...');
      final songMap = _musicService.getCachedSongMap(song.id);
      if (songMap == null) {
        print('[LyricsNotifier] 缓存中没有歌曲数据');
        state = const LyricsState(empty: true);
        return;
      }

      final lyricsText = songMap['lyrics']?.toString().trim() ?? '';
      print('[LyricsNotifier] 歌词文本长度: ${lyricsText.length}');

      if (lyricsText.isEmpty) {
        print('[LyricsNotifier] 歌词为空');
        state = const LyricsState(empty: true);
        return;
      }

      // Use shared parser from mobile project
      final lines = parseLyricLines(lyricsText);
      print('[LyricsNotifier] 解析歌词: ${lines.length} 行');

      state = LyricsState(lines: lines);
    } catch (e) {
      print('[LyricsNotifier] 加载歌词失败: $e');
      state = LyricsState(error: e.toString(), empty: true);
    }
  }

  /// Clear current lyrics
  void clear() {
    _currentSong = null;
    state = const LyricsState();
  }

  /// Get active lyric line index for current playback position
  int getActiveIndex(Duration position) {
    if (state.lines.isEmpty) return -1;

    final hasTimedLines = state.lines.any((line) => line.time != null);
    if (!hasTimedLines) return 0;

    var active = 0;
    for (var i = 0; i < state.lines.length; i++) {
      final time = state.lines[i].time;
      if (time != null && time <= position) {
        active = i;
      }
      if (time != null && time > position) break;
    }
    return active;
  }

  /// Get visible lyric lines around active index
  List<MapEntry<int, LyricLine>> getVisibleLines(int activeIndex, {int range = 2}) {
    if (state.lines.isEmpty || activeIndex < 0) return const [];

    final start = (activeIndex - range).clamp(0, state.lines.length);
    final end = (activeIndex + range + 1).clamp(0, state.lines.length);

    return [
      for (var i = start; i < end; i++) MapEntry(i, state.lines[i]),
    ];
  }
}

final lyricsProvider = StateNotifierProvider<LyricsNotifier, LyricsState>((ref) {
  final musicService = ref.watch(musicServiceProvider);
  return LyricsNotifier(musicService);
});
