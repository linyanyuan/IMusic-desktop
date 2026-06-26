import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:deepvibe_desktop/core/models/song.dart';
import 'package:deepvibe_desktop/services/library_service.dart';

void main() {
  test(
    'toggleLike preserves existing user playlists in the save payload',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final service = _RecordingLibraryService();
      final container = ProviderContainer(
        overrides: [
          libraryProvider.overrideWith(
            (ref) => LibraryNotifier(service, ref, prefs),
          ),
        ],
      );
      addTearDown(container.dispose);

      final existingPlaylist = {
        'id': 'playlist-1',
        'name': '我的歌单',
        'songs': <Map<String, dynamic>>[],
      };
      container
          .read(libraryProvider.notifier)
          .setLibraryFromLogin(
            RemoteLibrary(
              likedSongs: const [],
              userPlaylists: [existingPlaylist],
              themeMode: 'light',
            ),
          );

      await container
          .read(libraryProvider.notifier)
          .toggleLike(
            'token',
            Song(
              id: 'song-1',
              title: '歌',
              artist: '手',
              source: 'test',
              duration: '3:00',
            ),
          );

      expect(service.lastUserPlaylists, [existingPlaylist]);
    },
  );

  test('clearAccountLibrary removes user-owned remote library data', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(_RecordingLibraryService(), ref, prefs),
        ),
      ],
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: [
              Song(
                id: 'liked-1',
                title: '喜欢',
                artist: '歌手',
                source: 'test',
                duration: '3:00',
              ).toJson(),
            ],
            userPlaylists: [
              {'id': 'playlist-1', 'name': '账户歌单'},
            ],
            themeMode: 'light',
          ),
        );

    container.read(libraryProvider.notifier).clearAccountLibrary();

    expect(container.read(libraryProvider).likedSongs, isEmpty);
    expect(container.read(libraryProvider).userPlaylists, isEmpty);
  });

  test(
    'toggleLike stores resolved playback metadata for cross-device playback',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final service = _RecordingLibraryService();
      final container = ProviderContainer(
        overrides: [
          libraryProvider.overrideWith(
            (ref) => LibraryNotifier(
              service,
              ref,
              prefs,
              playbackResolver: (song) async => {
                ...song.toJson(),
                'playbackId': 'bilibili:BVresolved:1',
                'playbackSource': 'bilibili',
                'playbackSourceLabel': 'B站',
              },
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      await container
          .read(libraryProvider.notifier)
          .toggleLike(
            'token',
            Song(
              id: 'meting:song-1',
              title: '跨端歌',
              artist: '歌手',
              source: 'tencent',
              duration: '3:00',
            ),
          );

      expect(
        service.lastLikedSongs.single['playbackId'],
        'bilibili:BVresolved:p1',
      );
      expect(service.lastLikedSongs.single['playbackSource'], 'bilibili');
    },
  );

  test('toggleLike preserves the remote theme mode when saving', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final service = _RecordingLibraryService();
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(service, ref, prefs),
        ),
      ],
    );
    addTearDown(container.dispose);
    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          const RemoteLibrary(
            likedSongs: [],
            userPlaylists: [],
            themeMode: 'light',
          ),
        );

    await container
        .read(libraryProvider.notifier)
        .toggleLike(
          'token',
          Song(
            id: 'song-1',
            title: '白天喜欢',
            artist: '歌手',
            source: 'test',
            duration: '3:00',
          ),
        );

    expect(service.lastThemeMode, 'light');
  });

  test('collectPlaylist stores a mobile-readable title', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final service = _RecordingLibraryService();
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(service, ref, prefs),
        ),
      ],
    );
    addTearDown(container.dispose);

    await container.read(libraryProvider.notifier).collectPlaylist('token', {
      'id': 'playlist-1',
      'name': '收藏歌单名',
      'songs': <Map<String, dynamic>>[],
    });

    expect(service.lastUserPlaylists.single['title'], '收藏歌单名');
  });

  test(
    'createPlaylist sends updated user playlists to the API payload',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final service = _RecordingLibraryService();
      final container = ProviderContainer(
        overrides: [
          libraryProvider.overrideWith(
            (ref) => LibraryNotifier(service, ref, prefs),
          ),
        ],
      );
      addTearDown(container.dispose);

      await container
          .read(libraryProvider.notifier)
          .createPlaylist('token', '新歌单', '描述');

      expect(service.lastUserPlaylists, hasLength(1));
      expect(service.lastUserPlaylists.single['name'], '新歌单');
      expect(service.lastUserPlaylists.single['title'], '新歌单');
      expect(service.lastUserPlaylists.single['description'], '描述');
    },
  );

  test('createPlaylist preserves the remote theme mode when saving', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final service = _RecordingLibraryService();
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(service, ref, prefs),
        ),
      ],
    );
    addTearDown(container.dispose);
    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          const RemoteLibrary(
            likedSongs: [],
            userPlaylists: [],
            themeMode: 'light',
          ),
        );

    await container
        .read(libraryProvider.notifier)
        .createPlaylist('token', '白天歌单', null);

    expect(service.lastThemeMode, 'light');
  });

  test('loadLibrary loads the remote account playlists', () async {
    SharedPreferences.setMockInitialValues({'auth_token': 'token'});
    final prefs = await SharedPreferences.getInstance();
    final service = _RecordingLibraryService(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [
          {
            'id': 'remote-playlist-1',
            'name': '账户歌单',
            'songs': <Map<String, dynamic>>[],
          },
        ],
        themeMode: 'light',
      ),
    );
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(service, ref, prefs),
        ),
      ],
    );
    addTearDown(container.dispose);

    await container.read(libraryProvider.notifier).loadLibrary('token');

    expect(
      container.read(libraryProvider).userPlaylists.single['name'],
      '账户歌单',
    );
  });

  test(
    'toggleLike uses current library state instead of stale row state',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final service = _RecordingLibraryService();
      final container = ProviderContainer(
        overrides: [
          libraryProvider.overrideWith(
            (ref) => LibraryNotifier(service, ref, prefs),
          ),
        ],
      );
      addTearDown(container.dispose);

      final staleSong = Song(
        id: 'song-1',
        title: '歌',
        artist: '手',
        source: 'test',
        duration: '3:00',
      );
      container
          .read(libraryProvider.notifier)
          .setLibraryFromLogin(
            RemoteLibrary(
              likedSongs: [staleSong.copyWith(isFavorite: true).toJson()],
              userPlaylists: const [],
              themeMode: 'light',
            ),
          );

      await container
          .read(libraryProvider.notifier)
          .toggleLike('token', staleSong);

      expect(container.read(libraryProvider).likedSongs, isEmpty);
      expect(service.lastLikedSongs, isEmpty);
    },
  );

  test('addSongToPlaylist matches playlist ids by string value', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final service = _RecordingLibraryService();
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(service, ref, prefs),
        ),
      ],
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [
              {'id': 1001, 'name': '创建歌单', 'songs': <Map<String, dynamic>>[]},
            ],
            themeMode: 'light',
          ),
        );

    await container
        .read(libraryProvider.notifier)
        .addSongToPlaylist(
          'token',
          '1001',
          Song(
            id: 'song-1',
            title: '新增歌曲',
            artist: '歌手',
            source: 'test',
            duration: '3:00',
          ),
        );

    final playlist = container.read(libraryProvider).userPlaylists.single;
    expect((playlist['songs'] as List).single['title'], '新增歌曲');
    expect(
      (service.lastUserPlaylists.single['songs'] as List).single['title'],
      '新增歌曲',
    );
  });

  test('addSongToPlaylist stores resolved playback metadata', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final service = _RecordingLibraryService();
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(
            service,
            ref,
            prefs,
            playbackResolver: (song) async => {
              ...song.toJson(),
              'playbackId': 'bilibili:BVplaylist:1',
              'playbackSource': 'bilibili',
              'playbackSourceLabel': 'B站',
            },
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [
              {
                'id': 'playlist-1',
                'name': '创建歌单',
                'songs': <Map<String, dynamic>>[],
              },
            ],
            themeMode: 'light',
          ),
        );

    await container
        .read(libraryProvider.notifier)
        .addSongToPlaylist(
          'token',
          'playlist-1',
          Song(
            id: 'meting:song-2',
            title: '歌单歌',
            artist: '歌手',
            source: 'tencent',
            duration: '3:00',
          ),
        );

    final songs = service.lastUserPlaylists.single['songs'] as List;
    expect(songs.single['playbackId'], 'bilibili:BVplaylist:p1');
  });

  test(
    'removeSongsFromPlaylist removes selected songs and saves library',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final service = _RecordingLibraryService();
      final container = ProviderContainer(
        overrides: [
          libraryProvider.overrideWith(
            (ref) => LibraryNotifier(service, ref, prefs),
          ),
        ],
      );
      addTearDown(container.dispose);
      container
          .read(libraryProvider.notifier)
          .setLibraryFromLogin(
            RemoteLibrary(
              likedSongs: const [],
              userPlaylists: [
                {
                  'id': 'playlist-1',
                  'name': '创建歌单',
                  'songs': [
                    {'id': 'song-1', 'title': '保留'},
                    {'id': 'song-2', 'title': '删除'},
                    {'id': 'song-3', 'title': '也删除'},
                  ],
                  'songCount': 3,
                },
              ],
              themeMode: 'light',
            ),
          );

      await container.read(libraryProvider.notifier).removeSongsFromPlaylist(
        'token',
        'playlist-1',
        {'song-2', 'song-3'},
      );

      final playlist = service.lastUserPlaylists.single;
      final songs = playlist['songs'] as List;
      expect(songs.single['id'], 'song-1');
      expect(playlist['songCount'], 1);
    },
  );

  test('deletePlaylist removes a user playlist and saves library', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final service = _RecordingLibraryService();
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(service, ref, prefs),
        ),
      ],
    );
    addTearDown(container.dispose);
    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [
              {'id': 'playlist-1', 'name': '创建歌单'},
              {'id': 'playlist-2', 'name': '保留歌单'},
            ],
            themeMode: 'light',
          ),
        );

    await container
        .read(libraryProvider.notifier)
        .deletePlaylist('token', 'playlist-1');

    expect(service.lastUserPlaylists.single['id'], 'playlist-2');
  });

  test('collectPlaylist toggles an existing collected playlist', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final service = _RecordingLibraryService();
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(service, ref, prefs),
        ),
      ],
    );
    addTearDown(container.dispose);

    final playlist = {
      'id': 'playlist-1',
      'name': '收藏歌单',
      'songs': <Map<String, dynamic>>[],
    };

    await container
        .read(libraryProvider.notifier)
        .collectPlaylist('token', playlist);
    await container
        .read(libraryProvider.notifier)
        .collectPlaylist('token', playlist);

    expect(container.read(libraryProvider).userPlaylists, isEmpty);
    expect(service.lastUserPlaylists, isEmpty);
  });

  test(
    'collectPlaylist does not duplicate an already collected playlist',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final service = _RecordingLibraryService();
      final container = ProviderContainer(
        overrides: [
          libraryProvider.overrideWith(
            (ref) => LibraryNotifier(service, ref, prefs),
          ),
        ],
      );
      addTearDown(container.dispose);

      final playlist = {
        'id': 'playlist-1',
        'name': '收藏歌单',
        'songs': <Map<String, dynamic>>[],
        'isCollected': true,
      };
      container
          .read(libraryProvider.notifier)
          .setLibraryFromLogin(
            RemoteLibrary(
              likedSongs: const [],
              userPlaylists: [playlist],
              themeMode: 'light',
            ),
          );

      await container
          .read(libraryProvider.notifier)
          .collectPlaylist('token', playlist);

      expect(container.read(libraryProvider).userPlaylists, isEmpty);
      expect(service.lastUserPlaylists, isEmpty);
    },
  );

  test('bilibili songs keep mobile playback compatibility fields', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final service = _RecordingLibraryService();
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(service, ref, prefs),
        ),
      ],
    );
    addTearDown(container.dispose);

    await container
        .read(libraryProvider.notifier)
        .toggleLike(
          'token',
          Song(
            id: 'bilibili:BVmobile:1',
            title: 'B站歌',
            artist: 'UP',
            source: 'bilibili',
            duration: '3:00',
          ),
        );

    final saved = service.lastLikedSongs.single;
    expect(saved['id'], 'bilibili:BVmobile:p1');
    expect(saved['playbackId'], 'bilibili:BVmobile:p1');
    expect(saved['playbackSource'], 'bilibili');
    expect(saved['playbackSourceId'], 'bilibili:BVmobile:p1');
    expect(saved['sourceId'], 'bilibili:BVmobile:p1');
    expect(saved['bvid'], 'BVmobile');
    expect(saved['page'], 1);
  });

  test(
    'collectPlaylist normalizes Bilibili playlist songs for mobile playback',
    () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final service = _RecordingLibraryService();
      final container = ProviderContainer(
        overrides: [
          libraryProvider.overrideWith(
            (ref) => LibraryNotifier(service, ref, prefs),
          ),
        ],
      );
      addTearDown(container.dispose);

      await container.read(libraryProvider.notifier).collectPlaylist('token', {
        'id': 'bilibili:BVplaylist',
        'name': 'B站歌单',
        'source': 'bilibili',
        'songs': [
          {
            'id': 'bilibili:BVplaylist:2',
            'title': '第二首',
            'artist': 'UP',
            'source': 'bilibili',
            'cid': '222',
          },
        ],
      });

      final songs = service.lastUserPlaylists.single['songs'] as List;
      final saved = songs.single as Map<String, dynamic>;
      expect(saved['id'], 'bilibili:BVplaylist:p2');
      expect(saved['playbackId'], 'bilibili:BVplaylist:p2');
      expect(saved['sourceId'], 'bilibili:BVplaylist:p2');
      expect(saved['playbackSourceId'], 'bilibili:BVplaylist:p2');
      expect(saved['bvid'], 'BVplaylist');
      expect(saved['page'], 2);
      expect(saved['cid'], '222');
    },
  );
}

class _RecordingLibraryService extends LibraryService {
  _RecordingLibraryService({RemoteLibrary? remoteLibrary})
    : remoteLibrary =
          remoteLibrary ??
          const RemoteLibrary(
            likedSongs: [],
            userPlaylists: [],
            themeMode: 'light',
          );

  final RemoteLibrary remoteLibrary;
  List<Map<String, dynamic>> lastLikedSongs = const [];
  List<Map<String, dynamic>> lastUserPlaylists = const [];
  String? lastThemeMode;

  @override
  Future<RemoteLibrary> getLibrary(String token) async => remoteLibrary;

  @override
  Future<RemoteLibrary> saveLibrary(
    String token, {
    required List<Map<String, dynamic>> likedSongs,
    required List<Map<String, dynamic>> userPlaylists,
    String themeMode = 'dark',
  }) async {
    lastLikedSongs = likedSongs;
    lastUserPlaylists = userPlaylists;
    lastThemeMode = themeMode;
    return RemoteLibrary(
      likedSongs: likedSongs,
      userPlaylists: userPlaylists,
      themeMode: themeMode,
    );
  }
}
