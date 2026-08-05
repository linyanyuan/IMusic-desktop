import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../services/app_settings.dart';
import '../../services/audio_cache_service.dart';
import '../update/update_providers.dart';
import '../widgets/desktop_adaptive_content_width.dart';
import '../widgets/settings_shortcuts_section.dart';

class DesktopSettingsScreen extends ConsumerWidget {
  const DesktopSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
    final settings = ref.watch(appSettingsProvider);
    final notifier = ref.read(appSettingsProvider.notifier);
    final colorOptions = const [
      0xFF1ED760,
      0xFF14B8A6,
      0xFFFFD166,
      0xFFFF5C8A,
      0xFFFFFFFF,
    ];

    return Container(
      color: c.background,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(32, 26, 32, 40),
        children: [
          DesktopAdaptiveContentWidth(
            key: const ValueKey('settings-adaptive-content'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  '设置',
                  style: TextStyle(
                    color: c.textPrimary,
                    fontSize: 26,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 22),
                _SettingsSection(
                  title: '缓存',
                  c: c,
                  children: [
                    _SettingsRow(
                      title: '缓存目录',
                      description: '用于保存需要临时下载的音频文件',
                      c: c,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _CacheDirectoryField(c: c, settings: settings),
                          const SizedBox(height: 10),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              _SettingsActionButton(
                                key: const ValueKey(
                                  'settings-cache-directory-choose-button',
                                ),
                                icon: Icons.folder_open_outlined,
                                label: '选择目录',
                                c: c,
                                onTap: () async {
                                  final selected = await ref
                                      .read(cacheDirectoryPickerProvider)
                                      .call();
                                  if (selected == null ||
                                      selected.trim().isEmpty) {
                                    return;
                                  }
                                  await notifier.setCacheDirectory(selected);
                                },
                              ),
                              _SettingsActionButton(
                                icon: Icons.restart_alt_outlined,
                                label: '使用默认缓存目录',
                                c: c,
                                onTap: notifier.useDefaultCacheDirectory,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    _SettingsRow(
                      title: '缓存管理',
                      description: '复用已下载音频，并定期清理旧缓存',
                      c: c,
                      child: _AudioCacheManagement(c: c),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _SettingsSection(
                  title: '播放源',
                  c: c,
                  children: [
                    _SettingsRow(
                      title: 'ChKSz API 密钥',
                      description:
                          '用于 ChKSz·网易云源的搜索与播放，仅保存在本机；获取密钥：api.chksz.com/login',
                      c: c,
                      child: _ChkszApiKeyField(c: c, settings: settings),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _SettingsSection(
                  title: '歌词',
                  c: c,
                  children: [
                    _SettingsRow(
                      title: '歌词字号',
                      description: '${settings.lyricsFontSize.round()} px',
                      c: c,
                      child: SliderTheme(
                        data: SliderTheme.of(context).copyWith(
                          trackHeight: 3,
                          thumbShape: const RoundSliderThumbShape(
                            enabledThumbRadius: 8,
                          ),
                          overlayShape: const RoundSliderOverlayShape(
                            overlayRadius: 16,
                          ),
                          inactiveTrackColor: c.divider,
                        ),
                        child: Slider(
                          key: const ValueKey(
                            'settings-lyrics-font-size-slider',
                          ),
                          min: 16,
                          max: 32,
                          divisions: 16,
                          value: settings.lyricsFontSize.clamp(16, 32),
                          activeColor: c.accent,
                          onChanged: notifier.setLyricsFontSize,
                        ),
                      ),
                    ),
                    _SettingsRow(
                      title: '歌词颜色',
                      description: '影响桌面歌词浮窗当前行颜色',
                      c: c,
                      child: Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: colorOptions.map((value) {
                          return _LyricsColorSwatch(
                            key: value == 0xFF1ED760
                                ? const ValueKey('settings-lyrics-color-green')
                                : ValueKey('settings-lyrics-color-$value'),
                            color: Color(value),
                            selected: settings.lyricsColorValue == value,
                            c: c,
                            onTap: () => notifier.setLyricsColorValue(value),
                          );
                        }).toList(),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                SettingsShortcutsSection(colors: c),
                const SizedBox(height: 18),
                _AboutSection(c: c),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// "关于" section of the settings page — shows the running version and a
/// manual update-check button whose label follows [updateCheckStateProvider].
class _AboutSection extends ConsumerWidget {
  const _AboutSection({required this.c});
  final DeepVibeColors c;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final version = ref.watch(currentVersionProvider).valueOrNull;
    final state = ref.watch(updateCheckStateProvider);
    final String versionText = version ?? '…';

    final IconData icon;
    final String label;
    switch (state) {
      case UpdateChecking():
        icon = Icons.sync;
        label = '检查中…';
      case UpdateAvailable(:final manifest):
        icon = Icons.system_update_alt_outlined;
        label = '有新版本 v${manifest.version}';
      case UpdateDownloading(:final received, :final total):
        icon = Icons.download_outlined;
        label = total != null && total > 0
            ? '下载中 ${(received / total * 100).toStringAsFixed(0)}%'
            : '下载中…';
      case UpdateDownloaded():
        icon = Icons.install_desktop_outlined;
        label = '去安装';
      case UpdateUpToDate():
        icon = Icons.check_circle_outline;
        label = '已是最新';
      case UpdateError():
        icon = Icons.refresh;
        label = '检查失败，重试';
      default:
        icon = Icons.system_update_alt_outlined;
        label = '检查更新';
    }

    return _SettingsSection(
      title: '关于',
      c: c,
      children: [
        _AboutSettingsRow(
          c: c,
          versionText: versionText,
          updateIcon: icon,
          updateLabel: label,
          onCheckForUpdates: () =>
              UpdateActions.checkForUpdates(ref, manual: true),
        ),
      ],
    );
  }
}

class _AboutSettingsRow extends StatelessWidget {
  final DeepVibeColors c;
  final String versionText;
  final IconData updateIcon;
  final String updateLabel;
  final VoidCallback onCheckForUpdates;

  const _AboutSettingsRow({
    required this.c,
    required this.versionText,
    required this.updateIcon,
    required this.updateLabel,
    required this.onCheckForUpdates,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final stacked = constraints.maxWidth < 620;
        final details = Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: c.accent.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: c.accent.withValues(alpha: 0.18)),
              ),
              child: Icon(Icons.music_note_outlined, size: 18, color: c.accent),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'IMusic Desktop',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: c.textPrimary,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '当前版本 $versionText',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: c.textMuted,
                      fontSize: 12,
                      height: 1.25,
                    ),
                  ),
                ],
              ),
            ),
          ],
        );
        final button = _SettingsActionButton(
          key: const ValueKey('settings-check-update-button'),
          icon: updateIcon,
          label: updateLabel,
          c: c,
          onTap: onCheckForUpdates,
        );

        if (stacked) {
          return SizedBox(
            key: const ValueKey('settings-about-row'),
            width: double.infinity,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  details,
                  const SizedBox(height: 14),
                  Align(alignment: Alignment.centerRight, child: button),
                ],
              ),
            ),
          );
        }

        return SizedBox(
          key: const ValueKey('settings-about-row'),
          width: double.infinity,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
            child: Row(
              children: [
                Expanded(child: details),
                const SizedBox(width: 18),
                button,
              ],
            ),
          ),
        );
      },
    );
  }
}

class _CacheDirectoryField extends ConsumerWidget {
  final DeepVibeColors c;
  final AppSettings settings;

