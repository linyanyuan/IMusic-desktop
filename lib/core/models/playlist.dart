import 'song.dart';

class Playlist {
  final String id;
  final String title;
  final String subtitle;
  final String source;
  final int songCount;
  final String? coverUrl;
  final List<Song> songs;

  const Playlist({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.source,
    required this.songCount,
    this.coverUrl,
    this.songs = const [],
  });
}