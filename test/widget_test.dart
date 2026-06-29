import 'dart:ui';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:deepvibe_desktop/app/deepvibe_app.dart';
import 'package:deepvibe_desktop/app/theme.dart';
import 'package:deepvibe_desktop/core/models/song.dart';
import 'package:deepvibe_desktop/desktop/desktop_app_shell.dart';
import 'package:deepvibe_desktop/desktop/screens/desktop_home_screen.dart';
import 'package:deepvibe_desktop/desktop/screens/desktop_focus_screen.dart';
import 'package:deepvibe_desktop/desktop/screens/desktop_playlist_detail_screen.dart';
import 'package:deepvibe_desktop/desktop/screens/desktop_search_screen.dart';
import 'package:deepvibe_desktop/desktop/widgets/desktop_player_bar.dart';
import 'package:deepvibe_desktop/desktop/widgets/desktop_lyrics_window_controller.dart';
import 'package:deepvibe_desktop/desktop/widgets/desktop_right_rail.dart';
import 'package:deepvibe_desktop/playback/playback_actions.dart';
import 'package:deepvibe_desktop/playback/playback_providers.dart';
import 'package:deepvibe_desktop/services/app_settings.dart';
import 'package:deepvibe_desktop/services/auth_service.dart';
import 'package:deepvibe_desktop/services/library_service.dart';
import 'package:deepvibe_desktop/services/music_provider.dart';
import 'package:deepvibe_desktop/services/music_service.dart';

