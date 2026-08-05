import 'music_provider.dart';
import 'chksz_music_client.dart';

/// ChKSz NetEase music provider — search, direct playback URLs, lyrics and
/// playlists for `chksz:` prefixed ids.
///
/// Plays via NetEase direct links (no custom headers) so the desktop player
/// can stream with plain [UrlSource]. Playback failures fall back to
/// Bilibili-by-title at the Hybrid layer, never inside this provider.
class ChkszMusicProvider implements MusicProvider {
  ChkszMusicProvider({ChkszMusicClient? client})
    : _client = client ?? ChkszMusicClient();

  final ChkszMusicClient _client;
  final Map<String, Map<String, dynamic>> _cache = {};

  @override
  Future<List<Map<String, dynamic>>> searchSongs(
    String query, {
    int page = 1,
  }) async {
    final results = await _client.searchSongs(query, page: page);
    _cacheSongs(results);
    return results;
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) => _client.getPlayUrl(id);

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async {
    final existing = song['lyrics']?.toString().trim() ?? '';
    if (existing.isNotEmpty) return existing;
    final id = song['id']?.toString() ?? '';
    if (!ChkszMusicClient.isChkszSongId(id)) return '';
    try {
      return await _client.getLyric(id);
    } catch (_) {
      return '';
    }
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) async {
    // The ChKSz API has no separate detail endpoint; the resolve endpoint
    // (163_music) returns name/artist/album/picUrl alongside the play url.
    // Prefer the cached row when present, else ask the client.
    final cached = _cache[id];
    if (cached != null &&
        (cached['title']?.toString().trim().isNotEmpty ?? false)) {
      return cached;
    }
    try {
      final detail = await _client.getSongDetail(id);
      if ((detail['title']?.toString().trim().isNotEmpty ?? false)) {
        _cache[id] = {...cached ?? const {}, ...detail};
        return detail;
      }
    } catch (_) {}
    return {'id': id};
  }

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) {
    return _client.getPlaylist(id, limit: limit);
  }

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async => const [];

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async => const [];

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {
    _cacheSongs(songs);
  }

  void _cacheSongs(Iterable<Map<String, dynamic>> songs) {
    for (final song in songs) {
      final id = song['id']?.toString() ?? '';
      if (id.isNotEmpty) _cache[id] = song;
    }
  }
}
