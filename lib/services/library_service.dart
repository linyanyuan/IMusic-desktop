import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import '../core/models/song.dart';
import '../core/song_identity.dart';

typedef PlaybackMetadataResolver =
    Future<Map<String, dynamic>> Function(Song song);

class LibraryMutationCancelled implements Exception {
  const LibraryMutationCancelled([this.message = 'Library mutation cancelled']);

  final String message;

  @override
  String toString() => 'LibraryMutationCancelled: $message';
}

/// Library service matching mobile API
class LibraryService {
  final Dio _dio;
  static const _baseUrl = 'http://60.205.218.90:8787/api';

  LibraryService({Dio? dio})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: _baseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 10),
            ),
          );

  /// Get user's library (liked songs, playlists, theme mode)
  /// Matches mobile: GET /library → {library: {likedSongs, userPlaylists, themeMode}}
  Future<RemoteLibrary> getLibrary(String token) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/library',
      options: Options(headers: {'Authorization': 'Bearer $token'}),
    );
    final json = response.data ?? {};
    return RemoteLibrary.fromJson(_mapValue(json['library']) ?? {});
  }

  /// Save user's library (liked songs, playlists, theme mode)
  /// Matches mobile: PUT /library with body {likedSongs, userPlaylists, themeMode}
  Future<RemoteLibrary> saveLibrary(
    String token, {
    required List<Map<String, dynamic>> likedSongs,
    required List<Map<String, dynamic>> userPlaylists,
    String themeMode = 'dark',
  }) async {
    final response = await _dio.put<Map<String, dynamic>>(
      '/library',
      data: {
        'likedSongs': likedSongs,
        'userPlaylists': userPlaylists,
        'themeMode': themeMode,
      },
      options: Options(headers: {'Authorization': 'Bearer $token'}),
    );
    final json = response.data ?? {};
    return RemoteLibrary.fromJson(_mapValue(json['library']) ?? {});
  }

  Map<String, dynamic>? _mapValue(Object? value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return value.cast<String, dynamic>();
    return null;
  }
}

/// Remote library response matching mobile API
class RemoteLibrary {
  final List<Map<String, dynamic>> likedSongs;
  final List<Map<String, dynamic>> userPlaylists;
  final String themeMode;

  const RemoteLibrary({
    required this.likedSongs,
    required this.userPlaylists,
    required this.themeMode,
  });

  factory RemoteLibrary.fromJson(Map<String, dynamic> json) {
    return RemoteLibrary(
      likedSongs: _listOfMaps(json['likedSongs']),
      userPlaylists: _listOfMaps(json['userPlaylists']),
      themeMode: json['themeMode']?.toString() ?? 'dark',
    );
  }

  static List<Map<String, dynamic>> _listOfMaps(Object? value) {
    if (value is! List) return const [];
    return value
        .whereType<Map>()
        .map((item) => item.cast<String, dynamic>())
        .toList();
  }
}

/// Library state
class LibraryState {
  final List<Song> likedSongs;
  final List<Song> playHistory; // Local-only, not synced with server
  final List<Map<String, dynamic>>
  userPlaylists; // User's collected and created playlists
  final String themeMode;
  final bool isLoading;

  LibraryState({
    this.likedSongs = const [],
    this.playHistory = const [],
    this.userPlaylists = const [],
    this.themeMode = 'light',
    this.isLoading = false,
  });

