class CollectionLyricSegment {
  const CollectionLyricSegment({required this.title, required this.lyrics});

  final String title;
  final String lyrics;
}

List<String> extractQuotedSongTitles(String title) {
  final seen = <String>{};
  final titles = <String>[];
  var previousClose = -1;

  for (var i = 0; i < title.length; i++) {
    if (title[i] != '》') continue;

    final segment = title.substring(previousClose + 1, i).trim();
    previousClose = i;
    if (segment.isEmpty) continue;

    final openIndex = segment.lastIndexOf('《');
    final item = (openIndex >= 0 ? segment.substring(openIndex + 1) : segment)
        .trim();
    if (item.isEmpty || !seen.add(item)) continue;
    titles.add(item);
  }

  return titles;
}

String combineCollectionLyrics(
  List<CollectionLyricSegment> segments, {
  required Duration totalDuration,
}) {
  if (segments.isEmpty) return '';

  final totalMs = totalDuration.inMilliseconds;
  final segmentMs = totalMs > 0 ? totalMs ~/ segments.length : 0;
  final output = <String>[];

  for (var i = 0; i < segments.length; i++) {
    final segment = segments[i];
    final lyrics = segment.lyrics.trim();
    if (lyrics.isEmpty) continue;

    final offset = Duration(milliseconds: segmentMs * i);
    final shifted = _hasTimestamp(lyrics)
        ? _shiftTimedLyrics(lyrics, offset)
        : _spreadPlainLyrics(lyrics, offset, segmentMs);

    if (shifted.trim().isNotEmpty) output.add(shifted.trim());
  }

  return output.join('\n');
}

bool _hasTimestamp(String lyrics) => _timestampPattern.hasMatch(lyrics);

String _shiftTimedLyrics(String lyrics, Duration offset) {
  return lyrics
      .split('\n')
      .map((line) {
        return line.replaceAllMapped(_timestampPattern, (match) {
          final shifted = _timestampToDuration(match) + offset;
          return _formatTimestamp(shifted);
        });
      })
      .join('\n');
}

String _spreadPlainLyrics(String lyrics, Duration offset, int segmentMs) {
  final lines = lyrics
      .split('\n')
      .map((line) => line.trim())
      .where((line) => line.isNotEmpty)
      .toList();
  if (lines.isEmpty) return '';

  final stepMs = segmentMs > 0 ? segmentMs ~/ lines.length : 0;
  return [
    for (var i = 0; i < lines.length; i++)
      '${_formatTimestamp(offset + Duration(milliseconds: stepMs * i))}${lines[i]}',
  ].join('\n');
}

Duration _timestampToDuration(Match match) {
  final minutes = int.tryParse(match.group(1) ?? '') ?? 0;
  final seconds = int.tryParse(match.group(2) ?? '') ?? 0;
  final fraction = (match.group(3) ?? '').padRight(3, '0');
  final milliseconds = int.tryParse(fraction.substring(0, 3)) ?? 0;
  return Duration(
    minutes: minutes,
    seconds: seconds,
    milliseconds: milliseconds,
  );
}

String _formatTimestamp(Duration duration) {
  final minutes = duration.inMinutes.toString().padLeft(2, '0');
  final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
  final hundredths = (duration.inMilliseconds.remainder(1000) ~/ 10)
      .toString()
      .padLeft(2, '0');
  return '[$minutes:$seconds.$hundredths]';
}

final _timestampPattern = RegExp(r'\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]');
