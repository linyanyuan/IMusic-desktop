import '../core/models/song.dart';

bool playlistContainsSong(Map<String, dynamic> playlist, Song song) {
  final songs = playlist['songs'];
  if (songs is! List) return false;

  final targetIds = _songIdentityValues(song.toJson());
  if (targetIds.isEmpty) return false;

  return songs.any((item) {
    if (item is! Map) return false;
    return _songIdentityValues(
      Map<String, dynamic>.from(item),
    ).any(targetIds.contains);
  });
}

Set<String> _songIdentityValues(Map<String, dynamic> song) {
  return {
    for (final key in const [
      'id',
      'playbackId',
      'sourceId',
      'playbackSourceId',
    ])
      if ((song[key]?.toString().trim() ?? '').isNotEmpty)
        song[key].toString().trim(),
  };
}
