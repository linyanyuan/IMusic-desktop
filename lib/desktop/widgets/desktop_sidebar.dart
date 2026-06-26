import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../app/deepvibe_app.dart';
import '../../services/library_service.dart';
import '../../services/auth_service.dart';
import '../desktop_app_shell.dart';

/// Left persistent navigation — PRD §6.1: 首页 / 搜索 / 我的音乐,
/// plus a theme-mode toggle at the foot so the dark/light pair is reachable
/// without a settings page in the first scaffold.
class DesktopSidebar extends ConsumerWidget {
  final double width;
  const DesktopSidebar({super.key, required this.width});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final route = ref.watch(deskRouteProvider);

    return Container(
      width: width,
      color: c.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 16),
          _NavButton(
            icon: Icons.home_outlined,
            activeIcon: Icons.home,
            label: '首页',
            selected: route == DeskRoute.home,
            onTap: () => navigateDeskRoute(ref, DeskRoute.home),
          ),
          _NavButton(
            icon: Icons.search_outlined,
            activeIcon: Icons.search,
            label: '搜索',
            selected: route == DeskRoute.search,
            onTap: () => navigateDeskRoute(ref, DeskRoute.search),
          ),
          _NavButton(
            icon: Icons.library_music_outlined,
            activeIcon: Icons.library_music,
            label: '我的音乐',
            selected: route == DeskRoute.library,
            onTap: () => navigateDeskRoute(ref, DeskRoute.library),
          ),
          // Sub-items under "我的音乐"
          Padding(
            padding: const EdgeInsets.only(left: 24),
            child: Column(
              children: [
                _SubNavButton(
                  icon: Icons.favorite_border,
                  activeIcon: Icons.favorite,
                  label: '我喜欢的音乐',
                  selected: route == DeskRoute.favorites,
                  onTap: () => navigateDeskRoute(ref, DeskRoute.favorites),
                ),
                _SubNavButton(
                  icon: Icons.history,
                  activeIcon: Icons.history,
                  label: '历史播放',
                  selected: route == DeskRoute.history,
                  onTap: () => navigateDeskRoute(ref, DeskRoute.history),
                ),
              ],
            ),
          ),
          // Playlists section
          const _PlaylistsSection(),
          const Spacer(),
          const Divider(height: 1, indent: 12, endIndent: 12),
          _ThemeToggleRow(),
          const SizedBox(height: 10),
        ],
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _NavButton({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(kCardRadius),
          onTap: onTap,
          child: Container(
            height: 36,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: selected ? c.accent.withOpacity(0.12) : Colors.transparent,
              borderRadius: BorderRadius.circular(kCardRadius),
            ),
            child: Row(
              children: [
                Icon(
                  selected ? activeIcon : icon,
                  size: 18,
                  color: selected ? c.accent : c.textSecondary,
                ),
                const SizedBox(width: 12),
                Text(
                  label,
                  style: TextStyle(
                    color: selected ? c.accent : c.textPrimary,
                    fontSize: 13,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SubNavButton extends StatelessWidget {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _SubNavButton({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(kCardRadius),
          onTap: onTap,
          child: Container(
            height: 32,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: selected ? c.accent.withOpacity(0.08) : Colors.transparent,
              borderRadius: BorderRadius.circular(kCardRadius),
            ),
            child: Row(
              children: [
                Icon(
                  selected ? activeIcon : icon,
                  size: 16,
                  color: selected ? c.accent : c.textMuted,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                      color: selected ? c.accent : c.textSecondary,
                      fontSize: 12,
                      fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PlaylistsSection extends ConsumerWidget {
  const _PlaylistsSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final route = ref.watch(deskRouteProvider);
    final library = ref.watch(libraryProvider);
    final auth = ref.watch(authProvider);
    final playlists = library.userPlaylists;

    if (!auth.isLoggedIn) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(left: 24, right: 12, top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Section header with "+" button
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: Row(
              children: [
                Text(
                  '创建的歌单',
                  style: TextStyle(
                    color: c.textMuted,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.5,
                  ),
                ),
                const Spacer(),
                InkWell(
                  onTap: () => _showCreatePlaylistDialog(context, ref),
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    width: 20,
                    height: 20,
                    decoration: BoxDecoration(
                      color: c.surfaceVariant,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Icon(Icons.add, size: 14, color: c.textSecondary),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          // Playlist items
          if (playlists.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Text(
                '暂无歌单',
                style: TextStyle(color: c.textMuted, fontSize: 11),
              ),
            )
          else
            ...playlists.map((playlist) {
              final name = playlist['name']?.toString() ?? '未命名歌单';
              final isCollected = playlist['isCollected'] == true;
              final id = playlist['id']?.toString() ?? '';
              final selected =
                  route == DeskRoute.playlistDetail &&
                  ref.watch(playlistDetailProvider) == id;
              return _SubNavButton(
                icon: isCollected ? Icons.playlist_play : Icons.queue_music,
                activeIcon: isCollected
                    ? Icons.playlist_play
                    : Icons.queue_music,
                label: name,
                selected: selected,
                onTap: () {
                  if (id.isEmpty) return;
                  navigateDeskRoute(
                    ref,
                    DeskRoute.playlistDetail,
                    playlistId: id,
                  );
                },
              );
            }),
        ],
      ),
    );
  }

  void _showCreatePlaylistDialog(BuildContext context, WidgetRef ref) {
    showDialog(context: context, builder: (context) => _CreatePlaylistDialog());
  }
}

class _CreatePlaylistDialog extends ConsumerStatefulWidget {
  @override
  ConsumerState<_CreatePlaylistDialog> createState() =>
      _CreatePlaylistDialogState();
}

class _CreatePlaylistDialogState extends ConsumerState<_CreatePlaylistDialog> {
  final _nameController = TextEditingController();
  final _descController = TextEditingController();
  bool _isCreating = false;
  String? _errorMessage;

  @override
  void dispose() {
    _nameController.dispose();
    _descController.dispose();
    super.dispose();
  }

  Future<void> _handleCreate() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _errorMessage = '请输入歌单名称');
      return;
    }

    final auth = ref.read(authProvider);
    final token = auth.token;
    if (token == null || token.isEmpty) {
      setState(() => _errorMessage = '请先登录');
      return;
    }

    setState(() {
      _isCreating = true;
      _errorMessage = null;
    });

    try {
      await ref
          .read(libraryProvider.notifier)
          .createPlaylist(
            token,
            name,
            _descController.text.trim().isEmpty
                ? null
                : _descController.text.trim(),
          );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() {
        _isCreating = false;
        _errorMessage = '创建失败: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;

    return Dialog(
      backgroundColor: c.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Container(
        width: 400,
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text(
                  '创建歌单',
                  style: TextStyle(
                    color: c.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                IconButton(
                  icon: Icon(Icons.close, size: 20),
                  color: c.textSecondary,
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _nameController,
              decoration: InputDecoration(
                labelText: '歌单名称',
                labelStyle: TextStyle(color: c.textSecondary),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: c.border),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: c.accent, width: 2),
                ),
              ),
              style: TextStyle(color: c.textPrimary),
              enabled: !_isCreating,
              autofocus: true,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _descController,
              decoration: InputDecoration(
                labelText: '描述（可选）',
                labelStyle: TextStyle(color: c.textSecondary),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: c.border),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: c.accent, width: 2),
                ),
              ),
              style: TextStyle(color: c.textPrimary),
              enabled: !_isCreating,
              maxLines: 3,
            ),
            if (_errorMessage != null) ...[
              const SizedBox(height: 12),
              Text(
                _errorMessage!,
                style: TextStyle(color: Colors.red.shade400, fontSize: 13),
              ),
            ],
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: _isCreating ? null : _handleCreate,
              style: ElevatedButton.styleFrom(
                backgroundColor: c.accent,
                foregroundColor: c.background,
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: _isCreating
                  ? SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation(c.background),
                      ),
                    )
                  : Text(
                      '创建',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ThemeToggleRow extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(themeModeProvider);
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final isDark = mode == ThemeMode.dark;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 6),
      child: Row(
        children: [
          Icon(
            isDark ? Icons.dark_mode_outlined : Icons.light_mode_outlined,
            size: 16,
            color: c.textMuted,
          ),
          const SizedBox(width: 8),
          Text('主题', style: TextStyle(color: c.textMuted, fontSize: 12)),
          const Spacer(),
          _Switch(
            value: isDark,
            onChanged: (v) => ref.read(themeModeProvider.notifier).state = v
                ? ThemeMode.dark
                : ThemeMode.light,
          ),
        ],
      ),
    );
  }
}

class _Switch extends StatelessWidget {
  final bool value;
  final ValueChanged<bool> onChanged;
  const _Switch({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final w = 34.0, h = 18.0;
    return GestureDetector(
      onTap: () => onChanged(!value),
      child: Container(
        width: w,
        height: h,
        decoration: BoxDecoration(
          color: value ? c.accent : c.surfaceVariant,
          borderRadius: BorderRadius.circular(h / 2),
          border: Border.all(color: c.border),
        ),
        child: AnimatedAlign(
          duration: const Duration(milliseconds: 120),
          alignment: value ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            margin: const EdgeInsets.all(2),
            width: h - 4,
            height: h - 4,
            decoration: BoxDecoration(color: c.surface, shape: BoxShape.circle),
          ),
        ),
      ),
    );
  }
}