  const _CacheDirectoryField({required this.c, required this.settings});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (settings.cacheDirectory.isNotEmpty) {
      return _fieldContainer(
        c: c,
        child: Text(
          '当前缓存目录: ${settings.cacheDirectory}',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: c.textPrimary, fontSize: 13),
        ),
      );
    }

    // When using default directory, show the actual default path
    final defaultDirAsync = ref.watch(defaultCacheDirectoryProvider);
    final displayText = defaultDirAsync.when(
      data: (path) => '当前缓存目录: $path（默认）',
      loading: () => '正在获取默认缓存目录...',
      error: (_, stackTrace) => '使用系统默认缓存目录（无法获取路径）',
    );

    return _fieldContainer(
      c: c,
      child: Text(
        displayText,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: c.textMuted, fontSize: 13),
      ),
    );
  }

  Widget _fieldContainer({required Widget child, required DeepVibeColors c}) {
    return Container(
      key: const ValueKey('settings-cache-directory-field'),
      constraints: const BoxConstraints(minHeight: 42),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: c.background.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: c.divider),
      ),
      alignment: Alignment.centerLeft,
      child: child,
    );
  }
}

class _ChkszApiKeyField extends ConsumerStatefulWidget {
  final DeepVibeColors c;
  final AppSettings settings;

  const _ChkszApiKeyField({required this.c, required this.settings});

  @override
  ConsumerState<_ChkszApiKeyField> createState() => _ChkszApiKeyFieldState();
}

