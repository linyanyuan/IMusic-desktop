import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../../app/theme.dart';
import 'desktop_cover_placeholder.dart';

/// Network image with cached loading and placeholder
class NetworkCoverImage extends StatelessWidget {
  final String? imageUrl;
  final double size;
  final int colorSeed;
  final BorderRadius? borderRadius;

  const NetworkCoverImage({
    super.key,
    required this.imageUrl,
    required this.size,
    required this.colorSeed,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context) {
    if (imageUrl == null || imageUrl!.isEmpty) {
      return DesktopCoverPlaceholder(
        size: size,
        colorSeed: colorSeed,
      );
    }

    return ClipRRect(
      borderRadius: borderRadius ?? BorderRadius.circular(kCardRadius),
      child: CachedNetworkImage(
        imageUrl: imageUrl!,
        width: size,
        height: size,
        fit: BoxFit.cover,
        placeholder: (context, url) => DesktopCoverPlaceholder(
          size: size,
          colorSeed: colorSeed,
        ),
        errorWidget: (context, url, error) => DesktopCoverPlaceholder(
          size: size,
          colorSeed: colorSeed,
        ),
      ),
    );
  }
}
