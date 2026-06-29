import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_selector/file_selector.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:path_provider/path_provider.dart';
import 'dart:convert';

import 'shortcut_settings.dart';

class AppSettings {
  final String cacheDirectory;
  final double lyricsFontSize;
  final int lyricsColorValue;
  final ShortcutSettings shortcutSettings;

  const AppSettings({
    this.cacheDirectory = '',
    this.lyricsFontSize = 22,
    this.lyricsColorValue = 0xFF1ED760,
    this.shortcutSettings = const ShortcutSettings(
      shortcuts: defaultShortcutBindings,
    ),
  });

  AppSettings copyWith({
    String? cacheDirectory,
    double? lyricsFontSize,
    int? lyricsColorValue,
    ShortcutSettings? shortcutSettings,
  }) {
    return AppSettings(
      cacheDirectory: cacheDirectory ?? this.cacheDirectory,
      lyricsFontSize: lyricsFontSize ?? this.lyricsFontSize,
      lyricsColorValue: lyricsColorValue ?? this.lyricsColorValue,
      shortcutSettings: shortcutSettings ?? this.shortcutSettings,
    );
  }
}

class AppSettingsNotifier extends StateNotifier<AppSettings> {
  AppSettingsNotifier() : super(const AppSettings()) {
    _load();
  }

  static const _cacheDirectoryKey = 'settings_cache_directory';
  static const _lyricsFontSizeKey = 'settings_lyrics_font_size';
  static const _lyricsColorKey = 'settings_lyrics_color';
  static const _shortcutSettingsKey = 'settings_shortcuts';

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    state = AppSettings(
      cacheDirectory: prefs.getString(_cacheDirectoryKey) ?? '',
      lyricsFontSize:
          prefs.getDouble(_lyricsFontSizeKey) ??
          const AppSettings().lyricsFontSize,
      lyricsColorValue:
          prefs.getInt(_lyricsColorKey) ?? const AppSettings().lyricsColorValue,
      shortcutSettings: _loadShortcutSettings(prefs),
    );
  }

  ShortcutSettings _loadShortcutSettings(SharedPreferences prefs) {
    final raw = prefs.getString(_shortcutSettingsKey);
    if (raw == null || raw.trim().isEmpty) return ShortcutSettings.defaults();
    try {
      final json = jsonDecode(raw);
      if (json is Map<String, dynamic>) return ShortcutSettings.fromJson(json);
      if (json is Map) {
        return ShortcutSettings.fromJson(json.cast<String, dynamic>());
      }
    } catch (_) {}
    return ShortcutSettings.defaults();
  }

  Future<void> setCacheDirectory(String value) async {
    final normalized = value.trim();
    state = state.copyWith(cacheDirectory: normalized);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_cacheDirectoryKey, normalized);
  }

  Future<void> useDefaultCacheDirectory() async {
    await setCacheDirectory('');
  }

  Future<void> setLyricsFontSize(double value) async {
    final normalized = value.clamp(16.0, 32.0).toDouble();
    state = state.copyWith(lyricsFontSize: normalized);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_lyricsFontSizeKey, normalized);
  }

  Future<void> setLyricsColorValue(int value) async {
    state = state.copyWith(lyricsColorValue: value);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_lyricsColorKey, value);
  }

  Future<void> setShortcutSettings(ShortcutSettings value) async {
    state = state.copyWith(shortcutSettings: value);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_shortcutSettingsKey, jsonEncode(value.toJson()));
  }
}

typedef CacheDirectoryPicker = Future<String?> Function();

final cacheDirectoryPickerProvider = Provider<CacheDirectoryPicker>((ref) {
  return () => getDirectoryPath(confirmButtonText: '选择此文件夹');
});

/// Provider that returns the actual default cache directory path
final defaultCacheDirectoryProvider = FutureProvider<String>((ref) async {
  try {
    final tempDir = await getTemporaryDirectory();
    return tempDir.path;
  } catch (e) {
    return '（无法获取默认路径）';
  }
});

final appSettingsProvider =
    StateNotifierProvider<AppSettingsNotifier, AppSettings>(
      (ref) => AppSettingsNotifier(),
    );
