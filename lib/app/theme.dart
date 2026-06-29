import 'package:flutter/material.dart';

/// DeepVibe Desktop theme tokens.
///
/// Two surface modes per PRD §9 "nighttime listening studio":
///  - dark: charcoal / ink / graphite, cyan accent, not pure black
///  - light: warm neutral surface, same cyan accent
/// Card radius capped at 8px. Bottom bar / queue row / song row sizes are
/// stable (do not flex with content) per tech doc §7.3 and PRD success metric.

const double kCardRadius = 8;
const double kPlayerBarHeight = 80;
const double kSongRowHeight = 40;
const double kQueueRowHeight = 44;
const double kSidebarWidth = 224;
const double kRightRailWidth = 320;
const String kAppFontFamily = '-apple-system';
const List<String> kAppFontFamilyFallback = [
  'BlinkM',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  'PingFang SC',
  'Noto Sans CJK SC',
  'sans-serif',
];

class DeepVibeColors {
  final Color background;
  final Color surface;
  final Color surfaceVariant;
  final Color border;
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color accent;
  final Color accentMuted;
  final Color warning;
  final Color divider;

  const DeepVibeColors({
    required this.background,
    required this.surface,
    required this.surfaceVariant,
    required this.border,
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.accent,
    required this.accentMuted,
    required this.warning,
    required this.divider,
  });

  static const dark = DeepVibeColors(
    background: Color(0xFF121417), // charcoal, not pure black
    surface: Color(0xFF1A1D22),
    surfaceVariant: Color(0xFF22262D),
    border: Color(0xFF30353D),
    textPrimary: Color(0xFFE8EAED),
    textSecondary: Color(0xFFA9B0B8),
    textMuted: Color(0xFF6B7280),
    accent: Color(0xFF38D9D3), // cyan
    accentMuted: Color(0xFF1F6E6B),
    warning: Color(0xFFE2A04A),
    divider: Color(0xFF2A2E35),
  );

  static const light = DeepVibeColors(
    background: Color(0xFFF7F8FA),
    surface: Color(0xFFFFFFFF),
    surfaceVariant: Color(0xFFEFF1F4),
    border: Color(0xFFE1E4E8),
    textPrimary: Color(0xFF1B1F24),
    textSecondary: Color(0xFF5C6570),
    textMuted: Color(0xFF98A1AC),
    accent: Color(0xFF10A8A4),
    accentMuted: Color(0xFFCAE9E8),
    warning: Color(0xFFB7791F),
    divider: Color(0xFFE7E9ED),
  );

  DeepVibeColors copyWith({
    Color? background,
    Color? surface,
    Color? surfaceVariant,
    Color? border,
    Color? textPrimary,
    Color? textSecondary,
    Color? textMuted,
    Color? accent,
    Color? accentMuted,
    Color? warning,
    Color? divider,
  }) => DeepVibeColors(
    background: background ?? this.background,
    surface: surface ?? this.surface,
    surfaceVariant: surfaceVariant ?? this.surfaceVariant,
    border: border ?? this.border,
    textPrimary: textPrimary ?? this.textPrimary,
    textSecondary: textSecondary ?? this.textSecondary,
    textMuted: textMuted ?? this.textMuted,
    accent: accent ?? this.accent,
    accentMuted: accentMuted ?? this.accentMuted,
    warning: warning ?? this.warning,
    divider: divider ?? this.divider,
  );
}

class AppTheme {
  static ThemeData dark() => _build(DeepVibeColors.dark, Brightness.dark);
  static ThemeData light() => _build(DeepVibeColors.light, Brightness.light);

  static ThemeData _build(DeepVibeColors c, Brightness brightness) {
    final scheme = ColorScheme(
      brightness: brightness,
      primary: c.accent,
      onPrimary: brightness == Brightness.dark
          ? const Color(0xFF0A1414)
          : Colors.white,
      secondary: c.accent,
      onSecondary: brightness == Brightness.dark
          ? const Color(0xFF0A1414)
          : Colors.white,
      error: c.warning,
      onError: Colors.black,
      surface: c.surface,
      onSurface: c.textPrimary,
    );

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: c.background,
      brightness: brightness,
      fontFamily: kAppFontFamily,
      fontFamilyFallback: kAppFontFamilyFallback,
    );

    return base.copyWith(
      textTheme: base.textTheme.apply(
        bodyColor: c.textPrimary,
        displayColor: c.textPrimary,
        fontFamily: kAppFontFamily,
        fontFamilyFallback: kAppFontFamilyFallback,
      ),
      splashFactory: NoSplash.splashFactory,
      highlightColor: Colors.transparent,
      hoverColor: c.accent.withOpacity(0.06),
      dividerColor: c.divider,
      cardTheme: base.cardTheme.copyWith(
        color: c.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kCardRadius),
          side: BorderSide(color: c.border, width: 1),
        ),
        margin: EdgeInsets.zero,
      ),
      iconTheme: base.iconTheme.copyWith(color: c.textSecondary, size: 18),
      dividerTheme: DividerThemeData(color: c.divider, thickness: 1, space: 0),
      tooltipTheme: base.tooltipTheme.copyWith(
        textStyle: TextStyle(
          fontSize: 13,
          color: c.textPrimary,
          fontFamily: kAppFontFamily,
          fontFamilyFallback: kAppFontFamilyFallback,
        ),
        decoration: BoxDecoration(
          color: c.surfaceVariant,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: c.border),
        ),
      ),
    );
  }
}
