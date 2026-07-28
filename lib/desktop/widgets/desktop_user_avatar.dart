import 'package:flutter/material.dart';

import '../../app/theme.dart';
import '../../services/auth_service.dart';

class DesktopUserAvatar extends StatelessWidget {
  final UserInfo user;
  final DeepVibeColors colors;
  final double radius;

  const DesktopUserAvatar({
    super.key,
    required this.user,
    required this.colors,
    required this.radius,
  });

  @override
  Widget build(BuildContext context) {
    final image = _avatarImage(user.avatarUrl);
    return CircleAvatar(
      radius: radius,
      backgroundColor: colors.accent,
      foregroundImage: image,
      onForegroundImageError: image == null ? null : (exception, stackTrace) {},
      child: Text(
        user.avatarText,
        style: TextStyle(
          color: colors.background,
          fontSize: radius * 0.9,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

ImageProvider? _avatarImage(String avatarUrl) {
  final uri = Uri.tryParse(avatarUrl.trim());
  if (uri == null || uri.host.isEmpty) return null;
  if (uri.scheme != 'http' && uri.scheme != 'https') return null;
  return NetworkImage(uri.toString());
}
