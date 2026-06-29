import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:deepvibe_desktop/services/auth_service.dart';
import 'package:deepvibe_desktop/services/library_service.dart';

void main() {
  test('UserInfo accepts avatar URL aliases from the API', () {
    expect(
      UserInfo.fromJson({
        'id': 1,
        'username': 'tester',
        'avatarUrl': 'https://example.test/avatar-a.png',
      }).avatarUrl,
      'https://example.test/avatar-a.png',
    );

    expect(
      UserInfo.fromJson({
        'id': 1,
        'username': 'tester',
        'avatar': 'https://example.test/avatar-b.png',
      }).avatarUrl,
      'https://example.test/avatar-b.png',
    );

    expect(
      UserInfo.fromJson({
        'id': 1,
        'username': 'tester',
        'avatar_url': 'https://example.test/avatar-c.png',
      }).avatarUrl,
      'https://example.test/avatar-c.png',
    );

    expect(
      UserInfo.fromJson({
        'id': 1,
        'username': 'tester',
        'avatar': '/uploads/avatar-d.png',
      }).avatarUrl,
      'http://60.205.218.90:8787/uploads/avatar-d.png',
    );
  });

  test('register stores token and applies returned account library', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final authService = _FakeRegisterAuthService();
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(_FakeLibraryService(), ref, prefs),
        ),
        authProvider.overrideWith(
          (ref) => AuthNotifier(authService, prefs, ref),
        ),
      ],
    );
    addTearDown(container.dispose);

    await container
        .read(authProvider.notifier)
        .register('new-user', 'secret123', nickname: '新用户');

    expect(authService.registeredUsername, 'new-user');
    expect(authService.registeredNickname, '新用户');
    expect(container.read(authProvider).isLoggedIn, isTrue);
    expect(prefs.getString('auth_token'), 'registered-token');
    expect(
      container.read(libraryProvider).userPlaylists.single['name'],
      '注册歌单',
    );
  });

  test('logout clears remote account library state', () async {
    SharedPreferences.setMockInitialValues({'auth_token': 'token'});
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(
      overrides: [
        libraryProvider.overrideWith(
          (ref) => LibraryNotifier(_FakeLibraryService(), ref, prefs),
        ),
        authProvider.overrideWith(
          (ref) => AuthNotifier(_FakeRegisterAuthService(), prefs, ref),
        ),
      ],
    );
    addTearDown(container.dispose);

    container
        .read(libraryProvider.notifier)
        .setLibraryFromLogin(
          const RemoteLibrary(
            likedSongs: [],
            userPlaylists: [
              {'id': 'playlist-1', 'name': '账户歌单'},
            ],
            themeMode: 'light',
          ),
        );

    await container.read(authProvider.notifier).logout();

    expect(container.read(libraryProvider).userPlaylists, isEmpty);
    expect(container.read(libraryProvider).likedSongs, isEmpty);
  });
}

class _FakeRegisterAuthService extends AuthService {
  String? registeredUsername;
  String? registeredNickname;

  @override
  Future<AuthResult> register(
    String username,
    String password, {
    String? nickname,
  }) async {
    registeredUsername = username;
    registeredNickname = nickname;
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
        userPlaylists: [
          {'id': 'registered-playlist', 'name': '注册歌单'},
        ],
        themeMode: 'light',
      ),
    );
  }

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
}

class _FakeLibraryService extends LibraryService {
  @override
  Future<RemoteLibrary> getLibrary(String token) async {
    return const RemoteLibrary(
      likedSongs: [],
      userPlaylists: [],
      themeMode: 'light',
    );
  }
}
