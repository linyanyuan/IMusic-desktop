import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../update/update_providers.dart';

/// Update dialog shown when a new version is available. Tracks the update
/// flow via [updateCheckStateProvider]; DeepVibe-themed to match the login
/// dialog.
class UpdateDialog extends ConsumerWidget {
  const UpdateDialog({super.key});

  static DeepVibeColors _colors(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark
        ? DeepVibeColors.dark
        : DeepVibeColors.light;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = _colors(context);
    final state = ref.watch(updateCheckStateProvider);

    final String title;
    final Widget body;
    final List<Widget> actions;

    switch (state) {
      case UpdateAvailable(:final manifest):
        title = '发现新版本 v${manifest.version}';
        body = _ChangelogBody(c: c, text: manifest.changelog);
        actions = [
          _TextButton(
            c: c,
            label: '稍后',
            onTap: () => UpdateActions.dismissUpdate(ref),
          ),
          _PrimaryButton(
            c: c,
            label: '立即下载',
            onTap: () => UpdateActions.downloadUpdate(ref),
          ),
        ];
      case UpdateDownloading(:final received, :final total):
        title = '正在下载更新';
        body = _ProgressBody(c: c, received: received, total: total);
        actions = [
          _TextButton(
            c: c,
            label: '取消',
            onTap: () => UpdateActions.dismissUpdate(ref),
          ),
        ];
      case UpdateDownloaded(:final manifest):
        title = '下载完成，可以更新';
        body = _ChangelogBody(
          c: c,
          text: manifest.changelog,
          subtitle: '软件会退出并替换当前版本，完成后自动重新打开。',
        );
        actions = [
          _TextButton(
            c: c,
            label: '稍后更新',
            onTap: () => UpdateActions.dismissUpdate(ref),
          ),
          _PrimaryButton(
            c: c,
            label: '立即更新并退出',
            onTap: () => UpdateActions.installAndQuit(ref),
          ),
        ];
      case UpdateError(:final message):
        title = '更新失败';
        body = _ErrorBody(c: c, message: message);
        actions = [
          _PrimaryButton(
            c: c,
            label: '好的',
            onTap: () => UpdateActions.dismissUpdate(ref),
          ),
        ];
      default:
        // Dialog is only opened while in a non-idle state; reaching idle
        // here means the flow was dismissed elsewhere — render nothing.
        return const SizedBox.shrink();
    }

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
              color: c.surface,
              borderRadius: BorderRadius.circular(kCardRadius),
              border: Border.all(color: c.border),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.24),
                  blurRadius: 42,
                  offset: const Offset(0, 22),
                ),
              ],
            ),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(26, 24, 26, 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: c.textPrimary,
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 12),
                  body,
                  const SizedBox(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: actions,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ChangelogBody extends StatelessWidget {
  const _ChangelogBody({required this.c, required this.text, this.subtitle});
  final DeepVibeColors c;
  final String text;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (subtitle != null) ...[
          Text(subtitle!, style: TextStyle(color: c.accent, fontSize: 13)),
          const SizedBox(height: 8),
        ],
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: c.surfaceVariant,
            borderRadius: BorderRadius.circular(6),
            border: Border.all(color: c.divider),
          ),
          child: Text(
            text.isEmpty ? '暂无更新说明' : text,
            style: TextStyle(color: c.textSecondary, fontSize: 14, height: 1.4),
          ),
        ),
      ],
    );
  }
}

class _ProgressBody extends StatelessWidget {
  const _ProgressBody({
    required this.c,
    required this.received,
    required this.total,
  });
  final DeepVibeColors c;
  final int received;
  final int? total;

  @override
  Widget build(BuildContext context) {
    final frac = total != null && total! > 0 ? received / total! : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: frac,
            minHeight: 6,
            backgroundColor: c.divider,
            color: c.accent,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          frac == null
              ? '已下载 ${_mb(received)}'
              : '已下载 ${_mb(received)} / ${_mb(total!)}  ·  ${(frac * 100).toStringAsFixed(0)}%',
          style: TextStyle(color: c.textSecondary, fontSize: 12),
        ),
      ],
    );
  }

  static String _mb(int bytes) {
    if (bytes <= 0) return '0 MB';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

class _ErrorBody extends StatelessWidget {
  const _ErrorBody({required this.c, required this.message});
  final DeepVibeColors c;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: c.surfaceVariant,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: c.divider),
      ),
      child: Text(
        message,
        style: TextStyle(color: c.warning, fontSize: 14, height: 1.4),
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({
    required this.c,
    required this.label,
    required this.onTap,
  });
  final DeepVibeColors c;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: onTap,
      style: FilledButton.styleFrom(
        backgroundColor: c.accent,
        foregroundColor: Colors.black,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      ),
      child: Text(label),
    );
  }
}

class _TextButton extends StatelessWidget {
  const _TextButton({
    required this.c,
    required this.label,
    required this.onTap,
  });
  final DeepVibeColors c;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        foregroundColor: c.textSecondary,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      ),
      child: Text(label),
    );
  }
}
