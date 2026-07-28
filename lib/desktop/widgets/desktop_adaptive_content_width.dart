import 'package:flutter/material.dart';

class DesktopAdaptiveContentWidth extends StatelessWidget {
  final Widget child;

  const DesktopAdaptiveContentWidth({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final availableWidth = constraints.maxWidth;
        if (!availableWidth.isFinite) return child;

        final contentWidth = availableWidth < 920
            ? availableWidth
            : (availableWidth * 0.88).clamp(860.0, 1180.0).toDouble();

        return Align(
          alignment: Alignment.topCenter,
          child: SizedBox(width: contentWidth, child: child),
        );
      },
    );
  }
}