void main() {
  testWidgets('cover toggles focus mode on and off', (tester) async {
    final container = _containerWithSong();
    addTearDown(container.dispose);

    await _pumpPlayerBar(tester, container);

    expect(container.read(deskRouteProvider), DeskRoute.home);

    await tester.tap(find.byKey(const ValueKey('player-cover-focus-toggle')));
    await tester.pump();

    expect(container.read(deskRouteProvider), DeskRoute.focus);

    await tester.tap(find.byKey(const ValueKey('player-cover-focus-toggle')));
    await tester.pump();

    expect(container.read(deskRouteProvider), DeskRoute.home);
  });

  testWidgets('progress bar sits on top edge and grows on hover', (
    tester,
  ) async {
    final container = _containerWithSong();
    addTearDown(container.dispose);

    await _pumpPlayerBar(tester, container);

    final barTop = tester
        .getTopLeft(find.byKey(const ValueKey('desktop-player-bar')))
        .dy;
    final progressTop = tester
        .getTopLeft(find.byKey(const ValueKey('player-progress-hit-area')))
        .dy;

    expect(progressTop, barTop);

    final trackFinder = find.byKey(
      const ValueKey('player-progress-active-track'),
    );
    expect(tester.getSize(trackFinder).height, 3);

    final gesture = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await gesture.addPointer();
    await gesture.moveTo(
      tester.getCenter(find.byKey(const ValueKey('player-progress-hit-area'))),
    );
    await tester.pumpAndSettle();

    expect(tester.getSize(trackFinder).height, 6);

    await gesture.removePointer();
  });

  testWidgets(
    'volume popup opens on hover and closes when pointer leaves vertical range',
    (tester) async {
      final container = _containerWithSong();
      addTearDown(container.dispose);

      await _pumpPlayerBar(tester, container);

      expect(find.byKey(const ValueKey('volume-popup')), findsNothing);

      final gesture = await tester.createGesture(kind: PointerDeviceKind.mouse);
      await gesture.addPointer();
      await gesture.moveTo(
        tester.getCenter(find.byKey(const ValueKey('volume-button'))),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('volume-popup')), findsOneWidget);

      final popupCenter = tester.getCenter(
        find.byKey(const ValueKey('volume-popup')),
      );
      await gesture.moveTo(popupCenter);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('volume-popup')), findsOneWidget);

      await gesture.moveTo(popupCenter.translate(80, 0));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('volume-popup')), findsNothing);

      await gesture.removePointer();
    },
  );

  testWidgets('transport controls stay centered across window widths', (
    tester,
  ) async {
    final container = _containerWithSong();
    addTearDown(container.dispose);

    for (final width in const [1024.0, 1280.0, 1600.0]) {
      await _pumpPlayerBar(tester, container, size: Size(width, 720));

      final barCenter = tester
          .getCenter(find.byKey(const ValueKey('desktop-player-bar')))
          .dx;
      final playCenter = tester.getCenter(find.byIcon(Icons.play_arrow)).dx;

      expect(playCenter, closeTo(barCenter, 1), reason: 'width: $width');
    }
  });

  testWidgets('playback mode control sits with right-side utilities', (
    tester,
  ) async {
    final container = _containerWithSong();
    addTearDown(container.dispose);

    await _pumpPlayerBar(tester, container);

    final playCenter = tester.getCenter(find.byIcon(Icons.play_arrow)).dx;
    final modeCenter = tester.getCenter(find.byTooltip('顺序播放')).dx;
    final queueCenter = tester.getCenter(find.byIcon(Icons.queue_music)).dx;

    expect(modeCenter, greaterThan(playCenter));
    expect(
      (modeCenter - queueCenter).abs(),
      lessThan((modeCenter - playCenter).abs()),
    );
  });

  testWidgets('source label is not shown beside bottom song identity', (
    tester,
  ) async {
    final container = _containerWithSong();
    addTearDown(container.dispose);

    await _pumpPlayerBar(tester, container);

    expect(find.text('测试歌曲'), findsOneWidget);
    expect(find.text('酷狗音乐 · B站'), findsNothing);
  });

  testWidgets('lyrics timeout state falls back to no lyrics', (tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    container.read(currentSongProvider.notifier).state = {
      'id': 'song-1',
      'title': '测试歌曲',
      'artist': '测试歌手',
      'lyricsStatus': lyricsStatusTimeout,
      lyricsTimeoutAtKey: DateTime.now().millisecondsSinceEpoch,
    };

    await _pumpRightRail(tester, container);

    expect(find.text('歌词获取超时'), findsNothing);
    expect(find.text('网络或音源响应较慢，稍后重试或切换歌曲。'), findsNothing);
    expect(find.text('暂无歌词'), findsOneWidget);
  });

  testWidgets('lyrics timeout notice eventually falls back to no lyrics', (
    tester,
  ) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    container.read(currentSongProvider.notifier).state = {
      'id': 'song-1',
      'title': '测试歌曲',
      'artist': '测试歌手',
      'lyricsStatus': lyricsStatusTimeout,
      lyricsTimeoutAtKey: DateTime.now()
          .subtract(lyricsTimeoutNoticeDuration + const Duration(seconds: 1))
          .millisecondsSinceEpoch,
    };

    await _pumpRightRail(tester, container);

    expect(find.text('歌词获取超时'), findsNothing);
    expect(find.text('暂无歌词'), findsOneWidget);
  });

  testWidgets('lyrics button toggles the standalone desktop lyrics window', (
    tester,
  ) async {
    final container = _containerWithSong();
    addTearDown(container.dispose);
    container.read(currentSongProvider.notifier).state = {
      ...container.read(currentSongProvider)!,
      'lyrics': '[00:00.00]测试歌词',
      'lyricsStatus': lyricsStatusLoaded,
    };

    await _pumpPlayerBar(tester, container);

    expect(container.read(desktopLyricsWindowOpenProvider), isFalse);

    await tester.tap(find.byIcon(Icons.lyrics_outlined));
    await tester.pump();

    expect(container.read(desktopLyricsWindowOpenProvider), isTrue);

    await tester.tap(find.byIcon(Icons.lyrics_outlined));
    await tester.pump();

    expect(container.read(desktopLyricsWindowOpenProvider), isFalse);
  });

  testWidgets(
    'desktop shell mounts lyrics window controller, not old overlay',
    (tester) async {
      final container = await _shellContainer(authenticated: false);
      addTearDown(container.dispose);
      await _pumpDesktopShell(tester, container);

      expect(find.byType(DesktopLyricsWindowController), findsOneWidget);
      expect(
        find.byKey(const ValueKey('desktop-lyrics-overlay')),
        findsNothing,
      );
    },
  );

  testWidgets('focus mode visible labels are readable Chinese', (tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    await _pumpFocusScreen(tester, container);

    expect(find.byTooltip('返回'), findsNothing);
    expect(find.text('专注模式'), findsOneWidget);
    expect(find.text('播放歌曲后进入专注聆听'), findsOneWidget);
  });

  testWidgets('F shortcut toggles focus mode inside the desktop shell', (
    tester,
  ) async {
    final container = await _shellContainer(authenticated: false);
    addTearDown(container.dispose);
    await _pumpDesktopShell(tester, container);

    expect(container.read(deskRouteProvider), DeskRoute.home);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyF);
    await tester.pump();

    expect(container.read(deskRouteProvider), DeskRoute.focus);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyF);
    await tester.pump();

    expect(container.read(deskRouteProvider), DeskRoute.home);
  });

  testWidgets('settings page shows configurable keyboard shortcuts', (
    tester,
  ) async {
    final container = await _shellContainer(authenticated: false);
    addTearDown(container.dispose);
    container.read(deskRouteProvider.notifier).state = DeskRoute.settings;

    await _pumpDesktopShell(tester, container);

    expect(find.text('快捷键'), findsOneWidget);
    expect(find.text('播放控制'), findsOneWidget);
    expect(find.text('窗口与歌词'), findsOneWidget);
    expect(find.text('Ctrl + Alt + P'), findsOneWidget);
    expect(find.text('F'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('settings-shortcuts-reset-button')),
      findsOneWidget,
    );
  });

  testWidgets('recording F shortcut does not toggle focus mode', (
    tester,
  ) async {
    final container = await _shellContainer(authenticated: false);
    addTearDown(container.dispose);
    container.read(deskRouteProvider.notifier).state = DeskRoute.settings;

    await _pumpDesktopShell(tester, container);
    final keycap = find.byKey(
      const ValueKey('settings-shortcut-toggleFocusMode'),
    );
    await tester.drag(find.byType(ListView).first, const Offset(0, -900));
    await tester.pumpAndSettle();
    await tester.tap(keycap);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyF);
    await tester.pump();

    expect(container.read(deskRouteProvider), DeskRoute.settings);
  });

  testWidgets('right rail fallback labels are readable Chinese', (
    tester,
  ) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    await _pumpRightRail(tester, container);

    expect(find.text('歌词'), findsOneWidget);
    expect(find.text('队列'), findsOneWidget);
    expect(find.text('信息'), findsOneWidget);
    expect(find.text('未在播放'), findsAtLeastNWidgets(1));

    container.read(rightRailTabProvider.notifier).state = RightRailTab.queue;
    await tester.pump();

    expect(find.text('当前队列为空'), findsOneWidget);
  });
  testWidgets('search results highlight the currently playing song', (
    tester,
  ) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    container.read(searchQueryProvider.notifier).state = '测试';
    container.read(searchResultsProvider.notifier).state = [
      Song(
        id: 'song-1',
        title: '普通结果',
        artist: '歌手 A',
        source: 'Bilibili',
        duration: '3:10',
      ),
      Song(
        id: 'song-2',
        title: '正在播放的歌',
        artist: '歌手 B',
        source: 'Bilibili',
        duration: '4:20',
      ),
    ];
    container.read(currentSongProvider.notifier).state = const {
      'id': 'song-2',
      'title': '正在播放的歌',
      'artist': '歌手 B',
      'status': 'playing',
    };

    await _pumpSearchScreen(tester, container);

    final playingTitle = tester.widget<Text>(find.text('正在播放的歌'));

    expect(playingTitle.style?.color, DeepVibeColors.light.accent);
    expect(playingTitle.style?.fontWeight, FontWeight.w600);
  });

  testWidgets('search playlist result opens playlist detail', (tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    container.read(searchQueryProvider.notifier).state = '合集';
    container.read(searchResultsProvider.notifier).state = [
      Song(
        id: 'bilibili:BV1playlist',
        title: '华语热歌合集',
        artist: '音乐UP',
        source: 'Bilibili',
        duration: '48:00',
        resultType: 'playlist',
      ),
    ];

    await _pumpSearchScreen(tester, container);

    await tester.tap(find.text('华语热歌合集'));
    await tester.pump();

    expect(container.read(playlistDetailProvider), 'bilibili:BV1playlist');
    expect(container.read(playlistBackRouteProvider), DeskRoute.search);
    expect(container.read(deskRouteProvider), DeskRoute.playlistDetail);
  });

  testWidgets('search song rows show index and favorite action', (
    tester,
  ) async {
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: const [],
        themeMode: 'light',
      ),
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
    container.read(searchQueryProvider.notifier).state = '测试';
    container.read(searchResultsProvider.notifier).state = [
      Song(
        id: 'search-song-1',
        title: '搜索歌曲',
        artist: '歌手 A',
        source: 'Bilibili',
        duration: '3:10',
      ),
    ];

    await _pumpSearchScreen(tester, container);

    final index = find.byKey(const ValueKey('search-song-index-search-song-1'));
    expect(index, findsOneWidget);
    expect(
      find.descendant(of: index, matching: find.text('1')),
      findsOneWidget,
    );

    final heart = find.byKey(const ValueKey('search-like-search-song-1'));
    expect(heart, findsOneWidget);

    await tester.tap(heart);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(
      container.read(libraryProvider).likedSongs.single.id,
      'search-song-1',
    );
  });

  testWidgets('search song context menu adds the song to a playlist', (
    tester,
  ) async {
    final playlist = {
      ..._localPlaylist,
      'songs': <Map<String, dynamic>>[],
      'songCount': 0,
    };
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [playlist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);
    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [playlist],
            themeMode: 'light',
          ),
        );
    container.read(searchQueryProvider.notifier).state = '测试';
    container.read(searchResultsProvider.notifier).state = [
      Song(
        id: 'search-song-2',
        title: '右键歌曲',
        artist: '歌手 B',
        source: 'Bilibili',
        duration: '4:20',
      ),
    ];

    await _pumpSearchScreen(tester, container);

    await tester.tapAt(
      tester.getCenter(find.byKey(const ValueKey('search-row-search-song-2'))),
      buttons: kSecondaryMouseButton,
    );
    await tester.pumpAndSettle();

    expect(find.text('添加到歌单'), findsOneWidget);
    await tester.tap(find.text('旅行歌单').last);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final updated = container.read(libraryProvider).userPlaylists.single;
    final songs = updated['songs'] as List;
    expect(songs.single['id'], 'search-song-2');
  });

  testWidgets('playlist detail back returns to the previous route', (
    tester,
  ) async {
    final container = await _shellContainer(
      authenticated: false,
      musicProvider: _FakeMusicProvider(
        playlists: const {
          'bilibili:BV1playlist': {
            'id': 'bilibili:BV1playlist',
            'title': '华语热歌合集',
            'subtitle': '音乐UP · 0 首歌曲',
            'source': 'bilibili',
            'songCount': 0,
            'coverUrl': 'https://example.test/cover.jpg',
            'songs': <Map<String, dynamic>>[],
          },
        },
      ),
    );
    addTearDown(container.dispose);

    container.read(routeBackStackProvider.notifier).state = const [
      DeskNavigationEntry(route: DeskRoute.search),
    ];
    container.read(deskRouteProvider.notifier).state = DeskRoute.playlistDetail;
    container.read(playlistDetailProvider.notifier).state =
        'bilibili:BV1playlist';

    await _pumpDesktopShell(tester, container);

    await tester.tap(find.byKey(const ValueKey('route-back-button')));
    await tester.pump();

    expect(container.read(deskRouteProvider), DeskRoute.search);
    expect(container.read(playlistDetailProvider), isNull);
  });

  testWidgets(
    'top navigation buttons move backward and forward through routes',
    (tester) async {
      final container = await _shellContainer(authenticated: false);
      addTearDown(container.dispose);

      await _pumpDesktopShell(tester, container);

      await tester.tap(find.text('搜索'));
      await tester.pump();
      await tester.tap(find.text('我的音乐'));
      await tester.pump();

      expect(container.read(deskRouteProvider), DeskRoute.library);

      await tester.tap(find.byKey(const ValueKey('route-back-button')));
      await tester.pump();

      expect(container.read(deskRouteProvider), DeskRoute.search);

      await tester.tap(find.byKey(const ValueKey('route-forward-button')));
      await tester.pump();

      expect(container.read(deskRouteProvider), DeskRoute.library);
    },
  );

  testWidgets('top route buttons align with the main content rail', (
    tester,
  ) async {
    final container = await _shellContainer(authenticated: false);
    addTearDown(container.dispose);

    await _pumpDesktopShell(tester, container);

    final backLeft = tester
        .getTopLeft(find.byKey(const ValueKey('route-back-button')))
        .dx;

    expect(backLeft, closeTo(kSidebarWidth + 12, 1));
  });

  testWidgets('playlist detail renders a local user playlist', (tester) async {
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [_localPlaylist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [_localPlaylist],
            themeMode: 'light',
          ),
        );
    container.read(playlistDetailProvider.notifier).state = 'local-playlist-1';
    container.read(deskRouteProvider.notifier).state = DeskRoute.playlistDetail;

    await _pumpDesktopShell(tester, container);

    expect(
      find.descendant(
        of: find.byType(DesktopPlaylistDetailScreen),
        matching: find.text('旅行歌单'),
      ),
      findsOneWidget,
    );
    expect(find.text('路上听'), findsOneWidget);
    expect(find.text('路歌'), findsOneWidget);
  });

  testWidgets('focus mode returns to playlist detail with selected playlist', (
    tester,
  ) async {
    final container = _containerWithSong();
    addTearDown(container.dispose);
    container.read(deskRouteProvider.notifier).state = DeskRoute.playlistDetail;
    container.read(playlistDetailProvider.notifier).state =
        'bilibili:BVfocusPlaylist';
    container.read(routeBackStackProvider.notifier).state = const [
      DeskNavigationEntry(route: DeskRoute.search),
    ];

    await _pumpPlayerBar(tester, container);

    await tester.tap(find.byKey(const ValueKey('player-cover-focus-toggle')));
    await tester.pump();
    expect(container.read(deskRouteProvider), DeskRoute.focus);

    await tester.tap(find.byKey(const ValueKey('player-cover-focus-toggle')));
    await tester.pump();

    expect(container.read(deskRouteProvider), DeskRoute.playlistDetail);
    expect(container.read(playlistDetailProvider), 'bilibili:BVfocusPlaylist');
    expect(
      container.read(routeBackStackProvider).single.route,
      DeskRoute.search,
    );
  });

  testWidgets('playlist detail reflects liked songs and hides share action', (
    tester,
  ) async {
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: [
          Song.fromJson(_localPlaylistSong).copyWith(isFavorite: true).toJson(),
        ],
        userPlaylists: [_localPlaylist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: [
              Song.fromJson(
                _localPlaylistSong,
              ).copyWith(isFavorite: true).toJson(),
            ],
            userPlaylists: [_localPlaylist],
            themeMode: 'light',
          ),
        );
    container.read(playlistDetailProvider.notifier).state = 'local-playlist-1';
    container.read(deskRouteProvider.notifier).state = DeskRoute.playlistDetail;

    await _pumpDesktopShell(tester, container);

    expect(find.text('分享'), findsNothing);
    expect(find.byIcon(Icons.favorite), findsOneWidget);
    expect(find.text('收藏'), findsNothing);
  });

  testWidgets('collected playlist shows highlighted toggle and can uncollect', (
    tester,
  ) async {
    final collected = {
      'id': 'collected-playlist-1',
      'name': '收藏歌单',
      'description': '收藏来的',
      'songs': <Map<String, dynamic>>[],
      'isCollected': true,
    };
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [collected],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);
    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [collected],
            themeMode: 'light',
          ),
        );
    container.read(playlistDetailProvider.notifier).state =
        'collected-playlist-1';

    await _pumpPlaylistDetailScreen(tester, container);

    final collectButton = find.byKey(const ValueKey('playlist-collect-button'));
    expect(collectButton, findsOneWidget);
    expect(find.text('已收藏'), findsOneWidget);
    expect(find.byIcon(Icons.favorite), findsOneWidget);

    await tester.tap(collectButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(container.read(libraryProvider).userPlaylists, isEmpty);
  });

  testWidgets('playlist detail removes a song from a local playlist', (
    tester,
  ) async {
    final playlist = {
      ..._localPlaylist,
      'songs': [
        _localPlaylistSong,
        {
          'id': 'road-song-2',
          'title': '另一首',
          'artist': '旅行歌手',
          'source': 'Bilibili',
          'duration': 200000,
        },
      ],
      'songCount': 2,
    };
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [playlist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);
    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [playlist],
            themeMode: 'light',
          ),
        );
    container.read(playlistDetailProvider.notifier).state = 'local-playlist-1';

    await _pumpPlaylistDetailScreen(tester, container);

    await tester.tapAt(
      tester.getCenter(find.text('路歌')),
      buttons: kSecondaryMouseButton,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('从歌单移除'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final songs =
        container.read(libraryProvider).userPlaylists.single['songs'] as List;
    expect(songs.single['id'], 'road-song-2');
    expect(find.text('路歌'), findsNothing);
  });

  testWidgets('playlist detail batch removes selected local songs', (
    tester,
  ) async {
    final playlist = {
      ..._localPlaylist,
      'songs': [
        _localPlaylistSong,
        {
          'id': 'road-song-2',
          'title': '另一首',
          'artist': '旅行歌手',
          'source': 'Bilibili',
          'duration': 200000,
        },
      ],
      'songCount': 2,
    };
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [playlist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);
    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [playlist],
            themeMode: 'light',
          ),
        );
    container.read(playlistDetailProvider.notifier).state = 'local-playlist-1';

    await _pumpPlaylistDetailScreen(tester, container);

    await tester.tap(find.byKey(const ValueKey('playlist-select-road-song-1')));
    await tester.tap(find.byKey(const ValueKey('playlist-select-road-song-2')));
    await tester.pump();

    expect(find.text('已选 2 首'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('playlist-remove-selected')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final songs =
        container.read(libraryProvider).userPlaylists.single['songs'] as List;
    expect(songs, isEmpty);
    expect(find.text('路歌'), findsNothing);
    expect(find.text('另一首'), findsNothing);
  });

  testWidgets('playlist detail deletes a created playlist', (tester) async {
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [_localPlaylist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);
    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [_localPlaylist],
            themeMode: 'light',
          ),
        );
    container.read(deskRouteProvider.notifier).state = DeskRoute.playlistDetail;
    container.read(playlistDetailProvider.notifier).state = 'local-playlist-1';
    container.read(playlistBackRouteProvider.notifier).state =
        DeskRoute.profile;

    await _pumpPlaylistDetailScreen(tester, container);

    await tester.tap(find.byKey(const ValueKey('playlist-delete-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('删除'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(container.read(libraryProvider).userPlaylists, isEmpty);
    expect(container.read(deskRouteProvider), DeskRoute.profile);
    expect(container.read(playlistDetailProvider), isNull);
  });

  testWidgets('lyrics loading falls back after timeout timestamp', (
    tester,
  ) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(currentSongProvider.notifier).state = {
      ..._likedSong,
      'lyrics': '',
      'lyricsStatus': lyricsStatusLoading,
      lyricsLoadingStartedAtKey: DateTime.now()
          .subtract(lyricsLoadTimeout + const Duration(seconds: 1))
          .millisecondsSinceEpoch,
    };
    await _pumpRightRail(tester, container);

    expect(find.text('加载歌词中...'), findsNothing);
    expect(find.text('暂无歌词'), findsOneWidget);
  });

  testWidgets('playlist detail heart turns red after adding to liked songs', (
    tester,
  ) async {
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [_localPlaylist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [_localPlaylist],
            themeMode: 'light',
          ),
        );
    container.read(playlistDetailProvider.notifier).state = 'local-playlist-1';

    await _pumpPlaylistDetailScreen(tester, container);

    final heart = find.byKey(const ValueKey('playlist-like-road-song-1'));
    expect(heart, findsOneWidget);

    var heartIcon = tester.widget<Icon>(
      find.descendant(of: heart, matching: find.byType(Icon)),
    );
    expect(heartIcon.icon, Icons.favorite_border);
    expect(container.read(authProvider).isLoggedIn, isTrue);

    await tester.tap(heart);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    heartIcon = tester.widget<Icon>(
      find.descendant(of: heart, matching: find.byType(Icon)),
    );
    expect(heartIcon.icon, Icons.favorite);
    expect(heartIcon.color, Colors.red);
    expect(
      container.read(libraryProvider).likedSongs.single.id,
      _localPlaylistSong['id'],
    );
  });

  testWidgets('playlist detail reloads when selected playlist changes', (
    tester,
  ) async {
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [_localPlaylist, _secondLocalPlaylist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [_localPlaylist, _secondLocalPlaylist],
            themeMode: 'light',
          ),
        );
    container.read(playlistDetailProvider.notifier).state = 'local-playlist-1';

    await _pumpPlaylistDetailScreen(tester, container);
    expect(find.text('路歌'), findsOneWidget);
    expect(find.text('新加入的歌'), findsNothing);

    container.read(playlistDetailProvider.notifier).state = 'local-playlist-2';
    await tester.pumpAndSettle();

    expect(find.text('路歌'), findsNothing);
    expect(find.text('新加入的歌'), findsOneWidget);
  });
  testWidgets('home recommended playlist opens playlist detail', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        musicServiceProvider.overrideWithValue(
          MusicService(
            provider: _FakeMusicProvider(
              recommended: const [
                {
                  'id': 'bilibili:BVhomePlaylist',
                  'title': '首页推荐合集',
                  'artist': '音乐UP',
                  'source': 'bilibili',
                  'sourceLabel': 'B站',
                  'duration': 3600000,
                  'resultType': 'playlist',
                },
              ],
            ),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    await _pumpHomeScreen(tester, container);

    await tester.tap(find.text('首页推荐合集'));
    await tester.pump();

    expect(container.read(playlistDetailProvider), 'bilibili:BVhomePlaylist');
    expect(container.read(playlistBackRouteProvider), DeskRoute.home);
    expect(container.read(deskRouteProvider), DeskRoute.playlistDetail);
  });

  testWidgets('home recommended song uses the shared playback state', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        musicServiceProvider.overrideWithValue(
          MusicService(
            provider: const _FakeMusicProvider(
              recommended: [
                {
                  'id': 'home-song-1',
                  'title': '首页推荐歌',
                  'artist': '首页歌手',
                  'source': 'bilibili',
                  'duration': 185000,
                },
              ],
            ),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    await _pumpHomeScreen(tester, container);

    await tester.tap(find.text('首页推荐歌'));
    await tester.pump();

    expect(container.read(currentSongProvider)?['id'], 'home-song-1');
  });

  testWidgets('home keeps loaded playlists after remount', (tester) async {
    final container = ProviderContainer(
      overrides: [
        musicServiceProvider.overrideWithValue(
          MusicService(
            provider: _FakeMusicProvider(
              hotPlaylistsByOffset: const {
                0: [
                  {
                    'id': 'bilibili:BVhomePage1',
                    'title': '第一页歌单',
                    'subtitle': '首页推荐',
                    'source': 'bilibili',
                    'songCount': 12,
                    'coverUrl': 'https://example.test/page1.jpg',
                  },
                ],
                1: [
                  {
                    'id': 'bilibili:BVhomePage2',
                    'title': '第二页歌单',
                    'subtitle': '加载更多结果',
                    'source': 'bilibili',
                    'songCount': 16,
                    'coverUrl': 'https://example.test/page2.jpg',
                  },
                ],
              },
            ),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    await _pumpHomeScreen(tester, container);
    expect(find.text('第一页歌单'), findsOneWidget);
    expect(find.text('第二页歌单'), findsNothing);

    await tester.tap(find.text('加载更多'));
    await tester.pumpAndSettle();

    expect(find.text('第二页歌单'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();

    await _pumpHomeScreen(tester, container);

    expect(find.text('第一页歌单'), findsOneWidget);
    expect(find.text('第二页歌单'), findsOneWidget);
  });

  testWidgets('app applies a modest desktop text scale', (tester) async {
    tester.view.physicalSize = const Size(1280, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final container = await _shellContainer(authenticated: false);
    addTearDown(container.dispose);
    container.read(deskRouteProvider.notifier).state = DeskRoute.settings;

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const DeepVibeApp(),
      ),
    );
    await tester.pump();

    final context = tester.element(find.byType(DesktopAppShell));
    final textScaler = MediaQuery.textScalerOf(context);

    expect(textScaler.scale(10), greaterThan(10));
    expect(textScaler.scale(10), lessThanOrEqualTo(11));
  });

  testWidgets('settings page exposes cache and lyrics controls', (
    tester,
  ) async {
    final container = await _shellContainer(
      authenticated: false,
      extraOverrides: [
        defaultCacheDirectoryProvider.overrideWith(
          (ref) async => r'C:\Users\tester\AppData\Local\Temp',
        ),
      ],
    );
    addTearDown(container.dispose);
    container.read(deskRouteProvider.notifier).state = DeskRoute.settings;

    await _pumpDesktopShell(tester, container);

    expect(find.text('缓存目录'), findsOneWidget);
    expect(find.text('歌词字号'), findsOneWidget);
    expect(find.text('歌词颜色'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('settings-cache-directory-field')),
      findsOneWidget,
    );
    expect(
      find.text(r'当前缓存目录: C:\Users\tester\AppData\Local\Temp（默认）'),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('settings-cache-directory-choose-button')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('settings-lyrics-font-size-slider')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('settings-lyrics-color-green')),
      findsOneWidget,
    );
  });

  testWidgets('settings cache directory button opens a folder picker', (
    tester,
  ) async {
    var pickerCalled = false;
    final container = await _shellContainer(
      authenticated: false,
      extraOverrides: [
        cacheDirectoryPickerProvider.overrideWithValue(() async {
          pickerCalled = true;
          return r'C:\MusicCache';
        }),
      ],
    );
    addTearDown(container.dispose);
    container.read(deskRouteProvider.notifier).state = DeskRoute.settings;

    await _pumpDesktopShell(tester, container);
    await tester.tap(
      find.byKey(const ValueKey('settings-cache-directory-choose-button')),
    );
    await tester.pumpAndSettle();

    expect(pickerCalled, isTrue);
    expect(
      container.read(appSettingsProvider).cacheDirectory,
      r'C:\MusicCache',
    );
    expect(find.text(r'当前缓存目录: C:\MusicCache'), findsOneWidget);
  });
  testWidgets('logged-in user button opens account menu in the top bar', (
    tester,
  ) async {
    final container = await _authenticatedShellContainer();
    addTearDown(container.dispose);

    await _pumpDesktopShell(tester, container);

    final dragAncestors = tester
        .widgetList<GestureDetector>(
          find.ancestor(
            of: find.text('测试用户'),
            matching: find.byType(GestureDetector),
          ),
        )
        .where((widget) => widget.onPanStart != null);
    expect(dragAncestors, isEmpty);

    expect(find.text('退出登录'), findsNothing);

    await tester.tap(find.text('测试用户'));
    await tester.pump();

    expect(find.text('我的'), findsOneWidget);
    expect(find.text('设置'), findsOneWidget);
    expect(find.text('退出登录'), findsOneWidget);

    await tester.tap(find.text('设置'));
    await tester.pumpAndSettle();

    expect(container.read(deskRouteProvider), DeskRoute.settings);
  });
  testWidgets('logged-in user menu opens profile page', (tester) async {
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: [_likedSong],
        userPlaylists: [_localPlaylist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: [_likedSong],
            userPlaylists: [_localPlaylist],
            themeMode: 'light',
          ),
        );

    await _pumpDesktopShell(tester, container);

    await tester.tap(find.text('测试用户'));
    await tester.pump();
    await tester.tap(find.text('我的'));
    await tester.pumpAndSettle();

    expect(container.read(deskRouteProvider), DeskRoute.profile);
    expect(find.text('我的主页'), findsOneWidget);
    expect(find.text('@tester'), findsOneWidget);
    final handleWidth = tester
        .getSize(find.byKey(const ValueKey('profile-handle-compact')))
        .width;
    expect(handleWidth, lessThanOrEqualTo(160));
    await tester.drag(find.byType(ListView).last, const Offset(0, -420));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('profile-created-playlist-local-playlist-1')),
      findsOneWidget,
    );
  });

  testWidgets('profile page opens liked music and created playlist', (
    tester,
  ) async {
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: [_likedSong],
        userPlaylists: [_localPlaylist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: [_likedSong],
            userPlaylists: [_localPlaylist],
            themeMode: 'light',
          ),
        );
    container.read(deskRouteProvider.notifier).state = DeskRoute.profile;

    await _pumpDesktopShell(tester, container);

    await tester.tap(find.byKey(const ValueKey('profile-liked-playlist')));
    await tester.pump();

    expect(container.read(deskRouteProvider), DeskRoute.favorites);

    container.read(deskRouteProvider.notifier).state = DeskRoute.profile;
    await tester.pump();

    await tester.drag(find.byType(ListView).last, const Offset(0, -420));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('profile-created-playlist-local-playlist-1')),
    );
    await tester.pump();

    expect(container.read(playlistDetailProvider), 'local-playlist-1');
    expect(container.read(playlistBackRouteProvider), DeskRoute.profile);
    expect(container.read(deskRouteProvider), DeskRoute.playlistDetail);
  });

  testWidgets('library page uses account data and shared playback state', (
    tester,
  ) async {
    final rawDurationSong = {
      ..._likedSong,
      'id': 'library-liked-song',
      'title': '音乐库真实收藏',
      'duration': 185000,
    };
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: [rawDurationSong],
        userPlaylists: [_localPlaylist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);
    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: [rawDurationSong],
            userPlaylists: [_localPlaylist],
            themeMode: 'light',
          ),
        );
    container.read(deskRouteProvider.notifier).state = DeskRoute.library;

    await _pumpDesktopShell(tester, container);

    expect(find.text('音乐库真实收藏'), findsOneWidget);
    expect(find.text('夜曲'), findsNothing);

    await tester.tap(find.text('音乐库真实收藏'));
    await tester.pump();

    expect(container.read(currentSongProvider)?['id'], 'library-liked-song');
  });

  testWidgets('favorites heart removes liked song from the list', (
    tester,
  ) async {
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: [_likedSong],
        userPlaylists: const [],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: [_likedSong],
            userPlaylists: const [],
            themeMode: 'light',
          ),
        );
    container.read(deskRouteProvider.notifier).state = DeskRoute.favorites;

    await _pumpDesktopShell(tester, container);

    expect(find.text('喜欢的歌'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('favorites-like-liked-song-1')));
    await tester.pump();

    expect(container.read(libraryProvider).likedSongs, isEmpty);
    expect(find.text('喜欢的歌'), findsNothing);
    expect(find.text('还没有收藏的歌曲'), findsOneWidget);
  });

  testWidgets(
    'favorites and history durations are formatted as minutes and seconds',
    (tester) async {
      final rawDurationSong = {..._likedSong, 'duration': 185000};
      final container = await _authenticatedShellContainer(
        remoteLibrary: RemoteLibrary(
          likedSongs: [rawDurationSong],
          userPlaylists: const [],
          themeMode: 'light',
        ),
      );
      addTearDown(container.dispose);
      container
          .read(libraryProvider.notifier)
          .setLibraryFromLogin(
            RemoteLibrary(
              likedSongs: [rawDurationSong],
              userPlaylists: const [],
              themeMode: 'light',
            ),
          );
      await container
          .read(libraryProvider.notifier)
          .addToHistory(Song.fromJson(rawDurationSong));

      container.read(deskRouteProvider.notifier).state = DeskRoute.favorites;
      await _pumpDesktopShell(tester, container);
      expect(
        find.byKey(const ValueKey('song-list-header-title')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('song-list-header-artist')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('song-list-header-duration')),
        findsOneWidget,
      );
      expect(find.text('3:05'), findsOneWidget);
      expect(find.text('185000'), findsNothing);

      container.read(deskRouteProvider.notifier).state = DeskRoute.history;
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('song-list-header-title')),
        findsOneWidget,
      );
      expect(find.text('3:05'), findsOneWidget);
      expect(find.text('185000'), findsNothing);
    },
  );

  testWidgets('loaded lyrics are written back to favorites and history', (
    tester,
  ) async {
    final rawSong = {..._likedSong, 'lyrics': ''};
    final container = await _shellContainer(
      authenticated: true,
      remoteLibrary: RemoteLibrary(
        likedSongs: [rawSong],
        userPlaylists: const [],
        themeMode: 'light',
      ),
      musicProvider: const _FakeMusicProvider(
        lyricsById: {'liked-song-1': '[00:00.00]回写歌词'},
      ),
    );
    addTearDown(container.dispose);
    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: [rawSong],
            userPlaylists: const [],
            themeMode: 'light',
          ),
        );
    await container
        .read(libraryProvider.notifier)
        .addToHistory(Song.fromJson(rawSong));
    container.read(currentSongProvider.notifier).state = {
      ...rawSong,
      'lyricsStatus': lyricsStatusLoading,
    };
    playbackRequestSerial = 100;
    lyricsRequestSerial = 200;

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: Consumer(
            builder: (context, ref, child) {
              return TextButton(
                onPressed: () {
                  loadLyricsForCurrentSong(
                    ref,
                    rawSong,
                    requestSerial: 100,
                    lyricsSerial: 200,
                  );
                },
                child: const Text('load lyrics'),
              );
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('load lyrics'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));

    expect(
      container.read(libraryProvider).likedSongs.single.toJson()['lyrics'],
      '[00:00.00]回写歌词',
    );
    expect(
      container.read(libraryProvider).playHistory.single.toJson()['lyrics'],
      '[00:00.00]回写歌词',
    );
  });

  testWidgets('lyrics button retries missing lyrics for liked music playback', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        musicServiceProvider.overrideWithValue(
          MusicService(
            provider: const _FakeMusicProvider(
              lyricsById: {'liked-song-1': '[00:00.00]喜欢歌词'},
            ),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    container.read(currentSongProvider.notifier).state = {
      ..._likedSong,
      'lyrics': '',
      'lyricsStatus': lyricsStatusTimeout,
      lyricsTimeoutAtKey: DateTime.now().millisecondsSinceEpoch,
    };

    await _pumpPlayerBar(tester, container);

    await tester.tap(find.byIcon(Icons.lyrics_outlined));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));

    final song = container.read(currentSongProvider);
    expect(song?['lyrics'], '[00:00.00]喜欢歌词');
    expect(song?['lyricsStatus'], lyricsStatusLoaded);
  });

  testWidgets('sidebar user playlist opens playlist detail', (tester) async {
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [_localPlaylist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [_localPlaylist],
            themeMode: 'light',
          ),
        );

    await _pumpDesktopShell(tester, container);

    await tester.tap(find.text('旅行歌单'));
    await tester.pump();

    expect(container.read(playlistDetailProvider), 'local-playlist-1');
    expect(container.read(playlistBackRouteProvider), DeskRoute.home);
    expect(container.read(deskRouteProvider), DeskRoute.playlistDetail);
  });
  testWidgets('stored auth loads account playlists into the shell', (
    tester,
  ) async {
    final container = await _shellContainer(
      authenticated: true,
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [_secondLocalPlaylist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);

    await _pumpDesktopShell(tester, container);

    expect(find.text('账户同步歌单'), findsOneWidget);
  });

  testWidgets('profile separates created and collected playlists', (
    tester,
  ) async {
    final container = await _authenticatedShellContainer(
      remoteLibrary: RemoteLibrary(
        likedSongs: const [],
        userPlaylists: [_localPlaylist, _collectedPlaylist],
        themeMode: 'light',
      ),
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          RemoteLibrary(
            likedSongs: const [],
            userPlaylists: [_localPlaylist, _collectedPlaylist],
            themeMode: 'light',
          ),
        );
    container.read(deskRouteProvider.notifier).state = DeskRoute.profile;

    await _pumpDesktopShell(tester, container);

    expect(find.text('创建的歌单'), findsAtLeastNWidgets(1));
    expect(find.text('收藏的歌单'), findsOneWidget);
    await tester.drag(find.byType(ListView).last, const Offset(0, -420));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('profile-created-playlist-local-playlist-1')),
      findsOneWidget,
    );
    await tester.drag(find.byType(ListView).last, const Offset(0, -260));
    await tester.pumpAndSettle();
    expect(
      find.byKey(
        const ValueKey('profile-collected-playlist-collected-playlist-1'),
      ),
      findsOneWidget,
    );
  });
  testWidgets('logged-out login icon opens login dialog from the top bar', (
    tester,
  ) async {
    final container = await _shellContainer(authenticated: false);
    addTearDown(container.dispose);

    await _pumpDesktopShell(tester, container);

    expect(find.text('用户名'), findsNothing);

    final loginIcon = find.byIcon(Icons.account_circle_outlined);
    final dragAncestors = tester
        .widgetList<GestureDetector>(
          find.ancestor(of: loginIcon, matching: find.byType(GestureDetector)),
        )
        .where((widget) => widget.onPanStart != null);
    expect(dragAncestors, isEmpty);

    await tester.tap(loginIcon);
    await tester.pumpAndSettle();

    expect(find.text('用户名'), findsOneWidget);
    expect(find.text('密码'), findsOneWidget);
  });

  testWidgets('login dialog can switch to registration and submit', (
    tester,
  ) async {
    final authService = _FakeAuthService();
    final container = await _shellContainer(
      authenticated: false,
      authService: authService,
    );
    addTearDown(container.dispose);

    await _pumpDesktopShell(tester, container);
    await tester.tap(find.byIcon(Icons.account_circle_outlined));
    await tester.pumpAndSettle();

    await tester.tap(find.text('注册'));
    await tester.pumpAndSettle();

    expect(find.text('昵称（可选）'), findsOneWidget);
    expect(find.text('确认密码'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, '用户名'), 'new-user');
    await tester.enterText(find.widgetWithText(TextField, '昵称（可选）'), '新用户');
    await tester.enterText(find.widgetWithText(TextField, '密码'), 'secret123');
    await tester.enterText(find.widgetWithText(TextField, '确认密码'), 'secret123');
    await tester.tap(find.text('注册并登录'));
    await tester.pumpAndSettle();

    expect(authService.registeredUsername, 'new-user');
    expect(container.read(authProvider).isLoggedIn, isTrue);
    expect(find.text('新用户'), findsOneWidget);
  });
}

