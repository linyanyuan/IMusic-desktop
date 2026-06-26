/// UI-facing song model for the desktop shell.
///
/// Deliberately minimal for display, while preserving unknown raw fields so
/// songs restored from a user's library can still carry playback and lyrics
/// metadata back into the playback pipeline.
class Song {
  final String id;
  final String title;
  final String artist;
  final String source; // e.g. "Bilibili"
  final String? metaSource; // e.g. "Tencent Music metadata"
  final String duration;
  final String? coverUrl;
  final String resultType;
  final int songCount;
  bool isFavorite;
  final bool isCached;
  final Map<String, dynamic> extra;

  Song({
    required this.id,
    required this.title,
    required this.artist,
    required this.source,
    this.metaSource,
    required this.duration,
    this.coverUrl,
    this.resultType = 'song',
    this.songCount = 0,
    this.isFavorite = false,
    this.isCached = false,
    this.extra = const {},
  });

  bool get isPlaylist => resultType == 'playlist';

  /// Combined source label per Stitch prompt line 82:
  /// "Tencent Music metadata · Bilibili playback".
  String get sourceLabel =>
      metaSource == null ? source : '$metaSource · $source 播放';

  factory Song.fromJson(Map<String, dynamic> json) {
    final rawDuration = json['duration'];
    return Song(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString() ?? '未知歌曲',
      artist: json['artist']?.toString() ?? '未知艺人',
      source: json['source']?.toString() ?? 'Unknown',
      metaSource: json['metaSource']?.toString(),
      duration: rawDuration?.toString() ?? '0:00',
      coverUrl: json['coverUrl']?.toString(),
      resultType: json['resultType']?.toString() ?? 'song',
      songCount: json['songCount'] is int ? json['songCount'] as int : 0,
      isFavorite: json['isFavorite'] == true,
      isCached: json['isCached'] == true,
      extra: Map<String, dynamic>.from(json),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      ...extra,
      'id': id,
      'title': title,
      'artist': artist,
      'source': source,
      'metaSource': metaSource,
      'duration': extra.containsKey('duration') ? extra['duration'] : duration,
      'coverUrl': coverUrl,
      'resultType': resultType,
      'songCount': songCount,
      'isFavorite': isFavorite,
      'isCached': isCached,
    };
  }

  Song copyWith({
    String? id,
    String? title,
    String? artist,
    String? source,
    String? metaSource,
    String? duration,
    String? coverUrl,
    String? resultType,
    int? songCount,
    bool? isFavorite,
    bool? isCached,
    Map<String, dynamic>? extra,
  }) {
    return Song(
      id: id ?? this.id,
      title: title ?? this.title,
      artist: artist ?? this.artist,
      source: source ?? this.source,
      metaSource: metaSource ?? this.metaSource,
      duration: duration ?? this.duration,
      coverUrl: coverUrl ?? this.coverUrl,
      resultType: resultType ?? this.resultType,
      songCount: songCount ?? this.songCount,
      isFavorite: isFavorite ?? this.isFavorite,
      isCached: isCached ?? this.isCached,
      extra: extra ?? this.extra,
    );
  }
}
