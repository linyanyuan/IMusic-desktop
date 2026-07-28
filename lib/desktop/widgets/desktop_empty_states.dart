import 'package:flutter/material.dart';

import '../../app/theme.dart';

class DesktopNotLoggedInState extends StatelessWidget {
  final DeepVibeColors c;
  final String message;

  const DesktopNotLoggedInState({
    super.key,
    required this.c,
    required this.message,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.account_circle_outlined,
            size: 64,
            color: c.textMuted.withOpacity(0.3),
          ),
          const SizedBox(height: 16),
          Text(message, style: TextStyle(color: c.textMuted, fontSize: 14)),
        ],
      ),
    );
  }
}

class DesktopEmptyDataState extends StatelessWidget {
  final DeepVibeColors c;
  final IconData icon;
  final String message;

  const DesktopEmptyDataState({
    super.key,
    required this.c,
    required this.icon,
    required this.message,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 64, color: c.textMuted.withOpacity(0.3)),
          const SizedBox(height: 16),
          Text(message, style: TextStyle(color: c.textMuted, fontSize: 14)),
        ],
      ),
    );
  }
}