final _likedSong = Song(
  id: 'liked-song-1',
  title: '喜欢的歌',
  artist: '测试歌手',
  source: 'Bilibili',
  duration: '3:00',
  isFavorite: true,
).toJson();

final _localPlaylist = {
  'id': 'local-playlist-1',
  'name': '旅行歌单',
  'description': '路上听',
  'songs': [_localPlaylistSong],
  'createdAt': '2026-06-26T00:00:00.000',
  'isCollected': false,
};
final _localPlaylistSong = {
  'id': 'road-song-1',
  'title': '路歌',
  'artist': '旅行歌手',
  'source': 'Bilibili',
  'duration': 180000,
};

final _secondLocalPlaylist = {
  'id': 'local-playlist-2',
  'name': '账户同步歌单',
  'description': '来自账户资料库',
  'songs': [
    {
      'id': 'added-song-1',
      'title': '新加入的歌',
      'artist': '新歌手',
      'source': 'Bilibili',
      'duration': 200000,
    },
  ],
  'createdAt': '2026-06-26T00:00:00.000',
  'isCollected': false,
};

final _collectedPlaylist = {
  'id': 'collected-playlist-1',
  'name': '收藏歌单',
  'description': '收藏来的',
  'songs': <Map<String, dynamic>>[],
  'isCollected': true,
};
ProviderContainer _containerWithSong() {
  final container = ProviderContainer();
  container.read(currentSongProvider.notifier).state = const {
    'id': 'song-1',
    'title': '测试歌曲',
    'artist': '测试歌手',
    'sourceLabel': '酷狗音乐',
    'playbackSourceLabel': 'B站',
  };
  container.read(playbackDurationProvider.future);
  return container;
}

