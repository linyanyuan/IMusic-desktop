import 'dart:async';

import 'package:dio/dio.dart';
import '../shared/collection_lyrics.dart';
import 'music_provider.dart';

/// Bilibili music provider - provides playback URLs and search from Bilibili
class BilibiliMusicProvider implements MusicProvider, PlaylistSummaryProvider {
  BilibiliMusicProvider({
    Dio? dio,
    Dio? gatewayDio,
    Dio? subtitleDio,
    Duration recommendationTimeout = const Duration(seconds: 3),
  }) : _dio =
           dio ??
           Dio(
             BaseOptions(
               baseUrl: 'https://api.bilibili.com',
               headers: _defaultHeaders,
               connectTimeout: const Duration(seconds: 15),
               receiveTimeout: const Duration(seconds: 15),
             ),
           ),
       _gatewayDio =
           gatewayDio ??
           Dio(
             BaseOptions(
               baseUrl: 'https://gateway.karpov.cn/api/proxy',
               headers: {
                 'Accept': 'application/json',
                 'User-Agent': _defaultHeaders['User-Agent']!,
               },
               connectTimeout: recommendationTimeout,
               receiveTimeout: recommendationTimeout,
               sendTimeout: recommendationTimeout,
             ),
           ),
       _subtitleDio = subtitleDio ?? Dio(),
       _recommendationTimeout = recommendationTimeout;

