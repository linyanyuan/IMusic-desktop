import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/models/song.dart';

const _productionDeepVibeApiBaseUrl = 'http://60.205.218.90:8787/api';
const _defaultDeepVibeApiBaseUrl = String.fromEnvironment(
  'DEEPVIBE_API_BASE_URL',
  defaultValue: _productionDeepVibeApiBaseUrl,
);

class PersonalizedRecommendations {
  final String profileSummary;
  final List<String> songQueries;
  final List<String> playlistQueries;

  const PersonalizedRecommendations({
    required this.profileSummary,
    required this.songQueries,
    required this.playlistQueries,
  });

  const PersonalizedRecommendations.empty()
    : profileSummary = '',
      songQueries = const [],
      playlistQueries = const [];

  factory PersonalizedRecommendations.fromJson(Map<String, dynamic> json) {
    return PersonalizedRecommendations(
      profileSummary: json['profileSummary']?.toString() ?? '',
      songQueries: _stringList(json['songQueries']).take(8).toList(),
      playlistQueries: _stringList(json['playlistQueries']).take(8).toList(),
    );
  }

  bool get isEmpty => songQueries.isEmpty && playlistQueries.isEmpty;
}

class RecommendationService {
  static const productionBaseUrl = _productionDeepVibeApiBaseUrl;
  static const defaultBaseUrl = _defaultDeepVibeApiBaseUrl;

  RecommendationService({Dio? dio, String baseUrl = _defaultDeepVibeApiBaseUrl})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: resolveBaseUrl(baseUrl),
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 10),
            ),
          );

  final Dio _dio;

  static String resolveBaseUrl(String configuredUrl) {
    final trimmed = configuredUrl.trim();
    return trimmed.isEmpty ? productionBaseUrl : trimmed;
  }

  Future<PersonalizedRecommendations> getPersonalizedRecommendations(
    String token, {
    required List<Song> history,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/recommendations/personalized',
      data: {'history': _recommendationHistory(history)},
      options: Options(headers: {'Authorization': 'Bearer $token'}),
    );
    final json = response.data ?? const {};
    return PersonalizedRecommendations.fromJson(
      _mapValue(json['recommendations']) ?? const {},
    );
  }
}

final recommendationServiceProvider = Provider<RecommendationService>((ref) {
  return RecommendationService();
});

List<String> _stringList(Object? value) {
  if (value is! List) return const [];
  return value
      .map((item) => item?.toString().trim() ?? '')
      .where((item) => item.isNotEmpty)
      .toList();
}

Map<String, dynamic>? _mapValue(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.cast<String, dynamic>();
  return null;
}

List<Map<String, dynamic>> _recommendationHistory(List<Song> history) {
  return history
      .take(50)
      .map(_recommendationHistoryItem)
      .whereType<Map<String, dynamic>>()
      .toList();
}

Map<String, dynamic>? _recommendationHistoryItem(Song song) {
  final title = song.title.trim();
  if (title.isEmpty) return null;

  return {
    'title': title,
    if (song.artist.trim().isNotEmpty) 'artist': song.artist.trim(),
    if (song.source.trim().isNotEmpty) 'source': song.source.trim(),
    if (song.duration.trim().isNotEmpty) 'duration': song.duration.trim(),
  };
}
