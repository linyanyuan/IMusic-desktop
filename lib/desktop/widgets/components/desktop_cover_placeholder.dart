import 'package:flutter/material.dart';

import '../../../app/theme.dart';

/// A deterministic cover placeholder. Stitch prompt (line 31) explicitly wants
/// real artwork placeholders, not abstract SVG illustrations — but until we
/// wire `cached_network_image` and have real cover URLs, this gives a stable
/// seeded gradient block that doesn't look like a marketing blob.
class DesktopCoverPlaceholder extends StatelessWidget {
  final double size;
  final int colorSeed;
  const DesktopCoverPlaceholder({
    super.key,
    required this.size,
    required this.colorSeed,
  });

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    return SizedBox(
      height: size,
      width: size,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(kCardRadius),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              _seeded(colorSeed, 0, c.accent),
              _seeded(colorSeed, 1, c.surfaceVariant),
              _seeded(colorSeed, 2, c.accentMuted.withOpacity(0.6)),
            ],
          ),
        ),
        child: Icon(
          Icons.album,
          size: size * 0.25,
          color: c.surface.withOpacity(0.55),
        ),
      ),
    );
  }

  Color _seeded(int seed, int slot, Color fallback) {
    final h = ((seed + slot * 17) % 360).toDouble();
    final s = (0.25 + ((seed * 7 + slot * 3) % 40) / 100).toDouble();
    final l = (0.28 + ((seed + slot) % 30) / 100).toDouble();
    try {
      return HSLColor.fromAHSL(1.0, h, s, l.clamp(0.2, 0.7)).toColor();
    } catch (_) {
      return fallback;
    }
  }
}