Future<void> _pumpPlayerBar(
  WidgetTester tester,
  ProviderContainer container, {
  Size size = const Size(1280, 720),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: DesktopPlayerBar(),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

Future<void> _pumpHomeScreen(
  WidgetTester tester,
  ProviderContainer container,
) async {
  tester.view.physicalSize = const Size(1280, 720);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(body: DesktopHomeScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpPlaylistDetailScreen(
  WidgetTester tester,
  ProviderContainer container,
) async {
  tester.view.physicalSize = const Size(1280, 720);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(body: DesktopPlaylistDetailScreen()),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

Future<void> _pumpRightRail(
  WidgetTester tester,
  ProviderContainer container,
) async {
  tester.view.physicalSize = const Size(1280, 720);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(body: DesktopRightRail(width: 320)),
      ),
    ),
  );
  await tester.pump();
}

Future<void> _pumpFocusScreen(
  WidgetTester tester,
  ProviderContainer container,
) async {
  tester.view.physicalSize = const Size(1280, 720);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(body: DesktopFocusScreen()),
      ),
    ),
  );
  await tester.pump();
}

class _FakeMusicProvider implements MusicProvider {
  const _FakeMusicProvider({
    this.recommended = const [],
    this.playlists = const {},
    this.hotPlaylistsByOffset = const {},
    this.lyricsById = const {},
  });

