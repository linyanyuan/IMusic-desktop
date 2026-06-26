import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/shared/collection_lyrics.dart';
import 'package:deepvibe_desktop/shared/lyrics_parser.dart';

void main() {
  test('extracts quoted song titles from a collection title', () {
    expect(extractQuotedSongTitles('《可能》《有风无风皆自由》《一路生花》《若月亮没来》'), [
      '可能',
      '有风无风皆自由',
      '一路生花',
      '若月亮没来',
    ]);
  });

  test(
    'extracts mixed quoted collection titles when the first bracket is omitted',
    () {
      expect(extractQuotedSongTitles('《一样的月光》《最初的记忆》《行走的鱼》不要再孤单》《失落沙洲》'), [
        '一样的月光',
        '最初的记忆',
        '行走的鱼',
        '不要再孤单',
        '失落沙洲',
      ]);
    },
  );

  test('combines timed lyrics into progress-aligned collection segments', () {
    final combined = combineCollectionLyrics(const [
      CollectionLyricSegment(
        title: '可能',
        lyrics: '[00:00.00]可能第一句\n[00:10.00]可能第二句',
      ),
      CollectionLyricSegment(
        title: '一路生花',
        lyrics: '[00:00.00]一路第一句\n[00:08.00]一路第二句',
      ),
    ], totalDuration: const Duration(minutes: 6));

    expect(combined, contains('[00:00.00]可能第一句'));
    expect(combined, contains('[03:00.00]一路第一句'));

    final lines = parseLyricLines(combined);
    final active = activeLyricIndex(lines, const Duration(minutes: 3));

    expect(lines[active].content, '一路第一句');
  });
}
