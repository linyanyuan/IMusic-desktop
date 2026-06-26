import 'dart:convert';

bool isLyricsWindowArguments(Object? arguments) {
  if (arguments == null) return false;
  if (arguments is Map) {
    return isLyricsWindowArguments(arguments['type']) ||
        isLyricsWindowArguments(arguments['arguments']);
  }

  final text = arguments.toString().trim();
  if (text == 'lyrics') return true;
  if (text == '"lyrics"') return true;
  if (text.contains('"type":"lyrics"')) return true;
  if (text.contains('"arguments":"lyrics"')) return true;
  return false;
}

String? lyricsMainWindowIdFromArguments(Object? arguments) {
  if (arguments == null) return null;
  if (arguments is Map) {
    return arguments['mainWindowId']?.toString();
  }

  final text = arguments.toString().trim();
  try {
    final decoded = jsonDecode(text);
    if (decoded is Map) {
      return decoded['mainWindowId']?.toString();
    }
  } catch (_) {
    final match = RegExp(r'"mainWindowId"\s*:\s*"([^"]+)"').firstMatch(text);
    return match?.group(1);
  }
  return null;
}