  final List<Map<String, dynamic>> recommended;
  final Map<String, Map<String, dynamic>> playlists;
  final Map<int, List<Map<String, dynamic>>> hotPlaylistsByOffset;
  final Map<String, String> lyricsById;

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {}

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query) async =>
      const [];

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async => recommended;

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async {
    return hotPlaylistsByOffset[offset ?? 0] ?? const [];
  }

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) async {
    return playlists[id] ??
        {
          'id': id,
          'title': '测试歌单',
          'subtitle': '',
          'source': 'bilibili',
          'songCount': 0,
          'songs': <Map<String, dynamic>>[],
        };
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) {
    throw UnimplementedError();
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) async =>
      PlaybackUrl('https://example.test/$id.m4s');

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async {
    return lyricsById[song['id']?.toString()] ?? '';
  }
}

Future<void> _pumpSearchScreen(
  WidgetTester tester,
  ProviderContainer container,
) async {
  tester.view.physicalSize = const Size(1280, 720);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  container.read(deskRouteProvider.notifier).state = DeskRoute.search;

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(body: DesktopSearchScreen()),
      ),
    ),
  );
  await tester.pump();
}

Future<ProviderContainer> _authenticatedShellContainer({
  RemoteLibrary? remoteLibrary,
}) => _shellContainer(authenticated: true, remoteLibrary: remoteLibrary);

