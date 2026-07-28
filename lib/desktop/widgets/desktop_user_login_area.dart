import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../services/auth_service.dart';
import '../desktop_app_shell.dart';
import 'desktop_user_avatar.dart';

/// User login area with icon and dropdown
class DesktopUserLoginArea extends ConsumerWidget {
  final DeepVibeColors colors;
  const DesktopUserLoginArea({super.key, required this.colors});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);

    return authState.isLoggedIn
        ? _LoggedInUser(colors: colors, user: authState.user!)
        : _LoginButton(colors: colors);
  }
}

class _LoginButton extends StatelessWidget {
  final DeepVibeColors colors;
  const _LoginButton({required this.colors});

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: () {
        showGeneralDialog(
          context: context,
          barrierDismissible: true,
          barrierColor: Colors.black54,
          barrierLabel: 'Login',
          transitionDuration: const Duration(milliseconds: 200),
          pageBuilder: (context, animation, secondaryAnimation) {
            return _LoginDialog(colors: colors);
          },
          transitionBuilder: (context, animation, secondaryAnimation, child) {
            return FadeTransition(
              opacity: animation,
              child: ScaleTransition(
                scale: Tween<double>(begin: 0.9, end: 1.0).animate(
                  CurvedAnimation(parent: animation, curve: Curves.easeOut),
                ),
                child: child,
              ),
            );
          },
        );
      },
      style: TextButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        foregroundColor: colors.textPrimary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        overlayColor: colors.surfaceVariant.withOpacity(0.3),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.account_circle_outlined,
            size: 20,
            color: colors.textSecondary,
          ),
          const SizedBox(width: 6),
          Text(
            '登录',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }
}

class _LoggedInUser extends StatefulWidget {
  final DeepVibeColors colors;
  final UserInfo user;
  const _LoggedInUser({required this.colors, required this.user});

  @override
  State<_LoggedInUser> createState() => _LoggedInUserState();
}

class _LoggedInUserState extends State<_LoggedInUser> {
  OverlayEntry? _menuEntry;

  bool get _menuVisible => _menuEntry != null;

  @override
  void dispose() {
    _removeMenu();
    super.dispose();
  }

  void _toggleMenu() {
    if (_menuVisible) {
      _removeMenu();
    } else {
      _showMenu();
    }
    setState(() {});
  }

  void _showMenu() {
    final renderBox = context.findRenderObject() as RenderBox;
    final offset = renderBox.localToGlobal(Offset.zero);
    final size = renderBox.size;
    const menuWidth = 160.0;

    _menuEntry = OverlayEntry(
      builder: (context) => Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: () {
                _removeMenu();
                if (mounted) setState(() {});
              },
            ),
          ),
          Positioned(
            left: offset.dx + size.width - menuWidth,
            top: offset.dy + size.height + 4,
            child: _UserMenu(colors: widget.colors, onClose: _closeMenu),
          ),
        ],
      ),
    );
    Overlay.of(context, rootOverlay: true).insert(_menuEntry!);
  }

  void _closeMenu() {
    _removeMenu();
    if (mounted) setState(() {});
  }

  void _removeMenu() {
    _menuEntry?.remove();
    _menuEntry = null;
  }

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: _toggleMenu,
      style: TextButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        foregroundColor: widget.colors.textPrimary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        overlayColor: widget.colors.surfaceVariant.withOpacity(0.3),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          DesktopUserAvatar(
            user: widget.user,
            colors: widget.colors,
            radius: 12,
          ),
          const SizedBox(width: 8),
          Text(
            widget.user.nickname,
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          ),
          const SizedBox(width: 4),
          Icon(
            _menuVisible ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
            size: 16,
            color: widget.colors.textSecondary,
          ),
        ],
      ),
    );
  }
}