  LibraryState copyWith({
    List<Song>? likedSongs,
    List<Song>? playHistory,
    List<Map<String, dynamic>>? userPlaylists,
    String? themeMode,
    bool? isLoading,
  }) {
    return LibraryState(
      likedSongs: likedSongs ?? this.likedSongs,
      playHistory: playHistory ?? this.playHistory,
      userPlaylists: userPlaylists ?? this.userPlaylists,
      themeMode: themeMode ?? this.themeMode,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

class LibraryNotifier extends StateNotifier<LibraryState> {
  final LibraryService _libraryService;
  final SharedPreferences _prefs;
  final PlaybackMetadataResolver? _playbackResolver;
  static const _historyKey = 'play_history';
  RemoteLibrary _committedLibrary = const RemoteLibrary(
    likedSongs: [],
    userPlaylists: [],
    themeMode: 'light',
  );
  Future<void> _mutationTail = Future<void>.value();
  int _libraryGeneration = 0;
  int _nextOperationId = 0;
  final Map<String, int> _entityOwners = {};
  final Map<String, Future<void>> _likeMutationTails = {};

  LibraryNotifier(
    this._libraryService,
    Ref ref,
    this._prefs, {
    PlaybackMetadataResolver? playbackResolver,
  }) : _playbackResolver = playbackResolver,
       super(LibraryState()) {
    _loadStoredHistory();
  }

  /// Load play history from SharedPreferences on startup
  Future<void> _loadStoredHistory() async {
    final historyJson = _prefs.getStringList(_historyKey) ?? [];
    final songs = historyJson
        .map((jsonStr) {
          try {
            final json = jsonDecode(jsonStr) as Map<String, dynamic>;
            return Song.fromJson(json);
          } catch (_) {
            return null;
          }
        })
        .whereType<Song>()
        .toList();
    state = state.copyWith(playHistory: songs);
  }

  /// Save history to SharedPreferences
  Future<void> _saveHistory() async {
    final historyJson = state.playHistory
        .map((s) => jsonEncode(s.toJson()))
        .toList();
    await _prefs.setStringList(_historyKey, historyJson);
  }

  /// Load the account library from the server.
  Future<void> loadLibrary(String token) async {
    final generation = _libraryGeneration;
    final mutationMarker = _nextOperationId;
    final hadPendingMutation = _entityOwners.isNotEmpty;
    state = state.copyWith(isLoading: true);
    try {
      final library = await _libraryService.getLibrary(token);
      if (generation != _libraryGeneration) return;
      if (hadPendingMutation ||
          mutationMarker != _nextOperationId ||
          _entityOwners.isNotEmpty) {
        state = state.copyWith(isLoading: false);
        return;
      }
      _applyRemoteLibrary(library, isLoading: false);
    } catch (e) {
      if (generation != _libraryGeneration) return;
      state = state.copyWith(isLoading: false);
      rethrow;
    }
  }

  /// Load liked songs from server.
  Future<void> loadLikedSongs(String token) async {
    await loadLibrary(token);
  }

  /// Load play history (local-only, from SharedPreferences)
  Future<void> loadPlayHistory(String token) async {
    // History is already loaded in _loadStoredHistory
    // Just set loading to false
    state = state.copyWith(isLoading: false);
  }

  /// Load library from login response.
  void setLibraryFromLogin(RemoteLibrary library) {
    _applyRemoteLibrary(library, isLoading: false);
  }

  void clearAccountLibrary() {
    _startLibraryGeneration();
    state = state.copyWith(likedSongs: const [], userPlaylists: const []);
    _committedLibrary = RemoteLibrary(
      likedSongs: const [],
      userPlaylists: const [],
      themeMode: state.themeMode,
    );
  }

  void _applyRemoteLibrary(RemoteLibrary library, {bool? isLoading}) {
    _startLibraryGeneration();
    final likedSongs = library.likedSongs
        .map((song) => _withMobilePlaybackFields(song))
        .toList();
    final songs = likedSongs.map((s) => Song.fromJson(s)).toList();
    // Normalize name/title (and description/subtitle) so sidebar and detail agree.
    final playlists = library.userPlaylists
        .map(_withLibraryPlaylistFields)
        .toList();
    _committedLibrary = RemoteLibrary(
      likedSongs: likedSongs,
      userPlaylists: playlists,
      themeMode: library.themeMode,
    );
    state = state.copyWith(
      likedSongs: songs,
      userPlaylists: playlists,
      themeMode: library.themeMode,
      isLoading: isLoading,
    );
  }

  void _startLibraryGeneration() {
    _libraryGeneration++;
    _mutationTail = Future<void>.value();
    _entityOwners.clear();
    _likeMutationTails.clear();
  }

  Future<void> _enqueueRemoteMutation(
    String token,
    RemoteLibrary Function(RemoteLibrary committed) buildCandidate,
  ) {
    final generation = _libraryGeneration;
    final operation = _mutationTail.then((_) async {
      if (generation != _libraryGeneration) {
        throw const LibraryMutationCancelled('Account library changed');
      }
      final candidate = buildCandidate(_committedLibrary);
      await _libraryService.saveLibrary(
        token,
        likedSongs: candidate.likedSongs,
        userPlaylists: candidate.userPlaylists,
        themeMode: candidate.themeMode,
      );
      if (generation != _libraryGeneration) {
        throw const LibraryMutationCancelled('Account library changed');
      }
      _committedLibrary = candidate;
    });
    _mutationTail = operation.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    return operation;
  }

  RemoteLibrary _candidateLibrary(
    RemoteLibrary committed, {
    List<Map<String, dynamic>>? likedSongs,
    List<Map<String, dynamic>>? userPlaylists,
  }) {
    return RemoteLibrary(
      likedSongs: likedSongs ?? committed.likedSongs,
      userPlaylists: userPlaylists ?? committed.userPlaylists,
      themeMode: committed.themeMode,
    );
  }

  int _claimEntities(Iterable<String> keys) {
    final operationId = ++_nextOperationId;
    for (final key in keys) {
      _entityOwners[key] = operationId;
    }
    return operationId;
  }

  bool _ownsEntity(String key, int operationId) {
    return _entityOwners[key] == operationId;
  }

  void _releaseEntity(String key, int operationId) {
    if (_ownsEntity(key, operationId)) _entityOwners.remove(key);
  }

  /// Toggle like status for a song
  /// Saves the updated library to the server via PUT /library
  Future<void> toggleLike(String token, Song song) {
    final identities = songIdentityValues(song.toJson());
    if (identities.isEmpty) {
      return Future<void>.error(
        ArgumentError.value(song.id, 'song.id', 'Song identity is required'),
      );
    }
    final generation = _libraryGeneration;
    final entityKey = 'like:${identities.first}';
    final previous = _likeMutationTails[entityKey] ?? Future<void>.value();
    final recoveredPrevious = previous.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    late final Future<void> operation;
    operation = recoveredPrevious
        .then((_) => _toggleLikeNow(token, song, entityKey, generation))
        .then<void>(
          (_) {
            if (identical(_likeMutationTails[entityKey], operation)) {
              _likeMutationTails.remove(entityKey);
            }
          },
          onError: (Object error, StackTrace stackTrace) {
            if (identical(_likeMutationTails[entityKey], operation)) {
              _likeMutationTails.remove(entityKey);
            }
            Error.throwWithStackTrace(error, stackTrace);
          },
        );
    _likeMutationTails[entityKey] = operation;
    return operation;
  }

  Future<void> _toggleLikeNow(
    String token,
    Song song,
    String entityKey,
    int generation,
  ) async {
    if (generation != _libraryGeneration) {
      throw const LibraryMutationCancelled('Account library changed');
    }
    final rawSong = song.toJson();
    final isLiked = state.likedSongs.any(
      (item) => songsShareIdentity(item.toJson(), rawSong),
    );
    final removedSong = isLiked
        ? state.likedSongs.firstWhere(
            (item) => songsShareIdentity(item.toJson(), rawSong),
          )
        : null;
    final operationId = _claimEntities([entityKey]);
    final resolved = isLiked ? song : await _resolvePlaybackMetadata(song);
    if (generation != _libraryGeneration) {
      _releaseEntity(entityKey, operationId);
      throw const LibraryMutationCancelled('Account library changed');
    }
    final resolvedMap = resolved.toJson();

    if (isLiked) {
      state = state.copyWith(
        likedSongs: state.likedSongs
            .where((item) => !songsShareIdentity(item.toJson(), rawSong))
            .toList(),
      );
    } else {
      state = state.copyWith(
        likedSongs: [
          ...state.likedSongs.where(
            (item) => !songsShareIdentity(item.toJson(), resolvedMap),
          ),
          resolved.copyWith(isFavorite: true),
        ],
      );
    }

    try {
      await _enqueueRemoteMutation(
        token,
        (committed) => _candidateLibrary(
          committed,
          likedSongs: isLiked
              ? committed.likedSongs
                    .where((item) => !songsShareIdentity(item, rawSong))
                    .toList()
              : [
                  ...committed.likedSongs.where(
                    (item) => !songsShareIdentity(item, resolvedMap),
                  ),
                  resolved.copyWith(isFavorite: true).toJson(),
                ],
        ),
      );
    } catch (_) {
      if (_ownsEntity(entityKey, operationId)) {
        state = state.copyWith(
          likedSongs: isLiked
              ? [
                  ...state.likedSongs,
                  if (removedSong != null &&
                      !state.likedSongs.any(
                        (item) => songsShareIdentity(
                          item.toJson(),
                          removedSong.toJson(),
                        ),
                      ))
                    removedSong,
                ]
              : state.likedSongs
                    .where(
                      (item) => !songsShareIdentity(item.toJson(), resolvedMap),
                    )
                    .toList(),
        );
      }
      rethrow;
    } finally {
      _releaseEntity(entityKey, operationId);
    }
  }

  /// Add song to play history (local-only, persisted to SharedPreferences)
  Future<void> addToHistory(Song song) async {
    final newHistory = [
      song,
      ...state.playHistory.where((s) => s.id != song.id),
    ];
    if (newHistory.length > 50) {
      newHistory.removeRange(50, newHistory.length);
    }
    state = state.copyWith(playHistory: newHistory);
    await _saveHistory();
  }

  /// Update stored song metadata after async playback data, such as lyrics, arrives.
  Future<void> updateStoredSong(Map<String, dynamic> song) async {
    final id = song['id']?.toString() ?? '';
    if (id.isEmpty) return;

    Song merge(Song existing) {
      return Song.fromJson({...existing.toJson(), ...song});
    }

    final likedSongs = state.likedSongs
        .map((existing) => existing.id == id ? merge(existing) : existing)
        .toList();
    final playHistory = state.playHistory
        .map((existing) => existing.id == id ? merge(existing) : existing)
        .toList();

    state = state.copyWith(likedSongs: likedSongs, playHistory: playHistory);
    await _saveHistory();
  }

  /// Clear play history (local-only)
  Future<void> clearHistory() async {
    state = state.copyWith(playHistory: []);
    await _prefs.remove(_historyKey);
  }

  /// Create a new playlist
  Future<void> createPlaylist(
    String token,
    String name,
    String? description,
  ) async {
    final newPlaylist = {
      'id': DateTime.now().millisecondsSinceEpoch.toString(),
      'name': name,
      'title': name,
      'description': description ?? '',
      'subtitle': description ?? '0 首',
      'songs': <Map<String, dynamic>>[],
      'createdAt': DateTime.now().toIso8601String(),
      'isCollected': false, // User created
    };

    final entityKey = 'playlist:${newPlaylist['id']}';
    final operationId = _claimEntities([entityKey]);
    final updatedPlaylists = [...state.userPlaylists, newPlaylist];
    state = state.copyWith(userPlaylists: updatedPlaylists);

    try {
      await _enqueueRemoteMutation(
        token,
        (committed) => _candidateLibrary(
          committed,
          userPlaylists: [...committed.userPlaylists, newPlaylist],
        ),
      );
    } catch (_) {
      if (_ownsEntity(entityKey, operationId)) {
        state = state.copyWith(
          userPlaylists: state.userPlaylists
              .where((p) => p['id'] != newPlaylist['id'])
              .toList(),
        );
      }
      rethrow;
    } finally {
      _releaseEntity(entityKey, operationId);
    }
  }

  /// Collect a playlist (add to user's library)
  Future<void> collectPlaylist(
    String token,
    Map<String, dynamic> playlist,
  ) async {
    final id = playlist['id']?.toString() ?? '';
    if (id.isEmpty) return;
    final exists = state.userPlaylists.any((p) => p['id']?.toString() == id);
    final originalIndex = state.userPlaylists.indexWhere(
      (item) => item['id']?.toString() == id,
    );
    final original = originalIndex >= 0
        ? state.userPlaylists[originalIndex]
        : null;
    final entityKey = 'playlist:$id';
    final operationId = _claimEntities([entityKey]);

    if (exists) {
      final updatedPlaylists = state.userPlaylists
          .where((p) => p['id']?.toString() != id)
          .toList();
      state = state.copyWith(userPlaylists: updatedPlaylists);
      try {
        await _enqueueRemoteMutation(
          token,
          (committed) => _candidateLibrary(
            committed,
            userPlaylists: committed.userPlaylists
                .where((item) => item['id']?.toString() != id)
                .toList(),
          ),
        );
      } catch (_) {
        if (_ownsEntity(entityKey, operationId) && original != null) {
          final restored = [...state.userPlaylists];
          restored.insert(
            originalIndex < restored.length ? originalIndex : restored.length,
            original,
          );
          state = state.copyWith(userPlaylists: restored);
        }
        rethrow;
      } finally {
        _releaseEntity(entityKey, operationId);
      }
      return;
    }

    final collectedPlaylist = {
      ..._withLibraryPlaylistFields(playlist),
      'isCollected': true,
      'collectedAt': DateTime.now().toIso8601String(),
    };

    final updatedPlaylists = [
      ...state.userPlaylists.where((p) => p['id']?.toString() != id),
      collectedPlaylist,
    ];
    state = state.copyWith(userPlaylists: updatedPlaylists);

    try {
      await _enqueueRemoteMutation(
        token,
        (committed) => _candidateLibrary(
          committed,
          userPlaylists: [
            ...committed.userPlaylists.where(
              (item) => item['id']?.toString() != id,
            ),
            collectedPlaylist,
          ],
        ),
      );
    } catch (_) {
      if (_ownsEntity(entityKey, operationId)) {
        state = state.copyWith(
          userPlaylists: state.userPlaylists
              .where((p) => p['id'] != collectedPlaylist['id'])
              .toList(),
        );
      }
      rethrow;
    } finally {
      _releaseEntity(entityKey, operationId);
    }
  }

  /// Add song to a specific playlist
  Future<void> addSongToPlaylist(
    String token,
    String playlistId,
    Song song,
  ) async {
    final rawSong = song.toJson();
    var inserted = false;
    final optimisticPlaylists = state.userPlaylists.map((playlist) {
      if (playlist['id']?.toString() == playlistId) {
        final songs = List<Map<String, dynamic>>.from(playlist['songs'] ?? []);
        if (!songs.any((item) => songsShareIdentity(item, rawSong))) {
          songs.add(rawSong);
          inserted = true;
        }
        return {...playlist, 'songs': songs, 'songCount': songs.length};
      }
      return playlist;
    }).toList();
    if (!inserted) return;

    final parentEntityKey = 'playlist:$playlistId';
    final entityKeys = <String>{'playlist-song:$playlistId:${song.id}'};
    final operationId = _claimEntities(entityKeys);
    state = state.copyWith(userPlaylists: optimisticPlaylists);

    final resolvedSong = await _resolvePlaybackMetadata(song);
    final resolvedMap = resolvedSong.toJson();
    final resolvedEntityKey = 'playlist-song:$playlistId:${resolvedSong.id}';
    entityKeys.add(resolvedEntityKey);
    _entityOwners[resolvedEntityKey] = operationId;
    final stillPresent = state.userPlaylists.any((playlist) {
      if (playlist['id']?.toString() != playlistId) return false;
      final songs = List<Map<String, dynamic>>.from(playlist['songs'] ?? []);
      return songs.any((item) => identical(item, rawSong));
    });
    if (!stillPresent) {
      for (final key in entityKeys) {
        _releaseEntity(key, operationId);
      }
      throw const LibraryMutationCancelled('Song add was cancelled');
    }
    entityKeys.add(parentEntityKey);
    _entityOwners[parentEntityKey] = operationId;

    final updatedPlaylists = state.userPlaylists.map((playlist) {
      if (playlist['id']?.toString() != playlistId) return playlist;
      final songs = List<Map<String, dynamic>>.from(
        playlist['songs'] ?? [],
      ).map((item) => identical(item, rawSong) ? resolvedMap : item).toList();
      return {...playlist, 'songs': songs, 'songCount': songs.length};
    }).toList();

    state = state.copyWith(userPlaylists: updatedPlaylists);

    try {
      await _enqueueRemoteMutation(token, (committed) {
        var foundPlaylist = false;
        final userPlaylists = committed.userPlaylists.map((playlist) {
          if (playlist['id']?.toString() != playlistId) return playlist;
          foundPlaylist = true;
          final songs = List<Map<String, dynamic>>.from(
            playlist['songs'] ?? [],
          );
          if (!songs.any((item) => songsShareIdentity(item, resolvedMap))) {
            songs.add(resolvedMap);
          }
          return {...playlist, 'songs': songs, 'songCount': songs.length};
        }).toList();
        if (!foundPlaylist) {
          throw StateError('Playlist no longer exists');
        }
        return _candidateLibrary(committed, userPlaylists: userPlaylists);
      });
    } catch (_) {
      state = state.copyWith(
        userPlaylists: state.userPlaylists.map((playlist) {
          if (playlist['id']?.toString() != playlistId) return playlist;
          final songs = List<Map<String, dynamic>>.from(
            playlist['songs'] ?? [],
          ).where((item) => !identical(item, resolvedMap)).toList();
          return {...playlist, 'songs': songs, 'songCount': songs.length};
        }).toList(),
      );
      if (_ownsEntity(parentEntityKey, operationId) &&
          !_committedLibrary.userPlaylists.any(
            (playlist) => playlist['id']?.toString() == playlistId,
          )) {
        state = state.copyWith(
          userPlaylists: state.userPlaylists
              .where((playlist) => playlist['id']?.toString() != playlistId)
              .toList(),
        );
      }
      rethrow;
    } finally {
      for (final key in entityKeys) {
        _releaseEntity(key, operationId);
      }
    }
  }

  Future<void> removeSongsFromPlaylist(
    String token,
    String playlistId,
    Set<String> songIds,
  ) async {
    if (songIds.isEmpty) return;
    final removedSongs = <({int index, Map<String, dynamic> song})>[];
    for (final playlist in state.userPlaylists) {
      if (playlist['id']?.toString() != playlistId) continue;
      final songs = List<Map<String, dynamic>>.from(playlist['songs'] ?? []);
      for (var index = 0; index < songs.length; index++) {
        final song = songs[index];
        if (songIds.contains(song['id']?.toString() ?? '')) {
          removedSongs.add((index: index, song: song));
        }
      }
    }
    if (removedSongs.isEmpty) return;
    final entityKeys = songIds
        .map((id) => 'playlist-song:$playlistId:$id')
        .toList();
    final operationId = _claimEntities(entityKeys);
    final updatedPlaylists = state.userPlaylists.map((playlist) {
      if (playlist['id']?.toString() != playlistId) return playlist;
      final songs = List<Map<String, dynamic>>.from(playlist['songs'] ?? [])
          .where((song) => !songIds.contains(song['id']?.toString() ?? ''))
          .toList();
      return {...playlist, 'songs': songs, 'songCount': songs.length};
    }).toList();

    state = state.copyWith(userPlaylists: updatedPlaylists);

    try {
      await _enqueueRemoteMutation(
        token,
        (committed) => _candidateLibrary(
          committed,
          userPlaylists: committed.userPlaylists.map((playlist) {
            if (playlist['id']?.toString() != playlistId) return playlist;
            final songs =
                List<Map<String, dynamic>>.from(playlist['songs'] ?? [])
                    .where(
                      (song) => !songIds.contains(song['id']?.toString() ?? ''),
                    )
                    .toList();
            return {...playlist, 'songs': songs, 'songCount': songs.length};
          }).toList(),
        ),
      );
    } catch (_) {
      state = state.copyWith(
        userPlaylists: state.userPlaylists.map((playlist) {
          if (playlist['id']?.toString() != playlistId) return playlist;
          final songs = List<Map<String, dynamic>>.from(
            playlist['songs'] ?? [],
          );
          for (final removed in removedSongs) {
            final id = removed.song['id']?.toString() ?? '';
            final key = 'playlist-song:$playlistId:$id';
            if (_ownsEntity(key, operationId) &&
                !songs.any((song) => song['id']?.toString() == id)) {
              songs.insert(
                removed.index < songs.length ? removed.index : songs.length,
                removed.song,
              );
            }
          }
          return {...playlist, 'songs': songs, 'songCount': songs.length};
        }).toList(),
      );
      rethrow;
    } finally {
      for (final key in entityKeys) {
        _releaseEntity(key, operationId);
      }
    }
  }

  Future<void> deletePlaylist(String token, String playlistId) async {
    if (playlistId.isEmpty) return;
    final originalIndex = state.userPlaylists.indexWhere(
      (playlist) => playlist['id']?.toString() == playlistId,
    );
    if (originalIndex < 0) return;
    final deletedPlaylist = state.userPlaylists[originalIndex];
    final entityKey = 'playlist:$playlistId';
    final operationId = _claimEntities([entityKey]);
    final updatedPlaylists = state.userPlaylists
        .where((playlist) => playlist['id']?.toString() != playlistId)
        .toList();

    state = state.copyWith(userPlaylists: updatedPlaylists);

    try {
      await _enqueueRemoteMutation(
        token,
        (committed) => _candidateLibrary(
          committed,
          userPlaylists: committed.userPlaylists
              .where((playlist) => playlist['id']?.toString() != playlistId)
              .toList(),
        ),
      );
    } catch (_) {
      if (_ownsEntity(entityKey, operationId) &&
          !state.userPlaylists.any(
            (playlist) => playlist['id']?.toString() == playlistId,
          )) {
        final restored = [...state.userPlaylists];
        restored.insert(
          originalIndex < restored.length ? originalIndex : restored.length,
          deletedPlaylist,
        );
        state = state.copyWith(userPlaylists: restored);
      }
      rethrow;
    } finally {
      _releaseEntity(entityKey, operationId);
    }
  }

  Future<Song> _resolvePlaybackMetadata(Song song) async {
    if (_hasStablePlaybackId(song)) {
      return Song.fromJson(_withMobilePlaybackFields(song.toJson()));
    }
    final resolver = _playbackResolver;
    if (resolver == null) {
      return Song.fromJson(_withMobilePlaybackFields(song.toJson()));
    }

    try {
      return Song.fromJson(_withMobilePlaybackFields(await resolver(song)));
    } catch (_) {
      return Song.fromJson(_withMobilePlaybackFields(song.toJson()));
    }
  }

  bool _hasStablePlaybackId(Song song) {
    final playbackId = song.toJson()['playbackId']?.toString().trim() ?? '';
    return playbackId.startsWith('bilibili:');
  }

  Map<String, dynamic> _withMobilePlaybackFields(Map<String, dynamic> song) {
    final id = song['id']?.toString().trim() ?? '';
    final existingPlaybackId = song['playbackId']?.toString().trim() ?? '';
    final source = song['source']?.toString().toLowerCase() ?? '';
    final isBilibili =
        id.startsWith('bilibili:') ||
        existingPlaybackId.startsWith('bilibili:') ||
        source.contains('bilibili');
    if (!isBilibili) return song;

    final playbackId = _canonicalBilibiliPlaybackId(
      existingPlaybackId.isNotEmpty ? existingPlaybackId : id,
      fallbackPage: song['page'],
    );
    final bvid = _bvidFromPlaybackId(playbackId);
    final page = _pageFromPlaybackId(playbackId);
    final shouldNormalizeId = id.startsWith('bilibili:');
    return {
      ...song,
      if (shouldNormalizeId) 'id': playbackId,
      'playbackId': playbackId,
      'playbackSource': 'bilibili',
      'playbackSourceLabel': 'B站',
      'playbackSourceId': playbackId,
      'sourceId': playbackId,
      if (bvid.isNotEmpty) 'bvid': bvid,
      'page': ?page,
      if (bvid.isNotEmpty && page != null)
        'pageUrl': 'https://www.bilibili.com/video/$bvid?p=$page',
    };
  }

  String _bvidFromPlaybackId(String playbackId) {
    if (!playbackId.startsWith('bilibili:')) return '';
    final parts = playbackId.split(':');
    return parts.length >= 2 ? parts[1] : '';
  }

  Map<String, dynamic> _withMobilePlaylistFields(
    Map<String, dynamic> playlist,
  ) {
    final songs = playlist['songs'];
    if (songs is! List) return playlist;
    return {
      ...playlist,
      'songs': songs
          .whereType<Map>()
          .map(
            (song) => _withMobilePlaybackFields(song.cast<String, dynamic>()),
          )
          .toList(),
    };
  }

  Map<String, dynamic> _withLibraryPlaylistFields(
    Map<String, dynamic> playlist,
  ) {
    final withSongs = _withMobilePlaylistFields(playlist);
    final title = _firstText(withSongs['title'], withSongs['name']);
    final subtitle = _firstText(
      withSongs['subtitle'],
      withSongs['description'],
    );
    return {
      ...withSongs,
      if (title.isNotEmpty) ...{'title': title, 'name': title},
      if (subtitle.isNotEmpty) ...{
        'subtitle': subtitle,
        'description': subtitle,
      },
    };
  }

  String _canonicalBilibiliPlaybackId(Object? value, {Object? fallbackPage}) {
    final text = value?.toString().trim() ?? '';
    if (!text.startsWith('bilibili:')) return text;
    final parts = text.split(':');
    if (parts.length < 2) return text;
    final bvid = parts[1];
    final page = parts.length >= 3
        ? _parseBilibiliPage(parts[2])
        : _parseBilibiliPage(fallbackPage);
    return 'bilibili:$bvid:p$page';
  }

  int? _pageFromPlaybackId(String playbackId) {
    if (!playbackId.startsWith('bilibili:')) return null;
    final parts = playbackId.split(':');
    if (parts.length < 3) return 1;
    return _parseBilibiliPage(parts[2]);
  }

  int _parseBilibiliPage(Object? value) {
    final text = value?.toString().trim() ?? '';
    final page = int.tryParse(text.replaceFirst(RegExp(r'^[pP]'), '')) ?? 1;
    return page < 1 ? 1 : page;
  }

  String _firstText(Object? first, Object? second) {
    final firstText = first?.toString().trim() ?? '';
    if (firstText.isNotEmpty) return firstText;
    return second?.toString().trim() ?? '';
  }
}

final libraryServiceProvider = Provider<LibraryService>(
  (ref) => LibraryService(),
);

final libraryProvider = StateNotifierProvider<LibraryNotifier, LibraryState>((
  ref,
) {
  throw UnimplementedError('Must be overridden with SharedPreferences');
});
