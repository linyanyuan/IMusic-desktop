import 'dart:math';

/// Lyrics parser - extracted from mobile project for desktop reuse
///
/// This file contains the exact same lyrics parsing logic as
/// D:\project\my-music\lib\main.dart lines 8083-8167.
///
/// Supports LRC format with timestamps:
/// [00:10.00]第一句
/// [00:20.123]第二句
/// Also supports metadata lines like [ar:周杰伦] (skipped)
/// and plain text lines without timestamps.

class LyricLine {
  const LyricLine(this.time, this.content);

  final Duration? time;
  final String content;
}

/// Parse LRC lyrics format into timed lines
///
/// Returns list of LyricLine sorted by time.
/// Lines without timestamps have time = null.
/// Metadata lines ([ar:...], [ti:...]) are skipped.
List<LyricLine> parseLyricLines(String lyrics) {
  final text = lyrics.trim();
  if (text.isEmpty) return const [];
  final timestamp = RegExp(r'\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]');
  final lines = <LyricLine>[];
  for (final rawLine in text.split('\n')) {
    final line = rawLine.replaceFirst('﻿', '').trim();
    if (line.isEmpty) continue;
    final matches = timestamp.allMatches(line).toList();
    final content = line.replaceAll(timestamp, '').trim();
    if (matches.isEmpty) {
      // Skip metadata lines like [ar:artist] [ti:title]
      if (RegExp(r'^\[[a-zA-Z]+:.*\]$').hasMatch(line)) continue;
      lines.add(LyricLine(null, content.isEmpty ? line : content));
      continue;
    }
    // One line can have multiple timestamps (same content shown at multiple times)
    for (final match in matches) {
      if (content.isEmpty) continue;
      final minutes = int.tryParse(match.group(1) ?? '') ?? 0;
      final seconds = int.tryParse(match.group(2) ?? '') ?? 0;
      final fraction = (match.group(3) ?? '').padRight(3, '0');
      final milliseconds = int.tryParse(fraction.substring(0, 3)) ?? 0;
      lines.add(
        LyricLine(
          Duration(
            minutes: minutes,
            seconds: seconds,
            milliseconds: milliseconds,
          ),
          content,
        ),
      );
    }
  }
  lines.sort(
    (a, b) => (a.time ?? Duration.zero).compareTo(b.time ?? Duration.zero),
  );
  return lines;
}

/// Find the active (current) lyric line index based on playback position
///
/// Returns the index of the last line whose time <= position.
/// If no timed lines, returns 0 (first line).
/// If lines is empty, returns -1.
int activeLyricIndex(List<LyricLine> lines, Duration position) {
  if (lines.isEmpty) return -1;
  final hasTimedLines = lines.any((line) => line.time != null);
  if (!hasTimedLines) return 0;
  var active = 0;
  for (var i = 0; i < lines.length; i++) {
    final time = lines[i].time;
    if (time != null && time <= position) active = i;
    if (time != null && time > position) break;
  }
  return active;
}

/// Get visible lyric lines around the active line
///
/// Returns lines [activeIndex-2, activeIndex+2] as MapEntry<index, line>.
/// Used to show context around the current line.
List<MapEntry<int, LyricLine>> visibleLyricLines(
  List<LyricLine> lines,
  int activeIndex, {
  int range = 2,
}) {
  if (lines.isEmpty || activeIndex < 0) return const [];
  final start = max(0, activeIndex - range);
  final end = min(lines.length, activeIndex + range + 1);
  return [for (var i = start; i < end; i++) MapEntry(i, lines[i])];
}

/// Calculate progress within the active lyric line (0.0 to 1.0)
///
/// Used for animating white color fill from left to right on the active line.
/// Returns 0.0 at line start, 1.0 when next line starts.
double lyricLineProgress(
  List<LyricLine> lines,
  int activeIndex,
  Duration position,
) {
  if (activeIndex < 0 || activeIndex >= lines.length) return 0;
  final start = lines[activeIndex].time;
  if (start == null) return 1;
  final next = activeIndex + 1 < lines.length
      ? lines[activeIndex + 1].time
      : null;
  final end = next != null && next > start
      ? next
      : start + const Duration(seconds: 4);
  final total = end.inMilliseconds - start.inMilliseconds;
  if (total <= 0) return 1;
  final elapsed = position.inMilliseconds - start.inMilliseconds;
  return (elapsed / total).clamp(0.0, 1.0);
}