class _UserMenu extends ConsumerWidget {
  final DeepVibeColors colors;
  final VoidCallback onClose;
  const _UserMenu({required this.colors, required this.onClose});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return GestureDetector(
      onTap: () {},
      child: Material(
        elevation: 8,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          width: 160,
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: colors.border),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _UserMenuItem(
                icon: Icons.person_outline,
                label: '我的',
                colors: colors,
                onTap: () {
                  onClose();
                  navigateDeskRoute(ref, DeskRoute.profile);
                },
              ),
              Divider(height: 1, color: colors.divider),
              _UserMenuItem(
                icon: Icons.settings_outlined,
                label: '设置',
                colors: colors,
                onTap: () {
                  onClose();
                  navigateDeskRoute(ref, DeskRoute.settings);
                },
              ),
              Divider(height: 1, color: colors.divider),
              _UserMenuItem(
                icon: Icons.logout,
                label: '退出登录',
                colors: colors,
                onTap: () async {
                  onClose();
                  await ref.read(authProvider.notifier).logout();
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _UserMenuItem extends StatefulWidget {
  final IconData icon;
  final String label;
  final DeepVibeColors colors;
  final VoidCallback onTap;

  const _UserMenuItem({
    required this.icon,
    required this.label,
    required this.colors,
    required this.onTap,
  });

  @override
  State<_UserMenuItem> createState() => _UserMenuItemState();
}

class _UserMenuItemState extends State<_UserMenuItem> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: InkWell(
        onTap: widget.onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          color: _hover
              ? widget.colors.surfaceVariant.withOpacity(0.5)
              : Colors.transparent,
          child: Row(
            children: [
              Icon(widget.icon, size: 18, color: widget.colors.textSecondary),
              const SizedBox(width: 12),
              Text(
                widget.label,
                style: TextStyle(
                  color: widget.colors.textPrimary,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LoginDialog extends ConsumerStatefulWidget {
  final DeepVibeColors colors;
  const _LoginDialog({required this.colors});

  @override
  ConsumerState<_LoginDialog> createState() => _LoginDialogState();
}

class _LoginDialogState extends ConsumerState<_LoginDialog> {
  final _usernameController = TextEditingController();
  final _nicknameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _isLoading = false;
  bool _isRegistering = false;
  String? _errorMessage;

  @override
  void dispose() {
    _usernameController.dispose();
    _nicknameController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final username = _usernameController.text.trim();
    final password = _passwordController.text;
    final nickname = _nicknameController.text.trim();
    final confirmPassword = _confirmPasswordController.text;

    if (username.isEmpty || password.isEmpty) {
      setState(() => _errorMessage = '请输入用户名和密码');
      return;
    }
    if (_isRegistering && password != confirmPassword) {
      setState(() => _errorMessage = '两次输入的密码不一致');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      if (_isRegistering) {
        await ref
            .read(authProvider.notifier)
            .register(
              username,
              password,
              nickname: nickname.isEmpty ? null : nickname,
            );
      } else {
        await ref.read(authProvider.notifier).login(username, password);
      }
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = _isRegistering ? '注册失败，请稍后再试' : '登录失败，请检查用户名和密码';
      });
    }
  }

  void _setMode(bool registering) {
    setState(() {
      _isRegistering = registering;
      _errorMessage = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final title = _isRegistering ? '创建账户' : '登录 IMusic';
    final actionLabel = _isRegistering ? '创建并同步' : '登录并同步';

    return Center(
      child: Material(
        color: Colors.transparent,
        child: Dialog(
          insetPadding: const EdgeInsets.symmetric(horizontal: 24),
          backgroundColor: Colors.transparent,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(kCardRadius),
          ),
          child: Container(
            width: 432,
            constraints: const BoxConstraints(maxWidth: 432),
            decoration: BoxDecoration(
              color: widget.colors.surface,
              borderRadius: BorderRadius.circular(kCardRadius),
              border: Border.all(color: widget.colors.border),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.24),
                  blurRadius: 42,
                  offset: const Offset(0, 22),
                ),
              ],
            ),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(26, 24, 26, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 34,
                        height: 34,
                        decoration: BoxDecoration(
                          color: widget.colors.accent.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(kCardRadius),
                          border: Border.all(
                            color: widget.colors.accent.withValues(alpha: 0.25),
                          ),
                        ),
                        child: Icon(
                          Icons.graphic_eq,
                          size: 18,
                          color: widget.colors.accent,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              title,
                              style: TextStyle(
                                color: widget.colors.textPrimary,
                                fontSize: 21,
                                height: 1.2,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '同步你的收藏、歌单和播放历史。',
                              style: TextStyle(
                                color: widget.colors.textSecondary,
                                fontSize: 13,
                                height: 1.35,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        tooltip: '关闭',
                        icon: const Icon(Icons.close, size: 18),
                        color: widget.colors.textMuted,
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 32,
                          minHeight: 32,
                        ),
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                  Container(
                    height: 40,
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(
                      color: widget.colors.background,
                      borderRadius: BorderRadius.circular(kCardRadius),
                      border: Border.all(color: widget.colors.border),
                    ),
                    child: Row(
                      children: [
                        _AuthModeButton(
                          label: '登录',
                          selected: !_isRegistering,
                          colors: widget.colors,
                          onTap: _isLoading ? null : () => _setMode(false),
                        ),
                        _AuthModeButton(
                          label: '注册',
                          selected: _isRegistering,
                          colors: widget.colors,
                          onTap: _isLoading ? null : () => _setMode(true),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  TextField(
                    controller: _usernameController,
                    decoration: _authInputDecoration(
                      label: '用户名',
                      icon: Icons.person_outline,
                      colors: widget.colors,
                    ),
                    style: TextStyle(
                      color: widget.colors.textPrimary,
                      fontSize: 14,
                    ),
                    cursorColor: widget.colors.accent,
                    textInputAction: TextInputAction.next,
                    enabled: !_isLoading,
                  ),
                  const SizedBox(height: 12),
                  if (_isRegistering) ...[
                    TextField(
                      controller: _nicknameController,
                      decoration: _authInputDecoration(
                        label: '昵称（可选）',
                        icon: Icons.badge_outlined,
                        colors: widget.colors,
                      ),
                      style: TextStyle(
                        color: widget.colors.textPrimary,
                        fontSize: 14,
                      ),
                      cursorColor: widget.colors.accent,
                      textInputAction: TextInputAction.next,
                      enabled: !_isLoading,
                    ),
                    const SizedBox(height: 12),
                  ],
                  TextField(
                    controller: _passwordController,
                    obscureText: true,
                    decoration: _authInputDecoration(
                      label: '密码',
                      icon: Icons.lock_outline,
                      colors: widget.colors,
                    ),
                    style: TextStyle(
                      color: widget.colors.textPrimary,
                      fontSize: 14,
                    ),
                    cursorColor: widget.colors.accent,
                    textInputAction: _isRegistering
                        ? TextInputAction.next
                        : TextInputAction.done,
                    enabled: !_isLoading,
                    onSubmitted: (_) {
                      if (!_isRegistering) _submit();
                    },
                  ),
                  if (_isRegistering) ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: _confirmPasswordController,
                      obscureText: true,
                      decoration: _authInputDecoration(
                        label: '确认密码',
                        icon: Icons.verified_user_outlined,
                        colors: widget.colors,
                      ),
                      style: TextStyle(
                        color: widget.colors.textPrimary,
                        fontSize: 14,
                      ),
                      cursorColor: widget.colors.accent,
                      textInputAction: TextInputAction.done,
                      enabled: !_isLoading,
                      onSubmitted: (_) => _submit(),
                    ),
                  ],
                  if (_errorMessage != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 9,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE06161).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(kCardRadius),
                        border: Border.all(
                          color: const Color(
                            0xFFE06161,
                          ).withValues(alpha: 0.28),
                        ),
                      ),
                      child: Text(
                        _errorMessage!,
                        style: TextStyle(
                          color: const Color(0xFFE06161),
                          fontSize: 12,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 18),
                  SizedBox(
                    height: 44,
                    child: ElevatedButton(
                      onPressed: _isLoading ? null : _submit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: widget.colors.accent,
                        foregroundColor: widget.colors.background,
                        disabledBackgroundColor: widget.colors.surfaceVariant,
                        disabledForegroundColor: widget.colors.textMuted,
                        elevation: 0,
                        shadowColor: Colors.transparent,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(kCardRadius),
                        ),
                      ),
                      child: _isLoading
                          ? SizedBox(
                              height: 18,
                              width: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation(
                                  widget.colors.background,
                                ),
                              ),
                            )
                          : Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  actionLabel,
                                  style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Icon(
                                  _isRegistering
                                      ? Icons.person_add_alt_1
                                      : Icons.arrow_forward,
                                  size: 17,
                                ),
                              ],
                            ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: widget.colors.background,
                      borderRadius: BorderRadius.circular(kCardRadius),
                      border: Border.all(color: widget.colors.border),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.info_outline,
                          size: 16,
                          color: widget.colors.textMuted,
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: Text(
                            '未登录也可以搜索和播放，登录后保存你的音乐资产。',
                            style: TextStyle(
                              color: widget.colors.textSecondary,
                              fontSize: 12,
                              height: 1.45,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _authInputDecoration({
    required String label,
    required IconData icon,
    required DeepVibeColors colors,
  }) {
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(kCardRadius),
      borderSide: BorderSide(color: colors.border),
    );
    return InputDecoration(
      labelText: label,
      labelStyle: TextStyle(color: colors.textSecondary, fontSize: 13),
      floatingLabelStyle: TextStyle(color: colors.accent, fontSize: 13),
      prefixIcon: Icon(icon, size: 18, color: colors.textMuted),
      filled: true,
      fillColor: colors.background,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
      border: border,
      enabledBorder: border,
      disabledBorder: border.copyWith(
        borderSide: BorderSide(color: colors.border.withValues(alpha: 0.55)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kCardRadius),
        borderSide: BorderSide(color: colors.accent, width: 2),
      ),
    );
  }
}

class _AuthModeButton extends StatelessWidget {
  final String label;
  final bool selected;
  final DeepVibeColors colors;
  final VoidCallback? onTap;

  const _AuthModeButton({
    required this.label,
    required this.selected,
    required this.colors,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: onTap,
        child: Container(
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? colors.surface : Colors.transparent,
            borderRadius: BorderRadius.circular(kCardRadius - 2),
            border: selected
                ? Border.all(color: colors.border)
                : Border.all(color: Colors.transparent),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? colors.textPrimary : colors.textMuted,
              fontSize: 13,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}
