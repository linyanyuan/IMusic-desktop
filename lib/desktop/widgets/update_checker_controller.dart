import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../update/update_providers.dart';
import 'update_dialog.dart';

/// Mounted in the desktop shell's overlay Stack. Triggers an automatic
/// (throttled) update check shortly after startup and surfaces the result via
/// [UpdateDialog]. Auto-check failures are silent (per update_providers), so
/// this never disturbs the user unless a new version is actually available.
///
/// Dialog open/close is driven entirely from [updateCheckStateProvider]: any
/// active state opens the dialog, a transition back to idle/up-to-date closes
/// it. [UpdateDialog] buttons only mutate state (dismiss/install), never pop
/// the dialog themselves — avoiding rebuild-races between state and overlay.
///
/// Mirrors the inert-controller pattern of [DesktopLyricsWindowController].
class UpdateCheckerController extends ConsumerStatefulWidget {
  const UpdateCheckerController({super.key});

  @override
  ConsumerState<UpdateCheckerController> createState() =>
      _UpdateCheckerControllerState();
}

class _UpdateCheckerControllerState
    extends ConsumerState<UpdateCheckerController> {
  bool _dialogOpen = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      UpdateActions.checkForUpdates(ref, manual: false);
    });
  }

  bool _isDialogState(UpdateCheckState s) {
    return s is UpdateAvailable ||
        s is UpdateDownloading ||
        s is UpdateDownloaded ||
        s is UpdateError;
  }

  void _openDialog() {
    if (_dialogOpen || !mounted) return;
    _dialogOpen = true;
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const UpdateDialog(),
    ).then((_) => _dialogOpen = false);
  }

  void _closeDialog() {
    if (!_dialogOpen || !mounted) return;
    Navigator.of(context, rootNavigator: true).pop();
    _dialogOpen = false;
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<UpdateCheckState>(updateCheckStateProvider, (prev, next) {
      final wasDialog = prev != null && _isDialogState(prev);
      final isDialog = _isDialogState(next);
      if (isDialog && !wasDialog) {
        _openDialog();
      } else if (!isDialog && wasDialog) {
        _closeDialog();
      }
    });

    return const SizedBox.shrink();
  }
}