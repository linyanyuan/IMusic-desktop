import 'dart:async';

import 'chksz_music_client.dart';
import 'chksz_music_provider.dart';
import 'gdstudio_music_client.dart';
import 'music_provider.dart';
import '../shared/collection_lyrics.dart';

/// Hybrid music provider - combines metadata provider with playback provider
///
/// This is the main provider that coordinates:
/// - Metadata (lyrics, song info) from Meting/Default
/// - Playback URLs from Bilibili
/// - Preferred song-tab path via GDStudio (search + direct URL), with fallback
/// - ChKSz NetEase songs (search source picker + direct URL), with fallback
///
/// For meting songs: fetches metadata, then resolves Bilibili playback ID
/// For Bilibili songs: uses direct playback, but lyrics come from reverse metadata search
class HybridMusicProvider
    implements
        MusicProvider,
        PlaylistSummaryProvider,
        PlaybackIdResolver,
        ChkszSearchProvider {
  HybridMusicProvider({
    required this.metadata,
    required this.playback,
    GdStudioMusicClient? gdStudio,
    this.chksz,
  }) : gdStudio = gdStudio ?? GdStudioMusicClient(),
       _songCache = {};

  final MusicProvider metadata;
  final MusicProvider playback;
  final GdStudioMusicClient gdStudio;

  /// ChKSz provider; null when the app was built without the source.
  final ChkszMusicProvider? chksz;
  final Map<String, Map<String, dynamic>> _songCache;

  @override
  Future<List<Map<String, dynamic>>> searchSongs(
    String query, {
    int page = 1,
  }) async {
    final safePage = page < 1 ? 1 : page;
    // Start both searches in parallel
    final metadataFuture = metadata
        .searchSongs(query, page: safePage)
        .catchError((_) => <Map<String, dynamic>>[]);
    final playbackFuture = _searchPlayback(
      query,
      page: safePage,
    ).catchError((_) => <Map<String, dynamic>>[]);

    // Wait up to 800ms for metadata
    final metadataEarly = await Future.any<List<Map<String, dynamic>>>([
      metadataFuture,
      Future<List<Map<String, dynamic>>>.delayed(
        const Duration(milliseconds: 800),
        () => const [],
      ),
    ]);

    if (metadataEarly.isNotEmpty) {
      return _mergeSearchResults(
        metadataSongs: metadataEarly,
        playbackResults: await playbackFuture,
        query: query,
      );
    }

    // Metadata timed out, use playback if available
    final playbackResults = await playbackFuture;
    if (playbackResults.isNotEmpty) return playbackResults;

    // Both failed, return whatever metadata eventually gives
    final metadataSongs = await metadataFuture;
    if (metadataSongs.isEmpty) return const [];
    return _mergeSearchResults(
      metadataSongs: metadataSongs,
      playbackResults: const [],
      query: query,
    );
  }

  /// Metadata songs tab: prefer GDStudio direct results, else Meting/Default
  /// (still marked for Bilibili playback as fallback at play time).
  Future<List<Map<String, dynamic>>> searchMetadataSongs(
    String query, {
    int page = 1,
  }) async {
    final safePage = page < 1 ? 1 : page;
    try {
      final gds = await gdStudio.searchSongs(query, page: safePage);
      if (gds.isNotEmpty) {
        print('[Hybrid] 歌曲 tab 使用 GDStudio 结果: ${gds.length} page=$safePage');
        _cacheSongs(gds);
        return gds;
      }
      print('[Hybrid] GDStudio 搜索为空，回退元数据搜索 page=$safePage');
    } catch (e) {
      print('[Hybrid] GDStudio 搜索失败，回退元数据: $e');
    }

    final results = await metadata
        .searchSongs(query, page: safePage)
        .catchError((_) => <Map<String, dynamic>>[]);
    final songs = results
        .where(_isSongResult)
        .map(_withBilibiliPlaybackSource)
        .toList();
    _cacheSongs(songs);
    return songs;
  }

  static bool _isSongResult(Map<String, dynamic> item) {
    final type = item['resultType']?.toString().trim() ?? '';
    return type.isEmpty || type == 'song';
  }

  /// Bilibili playlists only (no metadata songs).
  Future<List<Map<String, dynamic>>> searchBilibiliPlaylists(
    String query, {
    int page = 1,
  }) async {
    final safePage = page < 1 ? 1 : page;
    final results = <Map<String, dynamic>>[];
    final seenIds = <String>{};

    void addPlaylists(Iterable<Map<String, dynamic>> items) {
      for (final item in items) {
        if (item['resultType']?.toString() != 'playlist') continue;
        final id = item['id']?.toString() ?? '';
        if (id.isEmpty || !seenIds.add(id)) continue;
        results.add(_withSourceLabel(item));
      }
    }

    try {
      addPlaylists(await _searchPlayback(query, page: safePage));
    } catch (_) {}

    // Only expand with "歌单" suffix on the first page to avoid duplicate sets.
    if (safePage == 1 && (!_looksLikePlaylistQuery(query) || results.isEmpty)) {
      try {
        addPlaylists(await _searchPlayback('$query 歌单', page: 1));
      } catch (_) {}
    }

    return results;
  }

  @override
  Future<List<Map<String, dynamic>>> searchChkszSongs(
    String query, {
    int page = 1,
  }) async {
    if (chksz == null) {
      throw const ChkszApiKeyMissingException('ChKSz 未启用');
    }
    final results = await chksz!.searchSongs(query, page: page);
    _cacheSongs(results);
    return results;
  }

  Future<List<Map<String, dynamic>>> _searchPlayback(
    String query, {
    int page = 1,
  }) async {
    return (await playback.searchSongs(query, page: page))
        .map(
          (song) => {
            ...song,
            'sourceLabel': song['sourceLabel']?.toString().isNotEmpty == true
                ? song['sourceLabel']
                : 'B站',
          },
        )
        .toList();
  }

  Future<List<Map<String, dynamic>>> _mergeSearchResults({
    required List<Map<String, dynamic>> metadataSongs,
    required List<Map<String, dynamic>> playbackResults,
    required String query,
  }) async {
    final results = <Map<String, dynamic>>[];
    final seenIds = <String>{};

    void addResult(Map<String, dynamic> item) {
      final id = item['id']?.toString() ?? '';
      if (id.isEmpty || !seenIds.add(id)) return;
      results.add(item);
    }

    // Add all metadata songs with Bilibili playback marker
    final mapped = metadataSongs.map(_withBilibiliPlaybackSource).toList();
    _cacheSongs(mapped);
    for (final song in mapped) {
      addResult(song);
    }

    // Add Bilibili playlists
    for (final item in playbackResults) {
      if (item['resultType']?.toString() == 'playlist') addResult(item);
    }

    if (_looksLikePlaylistQuery(query)) return results;

    // Search for additional playlists
    try {
      final playlistResults = await _searchPlayback('$query 歌单');
      for (final item in playlistResults) {
        if (item['resultType']?.toString() == 'playlist') addResult(item);
      }
    } catch (_) {}

    return results;
  }

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async {
    final metadataFuture = metadata.getRecommendedSongs().catchError(
      (_) => <Map<String, dynamic>>[],
    );
    final playbackFuture = playback.getRecommendedSongs().catchError(
      (_) => <Map<String, dynamic>>[],
    );

    final metadataEarly = await Future.any<List<Map<String, dynamic>>>([
      metadataFuture,
      Future<List<Map<String, dynamic>>>.delayed(
        const Duration(milliseconds: 180),
        () => const [],
      ),
    ]);

    if (metadataEarly.isNotEmpty) {
      final mapped = metadataEarly.map(_withBilibiliPlaybackSource).toList();
      _cacheSongs(mapped);
      return mapped;
    }

    final playbackSongs = await playbackFuture;
    if (playbackSongs.isNotEmpty) {
      return playbackSongs.map(_withSourceLabel).toList();
    }

    final metadataSongs = await metadataFuture;
    final mapped = metadataSongs.map(_withBilibiliPlaybackSource).toList();
    _cacheSongs(mapped);
    return mapped;
  }

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async {
    final metadataFuture = metadata
        .getHotPlaylists(limit: limit, offset: offset)
        .catchError((_) => <Map<String, dynamic>>[]);
    final playbackFuture = playback
        .getHotPlaylists(limit: limit, offset: offset)
        .catchError((_) => <Map<String, dynamic>>[]);

    final metadataFirst = await Future.any<List<Map<String, dynamic>>>([
      metadataFuture,
      Future<List<Map<String, dynamic>>>.delayed(
        const Duration(milliseconds: 180),
        () => const [],
      ),
    ]);

    if (metadataFirst.isNotEmpty) {
      return metadataFirst.map(_withSourceLabel).toList();
    }

    final playbackPlaylists = await playbackFuture;
    if (playbackPlaylists.isNotEmpty) {
      return playbackPlaylists.map(_withSourceLabel).toList();
    }

    final metadataPlaylists = await metadataFuture;
    return metadataPlaylists.map(_withSourceLabel).toList();
  }

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) async {
    if (ChkszMusicClient.isChkszPlaylistId(id)) {
      if (chksz == null) {
        throw StateError('ChKSz 未启用');
      }
      final playlist = await chksz!.getPlaylist(id, limit: limit);
      _cachePlaylistSongs(playlist);
      return playlist;
    }
    final playlist = _isMetingCollectionId(id)
        ? await metadata.getPlaylist(id, limit: limit)
        : await playback.getPlaylist(id, limit: limit);
    _cachePlaylistSongs(playlist);
    return playlist;
  }

  @override
  Future<PlaylistSummary> getPlaylistSummary(Map<String, dynamic> playlist) {
    return playback.getPlaylistSummary(playlist);
  }

  @override
  Future<String> resolvePlaybackId(Map<String, dynamic> song) async {
    final id = song['id']?.toString().trim() ?? '';
    final playbackId = song['playbackId']?.toString().trim() ?? '';
    if (playbackId.startsWith('bilibili:')) {
      return _canonicalBilibiliPlaybackId(playbackId);
    }
    if (!_isMetingId(id)) return _canonicalBilibiliPlaybackId(id);

    final cached = _songCache[id];
    final metadataSong = cached == null ? song : {...cached, ...song};
    return _resolveBilibiliPlaybackId(metadataSong);
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) async {
    if (ChkszMusicClient.isChkszId(id)) {
      return chksz?.getSongDetail(id) ?? {'id': id};
    }
    if (!_isMetingId(id)) return playback.getSongDetail(id);
    final detail = await metadata.getSongDetail(id);
    return _mergeCachedDetail(id, detail);
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) async {
    // GDStudio song-tab entries: direct URL first, then Bilibili by title.
    if (GdStudioMusicClient.isGdStudioId(id)) {
      try {
        final direct = await gdStudio.getPlayUrl(id);
        if (direct.url.trim().isNotEmpty) {
          print('[Hybrid] GDStudio 直链播放: $id');
          // Cover must not block the play path.
          unawaited(_ensureGdStudioCover(id));
          return direct;
        }
      } catch (e) {
        print('[Hybrid] GDStudio 取链失败，回退 B 站: $e');
      }
      final cached = _songCache[id] ?? {'id': id};
      try {
        final resolvedId = await _resolveBilibiliPlaybackId(cached);
        final playUrl = await playback.getPlayUrl(resolvedId);
        return PlaybackUrl(
          playUrl.url,
          headers: playUrl.headers,
          lyrics: playUrl.lyrics,
          resolvedId: resolvedId,
        );
      } catch (e) {
        throw StateError('无法获取播放地址: ${e.toString()}');
      }
    }

    // ChKSz NetEase songs: direct URL first, Bilibili-by-title fallback.
    // A missing API key is a configuration error — surface it, never fall
    // back (the UI prompts the user to configure the key).
    if (ChkszMusicClient.isChkszId(id)) {
      // Only song ids are playable; a playlist id here is a routing mistake.
      if (!ChkszMusicClient.isChkszSongId(id)) {
        throw StateError('ChKSz 歌单不能直接播放: $id');
      }
      if (chksz == null) throw StateError('ChKSz 未启用');
      try {
        final direct = await chksz!.getPlayUrl(id);
        if (direct.url.trim().isNotEmpty) {
          print('[Hybrid] ChKSz 直链播放: $id');
          return direct;
        }
      } on ChkszApiKeyMissingException {
        rethrow;
      } on ChkszApiException {
        // Config/business errors (invalid key, rate limit) are actionable;
        // do not mask them with a Bilibili-by-title fallback.
        rethrow;
      } catch (e) {
        print('[Hybrid] ChKSz 取链失败，回退 B 站: $e');
      }
      final cached = _songCache[id] ?? {'id': id};
      try {
        final resolvedId = await _resolveBilibiliPlaybackId(
          cached,
        ).timeout(ChkszMusicClient.fallbackTimeout);
        final playUrl = await playback.getPlayUrl(resolvedId);
        return PlaybackUrl(
          playUrl.url,
          headers: playUrl.headers,
          lyrics: playUrl.lyrics,
          resolvedId: resolvedId,
          // Pass the ChKSz search-row cover through on Bilibili fallback.
          coverUrl: cached['coverUrl']?.toString().trim() ?? '',
        );
      } catch (e) {
        throw StateError('无法获取播放地址: ${e.toString()}');
      }
    }

    // Pure Bilibili songs
    if (!_isMetingId(id)) {
      final playUrl = await playback.getPlayUrl(id);
      return PlaybackUrl(
        playUrl.url,
        headers: playUrl.headers,
        lyrics: playUrl.lyrics,
        resolvedId: playUrl.resolvedId,
      );
    }

    // For meting songs: detail first, then stable playbackId, then search.
    try {
      final cached = _songCache[id];
      final existingPlaybackId = cached?['playbackId']?.toString().trim() ?? '';
      Map<String, dynamic> detail;
      if (existingPlaybackId.isNotEmpty) {
        // Stable playback id already known — still merge detail for lyrics.
        detail = cached != null
            ? _mergeCachedDetail(id, cached)
            : _mergeCachedDetail(id, await metadata.getSongDetail(id));
      } else {
        // Search-cache title alone must not skip detail lookup.
        detail = _mergeCachedDetail(id, await metadata.getSongDetail(id));
      }
      final detailPlaybackId = detail['playbackId']?.toString().trim() ?? '';
      final resolvedId = detailPlaybackId.isNotEmpty
          ? detailPlaybackId
          : existingPlaybackId.isNotEmpty
          ? existingPlaybackId
          : await _resolveBilibiliPlaybackId(detail);
      final playUrl = await playback.getPlayUrl(resolvedId);
      final lyrics = detail['lyrics']?.toString() ?? '';
      return PlaybackUrl(
        playUrl.url,
        headers: playUrl.headers,
        lyrics: lyrics.isNotEmpty ? lyrics : playUrl.lyrics,
        resolvedId: resolvedId,
        coverUrl: detail['coverUrl']?.toString().trim() ?? '',
      );
    } catch (e) {
      throw StateError('无法获取播放地址: ${e.toString()}');
    }
  }

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {
    _cacheSongs(songs);
  }

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async {
    final existing = song['lyrics']?.toString().trim() ?? '';
    if (existing.isNotEmpty) return existing;

    final id = song['id']?.toString() ?? '';

    if (ChkszMusicClient.isChkszId(id)) {
      return chksz?.getLyrics(song) ?? '';
    }

    if (GdStudioMusicClient.isGdStudioId(id)) {
      final parsed = GdStudioMusicClient.parseSongId(id);
      if (parsed == null) return '';
      final (source, mediaId) = parsed;
      final lyricId = song['lyric_id']?.toString().trim().isNotEmpty == true
          ? song['lyric_id'].toString()
          : mediaId;
      try {
        return await gdStudio.getLyric(source: source, lyricId: lyricId);
      } catch (_) {
        return '';
      }
    }

    // For meting songs: direct metadata lyrics
    if (_isMetingId(id)) {
      final detail = _mergeCachedDetail(id, await metadata.getSongDetail(id));
      _cacheSongs([detail]);
      return detail['lyrics']?.toString().trim() ?? '';
    }

    // For Bilibili songs: prefer direct CC subtitles, then reverse metadata.
    final directLyrics = await playback.getLyrics(song).catchError((_) => '');
    if (directLyrics.trim().isNotEmpty) return directLyrics.trim();

    final quotedTitles = extractQuotedSongTitles(
      song['title']?.toString() ?? '',
    );
    if (quotedTitles.length > 1) {
      final collectionLyrics = await _collectionLyricsForTitles(
        song,
        quotedTitles,
      );
      if (collectionLyrics.trim().isNotEmpty) return collectionLyrics;
    }

    final playbackId = song['playbackId']?.toString() ?? id;
    if (playbackId.isEmpty) return '';
    _cacheSongs([song]);
    return _metadataLyricsForPlaybackSong(playbackId);
  }

  Future<String> _collectionLyricsForTitles(
    Map<String, dynamic> song,
    List<String> titles,
  ) async {
    final artist = song['artist']?.toString().trim() ?? '';
    final segments = <CollectionLyricSegment>[];

    for (final title in titles) {
      final candidates = await metadata
          .searchSongs(title)
          .catchError((_) => <Map<String, dynamic>>[]);
      final best =
          bestMetadataMatch({
            'title': title,
            'artist': artist,
            'duration': 0,
          }, candidates) ??
          candidates.cast<Map<String, dynamic>?>().firstWhere(
            (item) => item?['resultType']?.toString() != 'playlist',
            orElse: () => null,
          );

      final id = best?['id']?.toString() ?? '';
      if (id.isEmpty) {
        segments.add(CollectionLyricSegment(title: title, lyrics: ''));
        continue;
      }

      final detail = _mergeCachedDetail(id, await metadata.getSongDetail(id));
      _cacheSongs([detail]);
      segments.add(
        CollectionLyricSegment(
          title: title,
          lyrics: detail['lyrics']?.toString().trim() ?? '',
        ),
      );
    }

    return combineCollectionLyrics(
      segments,
      totalDuration: Duration(milliseconds: _duration(song)),
    );
  }

  /// Get metadata lyrics for a Bilibili song by reverse search
  Future<String> _metadataLyricsForPlaybackSong(String id) async {
    final cached = _songCache[id];
    final song =
        cached ??
        await playback
            .getSongDetail(id)
            .catchError((_) => <String, dynamic>{'id': id});
    final cachedLyrics = song['lyrics']?.toString().trim() ?? '';
    if (cachedLyrics.isNotEmpty) return cachedLyrics;

    // Search metadata using cleaned Bilibili title
    final candidates = await _searchMetadataForSong(song);
    final best = bestMetadataMatch(song, candidates);
    final metadataId = best?['id']?.toString() ?? '';
    if (metadataId.isEmpty) return '';

    final detail = _mergeCachedDetail(
      metadataId,
      await metadata.getSongDetail(metadataId),
    );
    _cacheSongs([detail]);
    return detail['lyrics']?.toString().trim() ?? '';
  }

  Future<List<Map<String, dynamic>>> _searchMetadataForSong(
    Map<String, dynamic> song,
  ) async {
    final titleCandidates = _metadataTitleCandidates(song['title']);
    final artist = song['artist']?.toString().trim() ?? '';
    final useArtist = !_isLikelyBilibiliSource(song);
    final queries = <String>{};

    for (final title in titleCandidates) {
      if (useArtist) {
        queries.add([artist, title].where((item) => item.isNotEmpty).join(' '));
      }
      queries.add(title);
    }

    final allResults = <Map<String, dynamic>>[];
    final seenIds = <String>{};

    for (final query in queries) {
      if (query.trim().isEmpty) continue;
      final results = await metadata
          .searchSongs(query)
          .catchError((_) => <Map<String, dynamic>>[]);
      for (final result in results) {
        final id = result['id']?.toString() ?? '';
        if (id.isEmpty || !seenIds.add(id)) continue;
        allResults.add(result);
      }
      final best = bestMetadataMatch(song, allResults);
      if (best != null) return allResults;
    }
    return allResults;
  }

  Future<String> _resolveBilibiliPlaybackId(Map<String, dynamic> song) async {
    final title = song['title']?.toString() ?? '';
    final artist = song['artist']?.toString() ?? '';
    final queries = [
      [artist, title].where((item) => item.trim().isNotEmpty).join(' '),
      title,
    ].where((query) => query.trim().isNotEmpty).toSet();

    for (final query in queries) {
      final candidates = await playback.searchSongs(query);
      final best = bestBilibiliMatch(song, candidates);
      final id = best?['id']?.toString() ?? '';
      if (id.isNotEmpty) return id;
    }
    throw StateError('未找到可播放的 B站版本');
  }

  String _canonicalBilibiliPlaybackId(String id) {
    if (!id.startsWith('bilibili:')) return id;
    final parts = id.split(':');
    if (parts.length < 2) return id;
    final pageText = parts.length > 2 ? parts[2] : '1';
    final page = int.tryParse(pageText.replaceFirst(RegExp(r'^[pP]'), '')) ?? 1;
    return 'bilibili:${parts[1]}:p${page < 1 ? 1 : page}';
  }

  static Map<String, dynamic>? bestMetadataMatch(
    Map<String, dynamic> target,
    List<Map<String, dynamic>> candidates,
  ) {
    var bestScore = -1;
    Map<String, dynamic>? best;
    for (final candidate in candidates) {
      if (candidate['resultType']?.toString() == 'playlist') continue;
      final score = _matchScore(target, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return bestScore <= 0 ? null : best;
  }

  static Map<String, dynamic>? bestBilibiliMatch(
    Map<String, dynamic> target,
    List<Map<String, dynamic>> candidates,
  ) {
    var bestScore = -1;
    Map<String, dynamic>? best;
    final targetTitle = target['title']?.toString() ?? '';
    for (final candidate in candidates) {
      if (candidate['resultType']?.toString() == 'playlist') continue;
      final candidateTitle = candidate['title']?.toString() ?? '';
      if (_isHardExcludedInstrumental(targetTitle, candidateTitle)) {
        continue;
      }
      final score = _matchScore(target, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return bestScore <= 0 ? null : best;
  }

  /// Hard-exclude off-vocal / instrumental candidates unless the target itself
  /// is an instrumental/pure-music work.
  static bool _isHardExcludedInstrumental(
    String targetTitle,
    String candidateTitle,
  ) {
    final targetHas = _containsAnyMarker(targetTitle, _hardInstrumentalMarkers);
    if (targetHas) return false;
    return _containsAnyMarker(candidateTitle, _hardInstrumentalMarkers);
  }

  static const List<String> _hardInstrumentalMarkers = [
    '伴奏',
    '纯音乐',
    '背景音乐',
    'bgm',
    'instrumental',
    'karaoke',
    'off vocal',
    'offvocal',
    '无人声',
    '消音',
  ];

  static const List<String> _softDowngradeMarkers = [
    'dance practice',
    '练习室',
    'live',
    '现场',
    '翻唱',
    'cover',
  ];

  static bool _containsAnyMarker(String text, List<String> markers) {
    final normalized = text.toLowerCase();
    for (final marker in markers) {
      if (normalized.contains(marker.toLowerCase())) return true;
    }
    return false;
  }

  static Map<String, dynamic> _withBilibiliPlaybackSource(
    Map<String, dynamic> song,
  ) {
    return {...song, 'playbackSource': 'bilibili', 'playbackSourceLabel': 'B站'};
  }

  static Map<String, dynamic> _withSourceLabel(Map<String, dynamic> item) {
    final sourceLabel = item['sourceLabel']?.toString().trim() ?? '';
    if (sourceLabel.isNotEmpty) return item;
    return {
      ...item,
      'sourceLabel': _sourceLabel(item['source']?.toString() ?? ''),
    };
  }

  void _cachePlaylistSongs(Map<String, dynamic> playlist) {
    final songs = playlist['songs'];
    if (songs is List) {
      _cacheSongs(
        songs.whereType<Map>().map((song) => song.cast<String, dynamic>()),
      );
    }
  }

  void _cacheSongs(Iterable<Map<String, dynamic>> songs) {
    for (final song in songs) {
      final id = song['id']?.toString() ?? '';
      if (id.isNotEmpty) _songCache[id] = song;
    }
  }

  /// Fill coverUrl for a GDStudio song if still missing (player bar).
  Future<void> _ensureGdStudioCover(String id) async {
    final cached = _songCache[id];
    if (cached == null) return;
    final existing = cached['coverUrl']?.toString().trim() ?? '';
    if (existing.isNotEmpty) return;

    final source = cached['gdstudioSource']?.toString().trim() ?? '';
    final picId = cached['pic_id']?.toString().trim() ?? '';
    if (source.isEmpty || picId.isEmpty) return;

    final hinted = GdStudioMusicClient.coverUrlHint(
      source: source,
      picId: picId,
    );
    if (hinted != null && hinted.isNotEmpty) {
      _songCache[id] = {...cached, 'coverUrl': hinted};
      return;
    }

    try {
      final url = await gdStudio.getPicUrl(
        source: source,
        picId: picId,
        size: 300,
      );
      if (url != null && url.isNotEmpty) {
        _songCache[id] = {...cached, 'coverUrl': url};
      }
    } catch (_) {}
  }

  Map<String, dynamic> _mergeCachedDetail(
    String id,
    Map<String, dynamic> detail,
  ) {
    final cached = _songCache[id];
    if (cached == null) return detail;
    return {
      ...detail,
      if (!_hasUsefulText(detail['title'], unknown: '未知歌曲'))
        'title': cached['title'],
      if (!_hasUsefulText(detail['artist'], unknown: '未知艺人'))
        'artist': cached['artist'],
      if (!_hasUsefulText(detail['album'])) 'album': cached['album'],
      if (!_hasUsefulText(detail['coverUrl'])) 'coverUrl': cached['coverUrl'],
      if (!_hasUsefulDuration(detail)) 'duration': cached['duration'],
      if (!_hasUsefulText(detail['playbackId']))
        'playbackId': cached['playbackId'],
      if (!_hasUsefulText(detail['lyrics'])) 'lyrics': cached['lyrics'],
      if (!_hasUsefulText(detail['sourceLabel']))
        'sourceLabel': cached['sourceLabel'],
      if (!_hasUsefulText(detail['playbackSourceLabel']))
        'playbackSourceLabel': cached['playbackSourceLabel'],
    };
  }

  static int _matchScore(
    Map<String, dynamic> target,
    Map<String, dynamic> candidate,
  ) {
    final targetTitle = _normalized(target['title']);
    final targetArtist = _normalized(target['artist']);
    final candidateTitle = _normalized(candidate['title']);
    final candidateArtist = _normalized(candidate['artist']);
    var score = 0;

    // Title matching
    if (targetTitle.isNotEmpty && candidateTitle.contains(targetTitle)) {
      score += 60;
    }
    if (targetTitle.isNotEmpty && targetTitle.contains(candidateTitle)) {
      score += 55;
    }

    // Artist matching
    if (targetArtist.isNotEmpty &&
        (candidateTitle.contains(targetArtist) ||
            candidateArtist.contains(targetArtist))) {
      score += 24;
    }

    // Duration matching
    final durationDelta = (_duration(target) - _duration(candidate)).abs();
    if (durationDelta <= 5000) {
      score += 20;
    } else if (durationDelta <= 45000) {
      score += 10;
    } else if (_duration(target) > 0 &&
        _duration(candidate) > _duration(target) * 2) {
      score -= 70;
    }

    // Soft-downgrade practice/live/cover; hard instrumental already filtered.
    if (RegExp(
      r'(合集|歌单|playlist)',
      caseSensitive: false,
    ).hasMatch(candidateTitle)) {
      score -= 18;
    }
    if (_containsAnyMarker(candidateTitle, _softDowngradeMarkers)) {
      score -= 18;
    }
    return score;
  }

  static bool _isMetingId(String id) => id.startsWith('meting:');

  static bool _isMetingCollectionId(String id) =>
      id.startsWith('meting-artist:') || id.startsWith('meting-playlist:');

  static bool _isLikelyBilibiliSource(Map<String, dynamic> song) {
    final id = song['id']?.toString() ?? '';
    final source = song['source']?.toString() ?? '';
    return id.startsWith('bilibili:') || source.contains('bilibili');
  }

  static bool _looksLikePlaylistQuery(String query) {
    final normalized = _normalized(query);
    return normalized.contains('歌单') ||
        normalized.contains('合集') ||
        normalized.contains('playlist');
  }

  static String _sourceLabel(String source) {
    if (source.contains('tencent') || source.contains('qqmusic')) {
      return '腾讯音乐';
    }
    if (source.contains('kugou')) return '酷狗音乐';
    if (source.contains('bilibili')) return 'B站';
    return source.isEmpty ? '' : source;
  }

  static bool _hasUsefulText(Object? value, {String unknown = ''}) {
    final text = value?.toString().trim() ?? '';
    return text.isNotEmpty && (unknown.isEmpty || text != unknown);
  }

  static bool _hasUsefulDuration(Map<String, dynamic> song) {
    final duration = _duration(song);
    return duration > 0 && duration < const Duration(hours: 12).inMilliseconds;
  }

  static String _cleanSearchTitle(Object? value) {
    return value
            ?.toString()
            .replaceAll(RegExp(r'<[^>]+>'), '')
            .replaceAll(RegExp(r'【[^】]*】'), ' ')
            .replaceAll(RegExp(r'\[[^\]]*\]'), ' ')
            .replaceAll(RegExp(r'〈[^〉]*〉'), ' ')
            .replaceAll(RegExp(r'「[^」]*」'), ' ')
            .replaceAll(RegExp(r'『[^』]*』'), ' ')
            .replaceAll(RegExp(r'\([^)]*\)'), ' ')
            .replaceAll(RegExp(r'（[^）]*）'), ' ')
            .replaceAll(RegExp(r'\{[^}]*\}'), ' ')
            .replaceAll(
              RegExp(
                r'(官方|完整版|歌词版?|高音质|无损音质|高品质|HQ|HiFi|Hi-Res|'
                r'现场版?|live|mv|cover|翻唱|伴奏|remix|重制|混音|'
                r'纯音乐|背景音乐|BGM|bgm|'
                r'单人|独奏|乐器|钢琴|吉他|古筝|二胡|小提琴|'
                r'循环|单曲循环|合集|歌单|精选|串烧|盘点|'
                r'超清|高清|4k|8k|60fps|60帧|画质|修复|收藏级|'
                r'我是歌手|中国好声音|歌手|蒙面唱将|'
                r'动态歌词|滚动歌词|歌词版?|字幕|CC字幕|'
                r'竖屏|横屏|可视化|'
                r'推荐|热门|新歌|经典|怀旧|伤感|治愈|'
                r'车载|驾驶|跑步|运动|学习|工作|'
                r'好听|循环播放|单曲|神曲|'
                r'片段|节选|精华|完整|全长)',
                caseSensitive: false,
              ),
              ' ',
            )
            .replaceAll(RegExp(r'[・·•]'), ' ')
            .replaceAll(RegExp(r'[｜|/\\]+'), ' ')
            .replaceAll(RegExp(r'\s*[-—–]+\s*'), ' ')
            .replaceAll(RegExp(r'\s+'), ' ')
            .trim() ??
        '';
  }

  static List<String> _metadataTitleCandidates(Object? value) {
    final raw = value?.toString() ?? '';
    final candidates = <String>[];

    void add(String item) {
      final cleaned = _cleanSearchTitle(item);
      final normalized = _normalized(cleaned);
      if (normalized.isEmpty || normalized.length < 2) return;
      if (RegExp(
        r'^(gem|邓紫棋|周杰伦|林俊杰|张杰|周深)$',
        caseSensitive: false,
      ).hasMatch(cleaned.trim())) {
        return;
      }
      if (!candidates.any((existing) => _normalized(existing) == normalized)) {
        candidates.add(cleaned);
      }
    }

    // Split by various delimiters
    for (final part in raw.split(RegExp(r'[｜|/\\]+'))) {
      add(part);
    }
    for (final part in raw.split(RegExp(r'\s+-\s+|\s+—\s+|\s+_\s+'))) {
      add(part);
    }
    add(raw);

    candidates.sort(
      (a, b) => _normalized(a).length.compareTo(_normalized(b).length),
    );
    return candidates;
  }

  static String _normalized(Object? value) {
    return value
            ?.toString()
            .toLowerCase()
            .replaceAll(RegExp(r'\s+'), '')
            .replaceAll(RegExp(r'[^一-龥a-z0-9]'), '') ??
        '';
  }

  static int _duration(Map<String, dynamic> song) {
    final value = song['duration'];
    if (value is int) return value;
    if (value is num) return value.round();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}
