const playbackStatusPlaying = 'playing';
const playbackStatusPaused = 'paused';
const playbackStatusLoading = 'loading';
const playbackStatusError = 'error';

const lyricsStatusLoading = 'loading';
const lyricsStatusLoaded = 'loaded';
const lyricsStatusEmpty = 'empty';
const lyricsStatusTimeout = 'timeout';

const playbackIdKey = 'playbackId';
const playbackPlayUrlKey = 'playUrl';
const playbackStatusKey = 'status';
const trackIdKey = 'id';
const trackTitleKey = 'title';
const trackArtistKey = 'artist';
const trackLyricsKey = 'lyrics';
const trackLyricsStatusKey = 'lyricsStatus';
const lyricsTimeoutAtKey = 'lyricsTimedOutAt';
const lyricsLoadingStartedAtKey = 'lyricsLoadingStartedAt';

enum PlaybackStatus {
  playing(playbackStatusPlaying),
  paused(playbackStatusPaused),
  loading(playbackStatusLoading),
  error(playbackStatusError);

  const PlaybackStatus(this.value);

  final String value;

  static PlaybackStatus? fromJson(Object? value) {
    final text = value?.toString();
    for (final status in PlaybackStatus.values) {
      if (status.value == text) return status;
    }
    return null;
  }
}

enum LyricsStatus {
  loading(lyricsStatusLoading),
  loaded(lyricsStatusLoaded),
  empty(lyricsStatusEmpty),
  timeout(lyricsStatusTimeout);

  const LyricsStatus(this.value);

  final String value;

  static LyricsStatus? fromJson(Object? value) {
    final text = value?.toString();
    for (final status in LyricsStatus.values) {
      if (status.value == text) return status;
    }
    return null;
  }
}

class PlaybackTrack {
  PlaybackTrack._(Map<String, dynamic> raw) : _raw = Map.of(raw);

  factory PlaybackTrack.fromJson(Map<String, dynamic> json) {
    return PlaybackTrack._(json);
  }

  static const Object _unset = Object();

  final Map<String, dynamic> _raw;

  String? get id => _string(trackIdKey);
  String? get title => _string(trackTitleKey);
  String? get artist => _string(trackArtistKey);
  String get lyrics => _string(trackLyricsKey) ?? '';
  PlaybackStatus? get status =>
      PlaybackStatus.fromJson(_raw[playbackStatusKey]);
  String? get statusValue => _string(playbackStatusKey);
  LyricsStatus? get lyricsStatus =>
      LyricsStatus.fromJson(_raw[trackLyricsStatusKey]);
  String? get lyricsStatusValue => _string(trackLyricsStatusKey);
  String? get playbackId => _string(playbackIdKey);
  String? get playUrl => _string(playbackPlayUrlKey);
  int? get lyricsLoadingStartedAt => _int(lyricsLoadingStartedAtKey);
  int? get lyricsTimedOutAt => _int(lyricsTimeoutAtKey);

  bool get isPlaying => status == PlaybackStatus.playing;
  bool get isPaused => status == PlaybackStatus.paused;
  bool get isLoading => status == PlaybackStatus.loading;
  bool get isError => status == PlaybackStatus.error;
  bool get isLyricsLoading => lyricsStatus == LyricsStatus.loading;
  bool get isLyricsLoaded => lyricsStatus == LyricsStatus.loaded;
  bool get isLyricsEmpty => lyricsStatus == LyricsStatus.empty;
  bool get isLyricsTimeout => lyricsStatus == LyricsStatus.timeout;

  bool sameSongAs(PlaybackTrack other) => id == other.id;

  Map<String, dynamic> toJson() => Map.of(_raw);

  PlaybackTrack copyWith({
    Object? id = _unset,
    Object? title = _unset,
    Object? artist = _unset,
    Object? lyrics = _unset,
    PlaybackStatus? status,
    LyricsStatus? lyricsStatus,
    Object? playbackId = _unset,
    Object? playUrl = _unset,
    Object? lyricsLoadingStartedAt = _unset,
    Object? lyricsTimedOutAt = _unset,
  }) {
    final next = Map<String, dynamic>.of(_raw);
    _set(next, trackIdKey, id);
    _set(next, trackTitleKey, title);
    _set(next, trackArtistKey, artist);
    _set(next, trackLyricsKey, lyrics);
    if (status != null) next[playbackStatusKey] = status.value;
    if (lyricsStatus != null) next[trackLyricsStatusKey] = lyricsStatus.value;
    _set(next, playbackIdKey, playbackId);
    _set(next, playbackPlayUrlKey, playUrl);
    _set(next, lyricsLoadingStartedAtKey, lyricsLoadingStartedAt);
    _set(next, lyricsTimeoutAtKey, lyricsTimedOutAt);
    return PlaybackTrack._(next);
  }

  PlaybackTrack withLoading({
    required LyricsStatus lyricsStatus,
    int? lyricsLoadingStartedAt,
  }) {
    return copyWith(
      status: PlaybackStatus.loading,
      lyricsStatus: lyricsStatus,
      lyricsLoadingStartedAt: lyricsLoadingStartedAt,
      lyricsTimedOutAt: null,
    );
  }

  PlaybackTrack withPlaying({
    required Object? playUrl,
    Object? lyrics = _unset,
    LyricsStatus? lyricsStatus,
    Object? lyricsLoadingStartedAt = _unset,
  }) {
    return copyWith(
      status: PlaybackStatus.playing,
      playUrl: playUrl,
      lyrics: lyrics,
      lyricsStatus: lyricsStatus,
      lyricsLoadingStartedAt: lyricsLoadingStartedAt,
      lyricsTimedOutAt: null,
    );
  }

  PlaybackTrack withPlaybackError({
    LyricsStatus? lyricsStatus,
    int? lyricsLoadingStartedAt,
  }) {
    return copyWith(
      status: PlaybackStatus.error,
      lyricsStatus: lyricsStatus,
      lyricsLoadingStartedAt: lyricsLoadingStartedAt,
      lyricsTimedOutAt: null,
    );
  }

  PlaybackTrack withLyricsLoaded({Object? lyrics = _unset}) {
    return copyWith(
      lyrics: lyrics,
      lyricsStatus: LyricsStatus.loaded,
      lyricsLoadingStartedAt: null,
      lyricsTimedOutAt: null,
    );
  }

  PlaybackTrack withLyricsEmpty() {
    return copyWith(
      lyricsStatus: LyricsStatus.empty,
      lyricsLoadingStartedAt: null,
      lyricsTimedOutAt: null,
    );
  }

  PlaybackTrack withLyricsTimeout({int? timedOutAt}) {
    return copyWith(
      lyricsStatus: LyricsStatus.timeout,
      lyricsLoadingStartedAt: null,
      lyricsTimedOutAt: timedOutAt,
    );
  }

  String? _string(String key) => _raw[key]?.toString();

  int? _int(String key) {
    final value = _raw[key];
    if (value is int) return value;
    return int.tryParse(value?.toString() ?? '');
  }

  static void _set(Map<String, dynamic> target, String key, Object? value) {
    if (!identical(value, _unset)) {
      target[key] = value;
    }
  }
}
