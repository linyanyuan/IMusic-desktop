import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../services/auth_service.dart';
import '../../services/library_service.dart';
import '../desktop_app_shell.dart';
import '../widgets/desktop_adaptive_content_width.dart';
import '../widgets/desktop_empty_states.dart';
import '../widgets/desktop_user_avatar.dart';

class DesktopProfileScreen extends ConsumerWidget {
  const DesktopProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final auth = ref.watch(authProvider);
    final library = ref.watch(libraryProvider);
    final user = auth.user;

    if (user == null) {
      return Container(
        color: c.background,
        child: DesktopNotLoggedInState(c: c, message: '登录后查看我的主页'),
      );
    }

    final createdPlaylists = library.userPlaylists
        .where((playlist) => playlist['isCollected'] != true)
        .toList();
    final collectedPlaylists = library.userPlaylists
        .where((playlist) => playlist['isCollected'] == true)
        .toList();

    return Container(
      color: c.background,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(32, 26, 32, 40),
        children: [
          DesktopAdaptiveContentWidth(
            key: const ValueKey('profile-adaptive-content'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _ProfileHero(
                  user: user,
                  c: c,
                  likedCount: library.likedSongs.length,
                  createdCount: createdPlaylists.length,
                  collectedCount: collectedPlaylists.length,
                ),
                const SizedBox(height: 20),
                _ProfilePanel(
                  title: '音乐库',
                  trailing: '${library.likedSongs.length} 首喜欢',
                  c: c,
                  child: _ProfileLikedCard(
                    key: const ValueKey('profile-liked-playlist'),
                    songCount: library.likedSongs.length,
                    c: c,
                    onTap: () {
                      navigateDeskRoute(ref, DeskRoute.favorites);
                    },
                  ),
                ),
                const SizedBox(height: 18),
                _ProfilePlaylistSection(
                  title: '创建的歌单',
                  emptyMessage: '暂无创建的歌单',
                  playlists: createdPlaylists,
                  keyPrefix: 'profile-created-playlist',
                  c: c,
                  onOpen: (id) => _openUserPlaylist(ref, id),
                ),
                const SizedBox(height: 18),
                _ProfilePlaylistSection(
                  title: '收藏的歌单',
                  emptyMessage: '暂无收藏的歌单',
                  playlists: collectedPlaylists,
                  keyPrefix: 'profile-collected-playlist',
                  c: c,
                  onOpen: (id) => _openUserPlaylist(ref, id),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfilePanel extends StatelessWidget {
  final String title;
  final String? trailing;
  final DeepVibeColors c;
  final Widget child;

  const _ProfilePanel({
    required this.title,
    required this.trailing,
    required this.c,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ProfileSectionTitle(title: title, trailing: trailing, c: c),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: c.surface,
            borderRadius: BorderRadius.circular(kCardRadius),
            border: Border.all(color: c.divider),
          ),
          clipBehavior: Clip.antiAlias,
          child: child,
        ),
      ],
    );
  }
}

class _ProfilePlaylistSection extends StatelessWidget {
  final String title;
  final String emptyMessage;
  final List<Map<String, dynamic>> playlists;
  final String keyPrefix;
  final DeepVibeColors c;
  final ValueChanged<String> onOpen;

  const _ProfilePlaylistSection({
    required this.title,
    required this.emptyMessage,
    required this.playlists,
    required this.keyPrefix,
    required this.c,
    required this.onOpen,
  });

  @override
  Widget build(BuildContext context) {
    if (playlists.isEmpty) {
      return _ProfilePanel(
        title: title,
        trailing: null,
        c: c,
        child: _ProfileEmptyRow(
          c: c,
          icon: Icons.queue_music,
          message: emptyMessage,
        ),
      );
    }

    return _ProfilePanel(
      title: title,
      trailing: '${playlists.length} 个',
      c: c,
      child: Column(
        children: [
          for (var i = 0; i < playlists.length; i++) ...[
            if (i > 0) Divider(height: 1, color: c.divider),
            _playlistCardFor(playlists[i]),
          ],
        ],
      ),
    );
  }

  Widget _playlistCardFor(Map<String, dynamic> playlist) {
    final id = playlist['id']?.toString() ?? '';
    final name =
        playlist['name']?.toString() ??
        playlist['title']?.toString() ??
        '未命名歌单';
    final description =
        playlist['description']?.toString() ??
        playlist['subtitle']?.toString() ??
        '';
    final songCount = _playlistSongCount(playlist);
    return _ProfilePlaylistCard(
      key: ValueKey('$keyPrefix-$id'),
      title: name,
      description: description,
      songCount: songCount,
      collected: playlist['isCollected'] == true,
      c: c,
      onTap: () => onOpen(id),
    );
  }
}

class _ProfileEmptyRow extends StatelessWidget {
  final DeepVibeColors c;
  final IconData icon;
  final String message;

  const _ProfileEmptyRow({
    required this.c,
    required this.icon,
    required this.message,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 68,
      padding: const EdgeInsets.symmetric(horizontal: 18),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: c.background.withValues(alpha: 0.74),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: c.divider),
            ),
            child: Icon(icon, size: 18, color: c.textMuted),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: c.textMuted, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileHero extends StatelessWidget {
  final UserInfo user;
  final DeepVibeColors c;
  final int likedCount;
  final int createdCount;
  final int collectedCount;

  const _ProfileHero({
    required this.user,
    required this.c,
    required this.likedCount,
    required this.createdCount,
    required this.collectedCount,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(kCardRadius),
        border: Border.all(color: c.divider),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 640;
          final identity = Row(
            children: [
              Container(
                padding: const EdgeInsets.all(2),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: c.divider),
                ),
                child: DesktopUserAvatar(user: user, colors: c, radius: 40),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '我的主页',
                      style: TextStyle(
                        color: c.textMuted,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      user.nickname,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: c.textPrimary,
                        fontSize: 24,
                        height: 1.08,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    _ProfileHandlePill(text: '@${user.username}', c: c),
                  ],
                ),
              ),
            ],
          );
          final metrics = Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: compact ? WrapAlignment.start : WrapAlignment.end,
            children: [
              _ProfileMetricPill(
                icon: Icons.favorite,
                label: '喜欢',
                value: likedCount.toString(),
                c: c,
              ),
              _ProfileMetricPill(
                icon: Icons.library_music,
                label: '创建',
                value: createdCount.toString(),
                c: c,
              ),
              _ProfileMetricPill(
                icon: Icons.bookmark,
                label: '收藏',
                value: collectedCount.toString(),
                c: c,
              ),
            ],
          );

          if (compact) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [identity, const SizedBox(height: 16), metrics],
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(child: identity),
              const SizedBox(width: 18),
              metrics,
            ],
          );
        },
      ),
    );
  }
}

