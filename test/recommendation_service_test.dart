import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:deepvibe_desktop/core/models/song.dart';
import 'package:deepvibe_desktop/services/recommendation_service.dart';

void main() {
  test(
    'personalized recommendations send sanitized history with bearer token',
    () async {
      final dio = Dio(BaseOptions(baseUrl: 'http://example.test/api'));
      Map<String, dynamic>? sentBody;
      String? authorization;
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            sentBody = Map<String, dynamic>.from(options.data as Map);
            authorization = options.headers['Authorization']?.toString();
            handler.resolve(
              Response<Map<String, dynamic>>(
                requestOptions: options,
                statusCode: 200,
                data: const {
                  'recommendations': {
                    'profileSummary': '喜欢华语流行',
                    'songQueries': ['周杰伦 晴天'],
                    'playlistQueries': ['私人华语 歌单'],
                  },
                },
              ),
            );
          },
        ),
      );
      final service = RecommendationService(dio: dio);

      final recommendations = await service.getPersonalizedRecommendations(
        'token-123',
        history: [
          Song(
            id: 'song-1',
            title: ' 晴天 ',
            artist: ' 周杰伦 ',
            source: 'bilibili',
            duration: '4:29',
            coverUrl: 'https://example.test/cover.jpg',
            extra: const {
              'lyrics': '[00:00.00]不应发送',
              'playUrl': 'https://example.test/audio.m4s',
            },
          ),
        ],
      );

      expect(authorization, 'Bearer token-123');
      expect(sentBody, {
        'history': [
          {
            'title': '晴天',
            'artist': '周杰伦',
            'source': 'bilibili',
            'duration': '4:29',
          },
        ],
      });
      expect(recommendations.songQueries, ['周杰伦 晴天']);
      expect(recommendations.playlistQueries, ['私人华语 歌单']);
    },
  );
}