  static const _defaultHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Origin': 'https://www.bilibili.com',
    'Referer': 'https://www.bilibili.com/',
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };

  final Dio _dio;
  final Dio _gatewayDio;
  final Dio _subtitleDio;
  final Duration _recommendationTimeout;
  final Map<String, String> _cidByPlaybackId = {};

  /// Expose dio instance for downloading audio with headers
  Dio get dio => _dio;

  @override
  void rememberSongs(Iterable<Map<String, dynamic>> songs) {
    // No-op for Bilibili provider - caching is handled by MusicService
  }

  @override
  Future<List<Map<String, dynamic>>> searchSongs(String query) async {
    if (query.trim().isEmpty) return [];

    try {
      print('[BilibiliMusicProvider] searchSongs - 查询: $query');
      final response = await _dio.get<Map<String, dynamic>>(
        '/x/web-interface/wbi/search/type',
        queryParameters: {'search_type': 'video', 'keyword': query, 'page': 1},
      );

      print(
        '[BilibiliMusicProvider] searchSongs - 响应状态: ${response.statusCode}',
      );
      final data = response.data?['data'];
      final result = data?['result'] as List?;
      print(
        '[BilibiliMusicProvider] searchSongs - 结果数量: ${result?.length ?? 0}',
      );
      if (result == null) return [];

      final songs = result.whereType<Map<String, dynamic>>().map((item) {
        final bvid = item['bvid']?.toString() ?? '';
        final title = _stripHtmlTags(item['title']?.toString() ?? '未知标题');
        final author = item['author']?.toString() ?? '未知UP主';
        final durationValue = item['duration'];
        final duration = _parseDurationSeconds(durationValue);
        final pic = item['pic']?.toString() ?? '';
        final quotedTitles = extractQuotedSongTitles(title);
        final isPlaylist = _looksLikeCollection(title, duration);

        return {
          'id': 'bilibili:$bvid',
          'title': title,
          'artist': author,
          'source': 'bilibili',
          'sourceLabel': 'B站',
          'duration': duration * 1000, // 转为毫秒
          'coverUrl': pic.startsWith('//') ? 'https:$pic' : pic,
          'resultType': isPlaylist ? 'playlist' : 'song',
          'songCount': isPlaylist ? quotedTitles.length : 1,
        };
      }).toList();

      print('[BilibiliMusicProvider] searchSongs - 返回歌曲: ${songs.length} 首');
      return songs;
    } catch (e) {
      print('[BilibiliMusicProvider] searchSongs - 失败: $e');
      return [];
    }
  }

  @override
  Future<List<Map<String, dynamic>>> getRecommendedSongs() async {
    print('[BilibiliMusicProvider] getRecommendedSongs - 开始获取推荐歌曲');

    try {
      print('[BilibiliMusicProvider] 请求 Gateway API: /qqmusic/search/songs');

      final response = await _gatewayDio
          .get<Map<String, dynamic>>(
            '/qqmusic/search/songs',
            queryParameters: {'q': '热门', 'page': 1, 'page_size': 30},
          )
          .timeout(_recommendationTimeout);

      final data = response.data;
      final songs = (data?['songs'] as List?) ?? [];

      print('[BilibiliMusicProvider] Gateway 返回 ${songs.length} 首歌曲');

      return songs.whereType<Map<String, dynamic>>().map((item) {
        return {
          'id': item['id']?.toString() ?? '',
          'title': item['title']?.toString() ?? '未知标题',
          'artist': item['artist']?.toString() ?? '未知艺人',
          'source': 'qqmusic',
          'sourceLabel': 'QQ音乐',
          'duration': item['duration'] as int? ?? 0,
          'coverUrl': item['coverUrl']?.toString(),
          'playbackSource': 'bilibili',
          'resultType': 'song',
        };
      }).toList();
    } catch (e) {
      print('[BilibiliMusicProvider] Gateway API 失败: $e，降级使用 Bilibili 搜索');
      // 如果 Gateway 失败，降级使用 Bilibili 搜索
      return _searchBilibiliRecommended();
    }
  }

  Future<List<Map<String, dynamic>>> _searchBilibiliRecommended() async {
    print(
      '[BilibiliMusicProvider] _searchBilibiliRecommended - 使用 Bilibili 降级方案',
    );

    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/x/web-interface/wbi/search/type',
        queryParameters: {
          'search_type': 'video',
          'keyword': '热门音乐',
          'page': 1,
          'order': 'totalrank',
        },
      );

      final data = response.data?['data'];
      final result = data?['result'] as List?;
      if (result == null) {
        print('[BilibiliMusicProvider] Bilibili 搜索返回空结果');
        return [];
      }

      final songs = result.whereType<Map<String, dynamic>>().take(20).map((
        item,
      ) {
        final bvid = item['bvid']?.toString() ?? '';
        final title = _stripHtmlTags(item['title']?.toString() ?? '未知标题');
        final author = item['author']?.toString() ?? '未知UP主';

        final duration = _parseDurationSeconds(item['duration']);
        final pic = item['pic']?.toString() ?? '';
        final quotedTitles = extractQuotedSongTitles(title);
        final isPlaylist = _looksLikeCollection(title, duration);

        return {
          'id': 'bilibili:$bvid',
          'title': title,
          'artist': author,
          'source': 'bilibili',
          'sourceLabel': 'B站',
          'duration': duration * 1000, // 转换为毫秒
          'coverUrl': pic.startsWith('//') ? 'https:$pic' : pic,
          'resultType': isPlaylist ? 'playlist' : 'song',
          'songCount': isPlaylist ? quotedTitles.length : 1,
        };
      }).toList();

      print('[BilibiliMusicProvider] Bilibili 降级返回 ${songs.length} 首歌曲');
      return songs;
    } catch (e) {
      print('[BilibiliMusicProvider] Bilibili 降级也失败: $e');
      return [];
    }
  }

  @override
  Future<List<Map<String, dynamic>>> getHotPlaylists({
    int? limit,
    int? offset,
  }) async {
    try {
      // 计算页码（offset 是已加载数量，pageSize 跟随调用方的 limit）
      final pageSize = limit ?? 10;
      final page = ((offset ?? 0) ~/ pageSize) + 1;

      // 搜索音乐合集类视频
      final response = await _dio.get<Map<String, dynamic>>(
        '/x/web-interface/wbi/search/type',
        queryParameters: {
          'search_type': 'video',
          'keyword': '音乐合集',
          'page': page,
          'duration': 4, // 60分钟以上的视频（更可能是合集）
        },
      );

      final data = response.data?['data'];
      final result = data?['result'] as List?;
      if (result == null) return [];

      return result.whereType<Map<String, dynamic>>().take(limit ?? 10).map((
        item,
      ) {
        final bvid = item['bvid']?.toString() ?? '';
        final title = _stripHtmlTags(item['title']?.toString() ?? '未知歌单');
        final author = item['author']?.toString() ?? '未知UP主';
        final pic = item['pic']?.toString() ?? '';

        return {
          'id': 'bilibili:$bvid',
          'title': title,
          'subtitle': author,
          'source': 'bilibili',
          'sourceLabel': 'B站',
          'resultType': 'playlist',
          'songCount': 0, // 需要调用 getPlaylist 才能获取实际数量
          'coverUrl': pic.startsWith('//') ? 'https:$pic' : pic,
        };
      }).toList();
    } catch (e) {
      return [];
    }
  }

  @override
  Future<Map<String, dynamic>> getPlaylist(String id, {int? limit}) async {
    final bvid = _extractBvid(id);

    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/x/web-interface/view',
        queryParameters: {'bvid': bvid},
      );

      final data = response.data?['data'];
      final title = _stripHtmlTags(data?['title']?.toString() ?? '未知歌单');
      final owner = data?['owner'];
      final author = owner?['name']?.toString() ?? '未知UP主';
      final pic = data?['pic']?.toString() ?? '';

      // Get pages (songs in the playlist)
      final pagesResponse = await _dio.get<Map<String, dynamic>>(
        '/x/player/pagelist',
        queryParameters: {'bvid': bvid, 'jsonp': 'jsonp'},
      );

      final pages = (pagesResponse.data?['data'] as List?) ?? [];
      final songs = pages
          .whereType<Map<String, dynamic>>()
          .take(limit ?? 100)
          .map((page) {
            final pageNum = page['page'] as int? ?? 1;
            final playbackId = 'bilibili:$bvid:p$pageNum';
            final cid = page['cid']?.toString() ?? '';
            final partTitle = page['part']?.toString() ?? title;
            final pageDuration = (page['duration'] as int?) ?? 0;

            return {
              'id': playbackId,
              'title': partTitle,
              'artist': author,
              'source': 'bilibili',
              'sourceLabel': 'B站',
              'playbackId': playbackId,
              'playbackSource': 'bilibili',
              'playbackSourceLabel': 'B站',
              'playbackSourceId': playbackId,
              'sourceId': playbackId,
              'bvid': bvid,
              'page': pageNum,
              if (cid.isNotEmpty) 'cid': cid,
              'pageUrl': 'https://www.bilibili.com/video/$bvid?p=$pageNum',
              'resultType': 'song',
              'duration': pageDuration * 1000,
              'coverUrl': pic.startsWith('//') ? 'https:$pic' : pic,
            };
          })
          .toList();

      return {
        'id': id,
        'title': title,
        'subtitle': '$author · ${songs.length} 首歌曲',
        'source': 'bilibili',
        'songCount': songs.length,
        'coverUrl': pic.startsWith('//') ? 'https:$pic' : pic,
        'songs': songs,
      };
    } catch (e) {
      throw Exception('获取歌单失败: $e');
    }
  }

  @override
  Future<PlaylistSummary> getPlaylistSummary(
    Map<String, dynamic> playlist,
  ) async {
    final id =
        playlist['playbackId']?.toString().trim() ??
        playlist['id']?.toString().trim() ??
        '';
    final bvid = _extractBvid(id);
    if (bvid.isEmpty) return const PlaylistSummary.unavailable();

    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/x/player/pagelist',
        queryParameters: {'bvid': bvid, 'jsonp': 'jsonp'},
      );
      final pages =
          (response.data?['data'] as List?)
              ?.whereType<Map<String, dynamic>>()
              .toList() ??
          const <Map<String, dynamic>>[];
      if (pages.isEmpty) return const PlaylistSummary.unavailable();

      final durationSeconds = pages.fold<int>(
        0,
        (total, page) => total + (page['duration'] as int? ?? 0),
      );
      final kind = pages.length > 1
          ? PlaylistSummaryKind.multiPage
          : durationSeconds >= 20 * 60
          ? PlaylistSummaryKind.singleLongCollection
          : PlaylistSummaryKind.singlePageCollection;
      return PlaylistSummary(
        kind: kind,
        songCount: pages.length,
        durationSeconds: durationSeconds,
      );
    } catch (_) {
      return const PlaylistSummary.unavailable();
    }
  }

  @override
  Future<Map<String, dynamic>> getSongDetail(String id) async {
    final bvid = _extractBvid(id);

    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/x/web-interface/view',
        queryParameters: {'bvid': bvid},
      );

      final data = response.data?['data'];
      final title = _stripHtmlTags(data?['title']?.toString() ?? '未知标题');
      final owner = data?['owner'];
      final author = owner?['name']?.toString() ?? '未知UP主';
      final pic = data?['pic']?.toString() ?? '';
      final duration = (data?['duration'] as int?) ?? 0;

      return {
        'id': id,
        'title': title,
        'artist': author,
        'source': 'bilibili',
        'sourceLabel': 'B站',
        'resultType': 'song',
        'duration': duration * 1000,
        'coverUrl': pic.startsWith('//') ? 'https:$pic' : pic,
      };
    } catch (e) {
      throw Exception('获取歌曲详情失败: $e');
    }
  }

  @override
  Future<PlaybackUrl> getPlayUrl(String id) async {
    print('[BilibiliMusicProvider] getPlayUrl - ID: $id');

    final parts = id.split(':');
    final bvid = parts.length > 1 ? parts[1] : id;
    final page = parts.length > 2 ? _parsePage(parts[2]) : 1;

    print('[BilibiliMusicProvider] 解析 ID: bvid=$bvid, page=$page');

    try {
      // Get CID
      print('[BilibiliMusicProvider] 获取 CID...');
      final pagesResponse = await _dio.get<Map<String, dynamic>>(
        '/x/player/pagelist',
        queryParameters: {'bvid': bvid, 'jsonp': 'jsonp'},
      );

      final pages = (pagesResponse.data?['data'] as List?) ?? [];
      final targetPage = pages
          .whereType<Map<String, dynamic>>()
          .elementAtOrNull(page - 1);
      final cid = targetPage?['cid']?.toString();

      if (cid == null) {
        print('[BilibiliMusicProvider] 未找到 CID');
        throw Exception('未找到视频分P信息');
      }

      print('[BilibiliMusicProvider] CID: $cid');
      _cidByPlaybackId[id] = cid;
      _cidByPlaybackId['bilibili:$bvid:p$page'] = cid;

      // Get play URL
      print('[BilibiliMusicProvider] 获取播放 URL...');
      final playResponse = await _dio.get<Map<String, dynamic>>(
        '/x/player/playurl',
        queryParameters: {
          'bvid': bvid,
          'cid': cid,
          'qn': 64,
          'fnval': 16,
          'fourk': 1,
        },
        options: Options(
          headers: {
            ..._defaultHeaders,
            'Referer': 'https://www.bilibili.com/video/$bvid',
          },
        ),
      );

      final data = playResponse.data?['data'];

      // 使用移动端的解析逻辑：优先 dash.audio，降级到 durl
      String? url;

      // 1. 尝试从 dash.audio 获取（高质量音频流）
      final dash = data?['dash'];
      if (dash != null && dash is Map) {
        final audios = (dash['audio'] as List?)?.whereType<Map>().toList();
        if (audios != null && audios.isNotEmpty) {
          // 按带宽排序，选择最高质量
          audios.sort((a, b) {
            final bandwidthA = a['bandwidth'] is int
                ? a['bandwidth'] as int
                : 0;
            final bandwidthB = b['bandwidth'] is int
                ? b['bandwidth'] as int
                : 0;
            return bandwidthB.compareTo(bandwidthA);
          });

          // 获取所有可用的音频 URL
          for (final audio in audios) {
            final urls = <String>[
              audio['baseUrl']?.toString() ?? '',
              audio['base_url']?.toString() ?? '',
            ];

            // 添加备用 URL
            for (final key in ['backupUrl', 'backup_url']) {
              final value = audio[key];
              if (value is List) {
                urls.addAll(value.map((item) => item.toString()));
              } else if (value != null) {
                urls.add(value.toString());
              }
            }

            final validUrls = urls.where((u) => u.trim().isNotEmpty).toList();
            if (validUrls.isEmpty) continue;

            // 优先选择非 mcdn.bilivideo 的 URL
            final preferredUrl = validUrls.firstWhere((u) {
              final host = Uri.tryParse(u)?.host.toLowerCase() ?? '';
              return !host.contains('mcdn.bilivideo');
            }, orElse: () => validUrls.first);

            if (preferredUrl.isNotEmpty) {
              url = preferredUrl;
              print('[BilibiliMusicProvider] 从 dash.audio 获取 URL: $url');
              break;
            }
          }
        }
      }

      // 2. 如果 dash 为空，降级到 durl
      if ((url == null || url.isEmpty)) {
        final durls = (data?['durl'] as List?)?.whereType<Map>().toList();
        if (durls != null && durls.isNotEmpty) {
          url = durls.first['url']?.toString();
          print('[BilibiliMusicProvider] 从 durl 获取 URL: $url');
        }
      }

      print('[BilibiliMusicProvider] 最终播放 URL: $url');

      if (url == null || url.isEmpty) {
        final message = data?['message']?.toString() ?? '未获取到播放地址';
        print('[BilibiliMusicProvider] 失败: $message');
        throw Exception(message);
      }

      print('[BilibiliMusicProvider] getPlayUrl 成功');
      return PlaybackUrl(
        url,
        headers: {
          'Referer': 'https://www.bilibili.com/video/$bvid',
          'User-Agent': _defaultHeaders['User-Agent']!,
        },
        resolvedId: id,
      );
    } catch (e) {
      print('[BilibiliMusicProvider] getPlayUrl 失败: $e');
      throw Exception('获取播放地址失败: $e');
    }
  }

  /// Get lyrics from Bilibili CC subtitles
  Future<String> _getLyrics(String bvid, String cid) async {
    try {
      // Get subtitle info
      final playerResponse = await _dio.get<Map<String, dynamic>>(
        '/x/player/v2',
        queryParameters: {'bvid': bvid, 'cid': cid},
        options: Options(
          headers: {
            ..._defaultHeaders,
            'Referer': 'https://www.bilibili.com/video/$bvid',
          },
        ),
      );

      final data = playerResponse.data?['data'];
      final subtitle = data?['subtitle'];
      final subtitles = (subtitle?['subtitles'] as List?) ?? [];

      if (subtitles.isEmpty) return '';

      // Get first subtitle URL
      final firstSubtitle = subtitles
          .whereType<Map<String, dynamic>>()
          .firstOrNull;
      var subtitleUrl = firstSubtitle?['subtitle_url']?.toString() ?? '';
      if (subtitleUrl.isEmpty) return '';

      // Normalize URL
      if (subtitleUrl.startsWith('//')) {
        subtitleUrl = 'https:$subtitleUrl';
      }

      // Download subtitle content
      final subtitleResponse = await _subtitleDio.get<Map<String, dynamic>>(
        subtitleUrl,
      );

      // Parse subtitle body
      final body = (subtitleResponse.data?['body'] as List?) ?? [];
      final lines = body
          .whereType<Map<String, dynamic>>()
          .map((item) => item['content']?.toString().trim() ?? '')
          .where((line) => line.isNotEmpty)
          .join('\n');

      print('[BilibiliMusicProvider] 获取歌词成功，长度: ${lines.length}');
      return lines;
    } catch (e) {
      print('[BilibiliMusicProvider] 获取歌词失败: $e');
      return '';
    }
  }

  @override
  Future<String> getLyrics(Map<String, dynamic> song) async {
    final existing = song['lyrics']?.toString().trim() ?? '';
    if (existing.isNotEmpty) return existing;

    final playbackId =
        song['playbackId']?.toString().trim() ??
        song['id']?.toString().trim() ??
        '';
    if (playbackId.isEmpty) return '';

    final bvid = song['bvid']?.toString().trim().isNotEmpty == true
        ? song['bvid'].toString().trim()
        : _extractBvid(playbackId);
    final parts = playbackId.split(':');
    final page = parts.length > 2 ? _parsePage(parts[2]) : 1;
    var cid = song['cid']?.toString().trim() ?? '';
    if (cid.isEmpty) cid = _cidByPlaybackId[playbackId] ?? '';

    if (cid.isEmpty) {
      final pagesResponse = await _dio.get<Map<String, dynamic>>(
        '/x/player/pagelist',
        queryParameters: {'bvid': bvid, 'jsonp': 'jsonp'},
      );
      final pages = (pagesResponse.data?['data'] as List?) ?? [];
      cid =
          pages
              .whereType<Map<String, dynamic>>()
              .elementAtOrNull(page - 1)?['cid']
              ?.toString() ??
          '';
      if (cid.isEmpty) return '';
      _cidByPlaybackId[playbackId] = cid;
    }

    return _getLyrics(bvid, cid);
  }

  String _extractBvid(String id) {
    if (id.startsWith('bilibili:')) {
      final parts = id.substring(9).split(':');
      return parts.first;
    }
    return id;
  }

  int _parsePage(String value) {
    final page = int.tryParse(value.replaceFirst(RegExp(r'^[pP]'), '')) ?? 1;
    return page < 1 ? 1 : page;
  }

  String _stripHtmlTags(String html) {
    return html
        .replaceAll(RegExp(r'<em[^>]*>'), '')
        .replaceAll(RegExp(r'</em>'), '')
        .replaceAll(RegExp(r'<[^>]+>'), '')
        .trim();
  }

  int _parseDurationSeconds(Object? value) {
    if (value is int) return value;
    if (value is num) return value.round();
    final text = value?.toString().trim() ?? '';
    if (text.isEmpty) return 0;

    if (!text.contains(':')) return int.tryParse(text) ?? 0;

    final parts = text
        .split(':')
        .map((part) => int.tryParse(part) ?? 0)
        .toList();
    if (parts.length == 2) return parts[0] * 60 + parts[1];
    if (parts.length == 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  bool _looksLikeCollection(String title, int durationSeconds) {
    final quotedCount = extractQuotedSongTitles(title).length;
    if (quotedCount > 1) return true;

    final normalized = title.toLowerCase();
    if (RegExp(
      r'(合集|歌单|精选|串烧|盘点|多首|全\d+首|音乐包|playlist|collection)',
      caseSensitive: false,
    ).hasMatch(normalized)) {
      return true;
    }

    if (durationSeconds >= 20 * 60 &&
        RegExp(
          r'(音乐|歌曲|热歌|华语|流行|抖音|伤感|车载|bgm)',
          caseSensitive: false,
        ).hasMatch(normalized)) {
      return true;
    }

    return false;
  }
}
