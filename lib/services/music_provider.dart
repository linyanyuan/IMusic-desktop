/// Playback URL with headers and lyrics
class PlaybackUrl {
  const PlaybackUrl(
    this.url, {
    this.headers = const {},
    this.lyrics = '',
    this.resolvedId = '',
  });

  final String url;
  final Map<String, String> headers;
  final String lyrics;
  final String resolvedId;
}

/// Abstract music provider interface
abstract class MusicProvider {
  /// Remember songs for future reference (caching)
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  /// Get lyrics for a song
  Future<String> getLyrics(Map<String, dynamic> song) async {
    return song['lyrics']?.toString().trim() ?? '';
  }

  /// Search songs by query
  Future<List<Map<String, dynamic>>> searchSongs(String query);

  /// Get recommended songs
  Future<List<Map<String, dynamic>>> getRecommendedSongs();

  /// Get hot playlists
  Future<List<Map<String, dynamic>>> getHotPlaylists({int? limit, int? offset});

  /// Get playlist details
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit});

  /// Get song detail
  Future<Map<String, dynamic>> getSongDetail(String id);

  /// Get playback URL
  Future<PlaybackUrl> getPlayUrl(String id);
}
