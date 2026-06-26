import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'library_service.dart' show libraryProvider, RemoteLibrary;

/// Auth API client for desktop app
class AuthService {
  final Dio _dio;
  static const _baseUrl = 'http://60.205.218.90:8787/api';

  AuthService({Dio? dio})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: _baseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 10),
            ),
          );

  Future<AuthResult> login(String username, String password) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'username': username, 'password': password},
    );
    return AuthResult.fromJson(response.data ?? {});
  }

  Future<AuthResult> register(
    String username,
    String password, {
    String? nickname,
  }) async {
    final data = {
      'username': username,
      'password': password,
      if (nickname?.trim().isNotEmpty == true) 'nickname': nickname!.trim(),
    };
    final response = await _dio.post<Map<String, dynamic>>(
      '/auth/register',
      data: data,
    );
    return AuthResult.fromJson(response.data ?? {});
  }

  Future<void> logout(String token) async {
    await _dio.post<void>(
      '/auth/logout',
      options: Options(headers: {'Authorization': 'Bearer $token'}),
    );
  }

  Future<UserInfo> getMe(String token) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/me',
      options: Options(headers: {'Authorization': 'Bearer $token'}),
    );
    final json = response.data ?? {};
    return UserInfo.fromJson(_mapValue(json['user']) ?? {});
  }
}

class AuthResult {
  final UserInfo user;
  final String token;
  final RemoteLibrary? library;

  AuthResult({required this.user, required this.token, this.library});

  factory AuthResult.fromJson(Map<String, dynamic> json) {
    return AuthResult(
      user: UserInfo.fromJson(_mapValue(json['user']) ?? {}),
      token: json['token']?.toString() ?? '',
      library: json['library'] != null
          ? RemoteLibrary.fromJson(_mapValue(json['library']) ?? {})
          : null,
    );
  }
}

class UserInfo {
  final int id;
  final String username;
  final String nickname;
  final String avatarText;
  final String avatarUrl;

  UserInfo({
    required this.id,
    required this.username,
    required this.nickname,
    required this.avatarText,
    this.avatarUrl = '',
  });

  factory UserInfo.fromJson(Map<String, dynamic> json) {
    final username = json['username']?.toString() ?? '';
    return UserInfo(
      id: _intValue(json['id']),
      username: username,
      nickname: json['nickname']?.toString() ?? username,
      avatarText:
          json['avatarText']?.toString() ??
          (username.isNotEmpty ? username[0].toUpperCase() : 'A'),
      avatarUrl:
          _stringValue(json['avatarUrl']) ??
          _stringValue(json['avatar']) ??
          _stringValue(json['avatar_url']) ??
          '',
    );
  }
}

String? _stringValue(Object? value) {
  final text = value?.toString().trim();
  return text == null || text.isEmpty ? null : text;
}

Map<String, dynamic>? _mapValue(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.cast<String, dynamic>();
  return null;
}

int _intValue(Object? value) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

/// Auth state provider
class AuthState {
  final UserInfo? user;
  final String? token;
  final bool isLoading;

  AuthState({this.user, this.token, this.isLoading = false});

  bool get isLoggedIn => user != null && token != null;

  AuthState copyWith({UserInfo? user, String? token, bool? isLoading}) {
    return AuthState(
      user: user ?? this.user,
      token: token ?? this.token,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

class AuthNotifier extends StateNotifier<AuthState> {
  final AuthService _authService;
  final SharedPreferences _prefs;
  final Ref _ref;

  AuthNotifier(this._authService, this._prefs, this._ref) : super(AuthState()) {
    _loadStoredAuth();
  }

  Future<void> _loadStoredAuth() async {
    final token = _prefs.getString('auth_token');
    if (token == null || token.isEmpty) return;

    try {
      final user = await _authService.getMe(token);
      state = AuthState(user: user, token: token);
      try {
        await _ref.read(libraryProvider.notifier).loadLibrary(token);
      } catch (_) {}
    } catch (e) {
      await _prefs.remove('auth_token');
    }
  }

  Future<void> login(String username, String password) async {
    state = state.copyWith(isLoading: true);
    try {
      final result = await _authService.login(username, password);
      await _prefs.setString('auth_token', result.token);
      state = AuthState(user: result.user, token: result.token);

      // Set library from login response if available
      if (result.library != null) {
        try {
          // Import library_service to access libraryProvider
          // This will be resolved at import time
          final libraryNotifier = _ref.read(libraryProvider.notifier);
          libraryNotifier.setLibraryFromLogin(result.library!);
        } catch (_) {
          // Silently fail if library provider is not available yet
        }
      }
    } catch (e) {
      state = AuthState();
      rethrow;
    }
  }

  Future<void> register(
    String username,
    String password, {
    String? nickname,
  }) async {
    state = state.copyWith(isLoading: true);
    try {
      final result = await _authService.register(
        username,
        password,
        nickname: nickname,
      );
      await _prefs.setString('auth_token', result.token);
      state = AuthState(user: result.user, token: result.token);
      if (result.library != null) {
        try {
          _ref
              .read(libraryProvider.notifier)
              .setLibraryFromLogin(result.library!);
        } catch (_) {}
      }
    } catch (e) {
      state = AuthState();
      rethrow;
    }
  }

  Future<void> logout() async {
    if (state.token != null) {
      try {
        await _authService.logout(state.token!);
      } catch (_) {}
    }
    await _prefs.remove('auth_token');
    try {
      _ref.read(libraryProvider.notifier).clearAccountLibrary();
    } catch (_) {}
    state = AuthState();
  }
}

final authServiceProvider = Provider<AuthService>((ref) => AuthService());

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  throw UnimplementedError('Must be overridden with SharedPreferences');
});
