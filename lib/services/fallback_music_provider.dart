import 'music_provider.dart';

/// Fallback music provider - tries primary first, falls back to secondary
///
/// This provider wraps two providers and routes requests based on ID prefix.
/// For search/recommendations, it tries primary first with a timeout, then fallback.
class FallbackMusicProvider implements MusicProvider {
  const FallbackMusicProvider({
    required this.primary,
    required this.fallback,
    this.isPrimaryId = _defaultPrimaryId,
  });

  final MusicProvider primary;
  final MusicProvider fallback;
  final bool Function(String id) isPrimaryId;

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {
    primary.rememberSongs(songs);
    fallback.rememberSongs(songs);
  }

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query) async {
    try {
      final songs = await primary.searchSongs(query);
      if (songs.isNotEmpty) return songs;
    } catch (_) {
      // Fall through to fallback when primary is unavailable
    }
    try {
      return await fallback.searchSongs(query);
    } catch (_) {
      return [];
    }
  }

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async {
    final primaryFuture = primary
        .getRecommendedSongs()
        .catchError((_) => <Map<String, dynamic>>[]);
    final fallbackFuture = fallback
        .getRecommendedSongs()
        .catchError((_) => <Map<String, dynamic>>[]);

    // Wait up to 180ms for primary
    final primaryFirst = await Future.any<List<Map<String, dynamic>>>([
      primaryFuture,
      Future<List<Map<String, dynamic>>>.delayed(
        const Duration(milliseconds: 180),
        () => const [],
      ),
    ]);
    if (primaryFirst.isNotEmpty) return primaryFirst;

    // Primary timed out or empty, try fallback
    final fallbackSongs = await fallbackFuture;
    if (fallbackSongs.isNotEmpty) return fallbackSongs;

    // Both failed/empty, return whatever primary eventually gives
    final primarySongs = await primaryFuture;
    return primarySongs;
  }

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({int? limit, int? offset}) async {
    final primaryFuture = primary
        .getHotPlaylists(limit: limit, offset: offset)
        .catchError((_) => <Map<String, dynamic>>[]);
    final fallbackFuture = fallback
        .getHotPlaylists(limit: limit, offset: offset)
        .catchError((_) => <Map<String, dynamic>>[]);

    final primaryFirst = await Future.any<List<Map<String, dynamic>>>([
      primaryFuture,
      Future<List<Map<String, dynamic>>>.delayed(
        const Duration(milliseconds: 180),
        () => const [],
      ),
    ]);
    if (primaryFirst.isNotEmpty) return primaryFirst;

    final fallbackPlaylists = await fallbackFuture;
    if (fallbackPlaylists.isNotEmpty) return fallbackPlaylists;

    final primaryPlaylists = await primaryFuture;
    return primaryPlaylists;
  }

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) async {
    return isPrimaryId(id)
        ? primary.getPlaylist(id, limit: limit)
        : fallback.getPlaylist(id, limit: limit);
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) async {
    return isPrimaryId(id)
        ? primary.getSongDetail(id)
        : fallback.getSongDetail(id);
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) async {
    return isPrimaryId(id) ? primary.getPlayUrl(id) : fallback.getPlayUrl(id);
  }

  @override
  Future<String> getLyrics(Map<String, dynamic> song) {
    final id = song['id']?.toString() ?? '';
    return isPrimaryId(id) ? primary.getLyrics(song) : fallback.getLyrics(song);
  }

  static bool _defaultPrimaryId(String id) => id.startsWith('bilibili:');
}
