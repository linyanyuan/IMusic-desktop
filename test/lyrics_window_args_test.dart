import 'package:flutter_test/flutter_test.dart';
import 'package:deepvibe_desktop/lyrics_window/lyrics_window_args.dart';

void main() {
  test('recognizes lyrics child window arguments across plugin formats', () {
    expect(isLyricsWindowArguments('lyrics'), isTrue);
    expect(isLyricsWindowArguments('"lyrics"'), isTrue);
    expect(isLyricsWindowArguments({'type': 'lyrics'}), isTrue);
    expect(isLyricsWindowArguments({'arguments': 'lyrics'}), isTrue);
    expect(isLyricsWindowArguments('main'), isFalse);
    expect(isLyricsWindowArguments(null), isFalse);
  });
}