Future<ProviderContainer> _shellContainer({
  required bool authenticated,
  RemoteLibrary? remoteLibrary,
  MusicProvider musicProvider = const _FakeMusicProvider(),
  AuthService? authService,
  List<Override> extraOverrides = const [],
}) async {
  SharedPreferences.setMockInitialValues(
    authenticated ? {'auth_token': 'test-token'} : {},
  );
  final prefs = await SharedPreferences.getInstance();
  final container = ProviderContainer(
    overrides: [
      authProvider.overrideWith(
        (ref) => AuthNotifier(authService ?? _FakeAuthService(), prefs, ref),
      ),
      libraryProvider.overrideWith(
        (ref) =>
            LibraryNotifier(_FakeLibraryService(remoteLibrary), ref, prefs),
      ),
      musicServiceProvider.overrideWithValue(
        MusicService(provider: musicProvider),
      ),
      ...extraOverrides,
    ],
  );
  if (authenticated) {
    container.read(authProvider);
    await Future<void>.value();
    await Future<void>.value();
  }
  return container;
}

Future<void> _pumpDesktopShell(
  WidgetTester tester,
  ProviderContainer container,
) async {
  tester.view.physicalSize = const Size(1280, 720);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const DesktopAppShell(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _FakeAuthService extends AuthService {
  String? registeredUsername;

  @override
  Future<UserInfo> getMe(String token) async {
    return UserInfo(
      id: 1,
      username: 'tester',
      nickname: '测试用户',
      avatarText: '测',
    );
  }

  @override
  Future<void> logout(String token) async {}

  @override
  Future<AuthResult> register(
    String username,
    String password, {
    String? nickname,
  }) async {
    registeredUsername = username;
    return AuthResult(
      user: UserInfo(
        id: 2,
        username: username,
        nickname: nickname ?? username,
        avatarText: username[0].toUpperCase(),
      ),
      token: 'registered-token',
      library: const RemoteLibrary(
        likedSongs: [],
        userPlaylists: [],
        themeMode: 'light',
      ),
    );
  }
}

class _FakeLibraryService extends LibraryService {
  _FakeLibraryService([this.remoteLibrary]);

  final RemoteLibrary? remoteLibrary;
  @override
  Future<RemoteLibrary> getLibrary(String token) async {
    return remoteLibrary ??
        const RemoteLibrary(
          likedSongs: [],
          userPlaylists: [],
          themeMode: 'light',
        );
  }

  @override
  Future<RemoteLibrary> saveLibrary(
    String token, {
    required List<Map<String, dynamic>> likedSongs,
    required List<Map<String, dynamic>> userPlaylists,
    String themeMode = 'dark',
  }) async {
    return RemoteLibrary(
      likedSongs: likedSongs,
      userPlaylists: userPlaylists,
      themeMode: themeMode,
    );
  }
}
