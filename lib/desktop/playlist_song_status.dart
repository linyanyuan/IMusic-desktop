import '../core/models/song.dart';
import '../core/song_identity.dart';

bool playlistContainsSong(Map<String, dynamic> playlist, Song song) {
  final songs = playlist['songs'];
  if (songs is! List) return false;

  final targetIds = songIdentityValues(song.toJson());
  if (targetIds.isEmpty) return false;

  return songs.any((item) {
    if (item is! Map) return false;
    return songIdentityValues(
      Map<String, dynamic>.from(item),
    ).any(targetIds.contains);
  });
}