class _ChkszApiKeyFieldState extends ConsumerState<_ChkszApiKeyField> {
  late final TextEditingController _controller;
  bool _obscured = true;
  bool _saved = true;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.settings.chkszApiKey);
  }

  @override
  void didUpdateWidget(covariant _ChkszApiKeyField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // AppSettings loads from SharedPreferences asynchronously; once the real
    // stored key arrives, sync the field — but never clobber user edits.
    if (_saved &&
        widget.settings.chkszApiKey != oldWidget.settings.chkszApiKey) {
      _controller.text = widget.settings.chkszApiKey;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final value = _controller.text.trim();
    await ref.read(appSettingsProvider.notifier).setChkszApiKey(value);
    if (!mounted) return;
    setState(() => _saved = true);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(value.isEmpty ? '已清除 ChKSz API 密钥' : 'ChKSz API 密钥已保存'),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.c;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          key: const ValueKey('settings-chksz-api-key-field'),
          constraints: const BoxConstraints(minHeight: 42),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: c.background.withValues(alpha: 0.72),
            borderRadius: BorderRadius.circular(6),
            border: Border.all(color: c.divider),
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _controller,
                  obscureText: _obscured,
                  style: TextStyle(color: c.textPrimary, fontSize: 13),
                  decoration: InputDecoration(
                    hintText: '未配置（可用 --dart-define=CHKSZ_API_KEY 注入）',
                    hintStyle: TextStyle(color: c.textMuted, fontSize: 13),
                    border: InputBorder.none,
                    isDense: true,
                  ),
                  onChanged: (_) {
                    if (_saved) setState(() => _saved = false);
                  },
                  onSubmitted: (_) => _save(),
                ),
              ),
              IconButton(
                tooltip: _obscured ? '显示密钥' : '隐藏密钥',
                icon: Icon(
                  _obscured
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                  size: 18,
                ),
                color: c.textMuted,
                onPressed: () => setState(() => _obscured = !_obscured),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerLeft,
          child: _SettingsActionButton(
            key: const ValueKey('settings-chksz-api-key-save-button'),
            icon: Icons.check_outlined,
            label: _saved ? '已保存' : '保存密钥',
            c: c,
            onTap: _save,
          ),
        ),
      ],
    );
  }
}

class _AudioCacheManagement extends ConsumerStatefulWidget {
  final DeepVibeColors c;

  const _AudioCacheManagement({required this.c});

  @override
  ConsumerState<_AudioCacheManagement> createState() =>
      _AudioCacheManagementState();
}

class _AudioCacheManagementState extends ConsumerState<_AudioCacheManagement> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final c = widget.c;
    final settings = ref.watch(appSettingsProvider);
    final stats = ref.watch(audioCacheStatsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            _CacheMetric(
              c: c,
              label: '占用',
              value: stats.maybeWhen(
                data: (value) => value.displaySize,
                loading: () => '计算中',
                orElse: () => '无法读取',
              ),
            ),
            _CacheMetric(
              c: c,
              label: '文件',
              value: stats.maybeWhen(
                data: (value) => '${value.fileCount} 个',
                loading: () => '-',
                orElse: () => '-',
              ),
            ),
            _CacheMetric(
              c: c,
              label: '保留',
              value: '${settings.cacheRetentionDays} 天',
            ),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '自动清理',
                  style: TextStyle(color: c.textSecondary, fontSize: 12),
                ),
                const SizedBox(width: 6),
                Transform.scale(
                  scale: 0.82,
                  child: Switch(
                    key: const ValueKey('settings-cache-auto-cleanup-switch'),
                    value: settings.cacheAutoCleanupEnabled,
                    activeThumbColor: c.accent,
                    onChanged: (value) {
                      ref
                          .read(appSettingsProvider.notifier)
                          .setCacheAutoCleanupEnabled(value);
                    },
                  ),
                ),
              ],
            ),
            _CacheRetentionMenu(c: c, settings: settings),
            _SettingsActionButton(
              key: const ValueKey('settings-cache-clear-expired-button'),
              icon: Icons.auto_delete_outlined,
              label: '清理过期',
              c: c,
              onTap: _busy ? null : _clearExpired,
            ),
            _SettingsActionButton(
              key: const ValueKey('settings-cache-clear-button'),
              icon: Icons.delete_sweep_outlined,
              label: '立即清理',
              c: c,
              onTap: _busy ? null : _clearAll,
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _clearExpired() async {
    final settings = ref.read(appSettingsProvider);
    await _runCleanup(
      () => ref
          .read(audioCacheServiceProvider)
          .clearExpired(
            settings.cacheDirectory,
            retentionDays: settings.cacheRetentionDays,
          ),
    );
  }

  Future<void> _clearAll() async {
    final settings = ref.read(appSettingsProvider);
    await _runCleanup(
      () => ref.read(audioCacheServiceProvider).clear(settings.cacheDirectory),
    );
  }

  Future<void> _runCleanup(
    Future<AudioCacheCleanupResult> Function() cleanup,
  ) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final result = await cleanup();
      ref.invalidate(audioCacheStatsProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            result.fileCount == 0
                ? '没有需要清理的缓存'
                : '已清理 ${result.fileCount} 个缓存文件，释放 ${result.displayFreedSize}',
          ),
          duration: const Duration(seconds: 2),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('清理缓存失败'), duration: Duration(seconds: 2)),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _CacheRetentionMenu extends ConsumerWidget {
  final DeepVibeColors c;
  final AppSettings settings;

  const _CacheRetentionMenu({required this.c, required this.settings});

  static const _options = [3, 7, 14, 30];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return PopupMenuButton<int>(
      key: const ValueKey('settings-cache-retention-menu'),
      tooltip: '设置缓存保留天数',
      initialValue: settings.cacheRetentionDays,
      onSelected: (days) {
        ref.read(appSettingsProvider.notifier).setCacheRetentionDays(days);
      },
      itemBuilder: (context) => [
        for (final days in _options)
          PopupMenuItem(value: days, child: Text('$days 天')),
      ],
      child: Container(
        height: 32,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          color: c.background.withValues(alpha: 0.74),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: c.divider),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.schedule_outlined, size: 15, color: c.textSecondary),
            const SizedBox(width: 6),
            Text(
              '保留 ${settings.cacheRetentionDays} 天',
              style: TextStyle(color: c.textSecondary, fontSize: 12),
            ),
            const SizedBox(width: 4),
            Icon(Icons.expand_more, size: 16, color: c.textMuted),
          ],
        ),
      ),
    );
  }
}

