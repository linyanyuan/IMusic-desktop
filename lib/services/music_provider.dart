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

enum PlaylistSummaryKind {
  multiPage,
  singleLongCollection,
  singlePageCollection,
}

class PlaylistSummary {
  const PlaylistSummary({
    required this.kind,
    required this.songCount,
    required this.durationSeconds,
  }) : available = true;

  const PlaylistSummary.unavailable()
    : available = false,
      kind = null,
      songCount = 0,
      durationSeconds = 0;

  final bool available;
  final PlaylistSummaryKind? kind;
  final int songCount;
  final int durationSeconds;
}

abstract interface class PlaylistSummaryProvider {
  Future<PlaylistSummary> getPlaylistSummary(Map<String, dynamic> playlist);
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

extension MusicProviderPlaylistSummary on MusicProvider {
  Future<PlaylistSummary> getPlaylistSummary(
    Map<String, dynamic> playlist,
  ) async {
    final provider = this;
    if (provider is PlaylistSummaryProvider) {
      return (provider as PlaylistSummaryProvider).getPlaylistSummary(playlist);
    }
    return const PlaylistSummary.unavailable();
  }
}
