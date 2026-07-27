Set<String> songIdentityValues(Map<String, dynamic> song) {
  return {
    for (final key in const [
      'id',
      'playbackId',
      'sourceId',
      'playbackSourceId',
    ])
      if ((song[key]?.toString().trim() ?? '').isNotEmpty)
        _canonicalSongIdentity(song[key].toString().trim()),
  };
}

bool songsShareIdentity(
  Map<String, dynamic> first,
  Map<String, dynamic> second,
) {
  final firstIds = songIdentityValues(first);
  return songIdentityValues(second).any(firstIds.contains);
}

String _canonicalSongIdentity(String id) {
  if (!id.startsWith('bilibili:')) return id;
  final parts = id.split(':');
  if (parts.length < 2 || parts[1].isEmpty) return id;
  if (parts.length == 2) return 'bilibili:${parts[1]}:p1';

  final page = int.tryParse(parts[2].replaceFirst(RegExp(r'^[pP]'), ''));
  if (page == null) return id;
  return 'bilibili:${parts[1]}:p${page < 1 ? 1 : page}';
}