class _CacheMetric extends StatelessWidget {
  final DeepVibeColors c;
  final String label;
  final String value;

  const _CacheMetric({
    required this.c,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 88, minHeight: 44),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: c.background.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: c.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: TextStyle(color: c.textMuted, fontSize: 11)),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              color: c.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final DeepVibeColors c;
  final VoidCallback? onTap;

  const _SettingsActionButton({
    super.key,
    required this.icon,
    required this.label,
    required this.c,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 15),
      label: Text(label),
      style:
          TextButton.styleFrom(
            foregroundColor: c.textSecondary,
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            minimumSize: const Size(0, 32),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(6),
            ),
          ).copyWith(
            overlayColor: WidgetStatePropertyAll(
              c.accent.withValues(alpha: 0.08),
            ),
          ),
    );
  }
}

class _SettingsSection extends StatelessWidget {
  final String title;
  final DeepVibeColors c;
  final List<Widget> children;

  const _SettingsSection({
    required this.title,
    required this.c,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 2, bottom: 8),
          child: Text(
            title,
            style: TextStyle(
              color: c.textSecondary,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: c.surface,
            borderRadius: BorderRadius.circular(kCardRadius),
            border: Border.all(color: c.divider),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0) Divider(height: 1, color: c.divider),
                children[i],
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _SettingsRow extends StatelessWidget {
  final String title;
  final String description;
  final DeepVibeColors c;
  final Widget child;

  const _SettingsRow({
    required this.title,
    required this.description,
    required this.c,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final stacked = constraints.maxWidth < 620;
        final label = _SettingsRowLabel(
          title: title,
          description: description,
          c: c,
        );

        if (stacked) {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [label, const SizedBox(height: 12), child],
            ),
          );
        }

        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              SizedBox(width: 210, child: label),
              const SizedBox(width: 22),
              Expanded(child: child),
            ],
          ),
        );
      },
    );
  }
}

class _SettingsRowLabel extends StatelessWidget {
  final String title;
  final String description;
  final DeepVibeColors c;

  const _SettingsRowLabel({
    required this.title,
    required this.description,
    required this.c,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: TextStyle(
            color: c.textPrimary,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          description,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: c.textMuted, fontSize: 12, height: 1.25),
        ),
      ],
    );
  }
}

class _LyricsColorSwatch extends StatelessWidget {
  final Color color;
  final bool selected;
  final DeepVibeColors c;
  final VoidCallback onTap;

  const _LyricsColorSwatch({
    super.key,
    required this.color,
    required this.selected,
    required this.c,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: '选择歌词颜色',
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            border: Border.all(
              color: selected ? c.accent : c.divider,
              width: selected ? 3 : 1,
            ),
          ),
          child: selected
              ? Icon(
                  Icons.check,
                  size: 16,
                  color: color.computeLuminance() > 0.6
                      ? Colors.black
                      : Colors.white,
                )
              : null,
        ),
      ),
    );
  }
}