class _ProfileHandlePill extends StatelessWidget {
  final String text;
  final DeepVibeColors c;

  const _ProfileHandlePill({required this.text, required this.c});

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      key: const ValueKey('profile-handle-compact'),
      constraints: const BoxConstraints(maxWidth: 150),
      child: Container(
        height: 24,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: c.background.withValues(alpha: 0.74),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: c.divider),
        ),
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: c.textSecondary,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _ProfileMetricPill extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final DeepVibeColors c;

  const _ProfileMetricPill({
    required this.icon,
    required this.label,
    required this.value,
    required this.c,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 82,
      height: 46,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: c.background.withValues(alpha: 0.74),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: c.divider),
      ),
      child: Row(
        children: [
          Icon(icon, size: 15, color: c.accent),
          const SizedBox(width: 7),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: c.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: c.textMuted, fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileSectionTitle extends StatelessWidget {
  final String title;
  final String? trailing;
  final DeepVibeColors c;

  const _ProfileSectionTitle({
    required this.title,
    required this.trailing,
    required this.c,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          title,
          style: TextStyle(
            color: c.textSecondary,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
        const Spacer(),
        if (trailing != null)
          Text(
            trailing!,
            style: TextStyle(
              color: c.textMuted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
      ],
    );
  }
}

class _ProfileLikedCard extends StatefulWidget {
  final int songCount;
  final DeepVibeColors c;
  final VoidCallback onTap;

  const _ProfileLikedCard({
    super.key,
    required this.songCount,
    required this.c,
    required this.onTap,
  });

  @override
  State<_ProfileLikedCard> createState() => _ProfileLikedCardState();
}

class _ProfileLikedCardState extends State<_ProfileLikedCard> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            height: 72,
            padding: const EdgeInsets.symmetric(horizontal: 18),
            decoration: BoxDecoration(
              color: _hover
                  ? widget.c.surfaceVariant.withValues(alpha: 0.72)
                  : widget.c.surface,
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.red.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Icon(
                    Icons.favorite,
                    color: Colors.red,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '我喜欢的音乐',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        '${widget.songCount} 首喜欢的歌曲',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textMuted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right,
                  size: 20,
                  color: widget.c.textSecondary,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProfilePlaylistCard extends StatefulWidget {
  final String title;
  final String description;
  final int songCount;
  final bool collected;
  final DeepVibeColors c;
  final VoidCallback onTap;

  const _ProfilePlaylistCard({
    super.key,
    required this.title,
    required this.description,
    required this.songCount,
    required this.collected,
    required this.c,
    required this.onTap,
  });

  @override
  State<_ProfilePlaylistCard> createState() => _ProfilePlaylistCardState();
}

class _ProfilePlaylistCardState extends State<_ProfilePlaylistCard> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final subtitle = widget.description.isEmpty
        ? '${widget.songCount} 首歌曲'
        : '${widget.description} · ${widget.songCount} 首歌曲';

    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            constraints: const BoxConstraints(minHeight: 72),
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
            decoration: BoxDecoration(
              color: _hover
                  ? widget.c.surfaceVariant.withValues(alpha: 0.72)
                  : widget.c.surface,
            ),
            child: Row(
              children: [
                _PlaylistCoverMark(c: widget.c, collected: widget.collected),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        widget.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        subtitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: widget.c.textMuted,
                          fontSize: 12,
                          height: 1.25,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(Icons.chevron_right, size: 18, color: widget.c.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PlaylistCoverMark extends StatelessWidget {
  final DeepVibeColors c;
  final bool collected;

  const _PlaylistCoverMark({required this.c, required this.collected});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      width: 48,
      decoration: BoxDecoration(
        color: c.accent.withValues(alpha: collected ? 0.1 : 0.16),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Stack(
        children: [
          Positioned(
            left: 9,
            top: 10,
            child: Icon(
              collected ? Icons.bookmark : Icons.queue_music,
              color: c.accent,
              size: 21,
            ),
          ),
          Positioned(
            right: 7,
            bottom: 7,
            child: Icon(Icons.graphic_eq, color: c.textMuted, size: 14),
          ),
        ],
      ),
    );
  }
}

void _openUserPlaylist(WidgetRef ref, String playlistId) {
  if (playlistId.isEmpty) return;
  navigateDeskRoute(ref, DeskRoute.playlistDetail, playlistId: playlistId);
}

int _playlistSongCount(Map<String, dynamic> playlist) {
  final songs = playlist['songs'];
  if (songs is List) return songs.length;
  final count = playlist['songCount'];
  if (count is int) return count;
  if (count is num) return count.round();
  return int.tryParse(count?.toString() ?? '') ?? 0;
}
