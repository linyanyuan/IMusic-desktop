/**
 * 更新弹窗 —— 移植自 Flutter lib/desktop/widgets/update_dialog.dart。
 *
 * 四种形态（发现新版本 / 正在下载 / 下载完成 / 更新失败）共用同一个外壳，
 * 文案与按钮顺序与 Dart 端逐一对齐。
 *
 * 加了 data-update-state / data-update-version 两个机器可读属性，
 * 便于 QA 探针断言状态机（同 LyricsDrawer 的 data-lyric-time 做法）。
 */

import { Modal } from './Modal'
import {
  dismissUpdate,
  downloadUpdate,
  installAndQuit,
  useUpdateState,
} from '../state/update'

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ChangelogBox({ text, subtitle }: { text: string | null; subtitle?: string }) {
  return (
    <div className="space-y-2">
      {subtitle != null && <p className="text-[13px] text-[#FA233B]">{subtitle}</p>}
      <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-black/5 bg-black/[0.03] p-3 text-[14px] leading-relaxed text-[#6E6E73]">
        {text != null && text.trim().length > 0 ? text : '暂无更新说明'}
      </div>
    </div>
  )
}

function ProgressBody({ received, total }: { received: number; total: number | null }) {
  const fraction = total != null && total > 0 ? received / total : null
  return (
    <div className="space-y-2">
      <div className="h-1.5 w-full overflow-hidden rounded bg-black/10">
        <div
          className="h-full rounded bg-[#FA233B] transition-[width] duration-300"
          style={{ width: fraction == null ? '40%' : `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <p className="text-[12px] text-[#6E6E73]">
        {fraction == null
          ? `已下载 ${formatSize(received)}`
          : `已下载 ${formatSize(received)} / ${formatSize(total ?? 0)}  ·  ${(fraction * 100).toFixed(0)}%`}
      </p>
    </div>
  )
}

function Actions({
  onSecondary,
  onPrimary,
}: {
  onSecondary?: { label: string; action: string; onClick: () => void }
  onPrimary?: { label: string; action: string; onClick: () => void }
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      {onSecondary != null && (
        <button
          type="button"
          data-update-action={onSecondary.action}
          onClick={onSecondary.onClick}
          className="rounded-md px-3.5 py-2 text-[13px] text-[#6E6E73] transition-colors hover:bg-black/5"
        >
          {onSecondary.label}
        </button>
      )}
      {onPrimary != null && (
        <button
          type="button"
          data-update-action={onPrimary.action}
          onClick={onPrimary.onClick}
          className="rounded-md bg-[#FA233B] px-4.5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        >
          {onPrimary.label}
        </button>
      )}
    </div>
  )
}

export function UpdateDialog() {
  const state = useUpdateState()
  // idle / upToDate 不开弹窗（upToDate 只在设置页体现）
  if (state.kind === 'idle' || state.kind === 'checking' || state.kind === 'upToDate') return null

  const title =
    state.kind === 'available'
      ? `发现新版本 v${state.manifest.version}`
      : state.kind === 'downloading'
        ? '正在下载更新'
        : state.kind === 'downloaded'
          ? '下载完成，可以更新'
          : '更新失败'

  return (
    <Modal open title={title} onClose={dismissUpdate} width={432}>
      <div data-update-state={state.kind} data-update-version={
        state.kind === 'available' || state.kind === 'downloading' || state.kind === 'downloaded'
          ? state.manifest.version
          : ''
      } className="space-y-5">
        {state.kind === 'available' && <ChangelogBox text={state.manifest.changelog} />}
        {state.kind === 'downloading' && (
          <ProgressBody received={state.received} total={state.total} />
        )}
        {state.kind === 'downloaded' && (
          <ChangelogBox
            text={state.manifest.changelog}
            subtitle="软件会退出并替换当前版本，完成后自动重新打开。"
          />
        )}
        {state.kind === 'error' && (
          <div className="rounded-md border border-black/5 bg-black/[0.03] p-3 text-[14px] leading-relaxed text-[#B25000]">
            {state.message}
          </div>
        )}

        {state.kind === 'available' && (
          <Actions
            onSecondary={{ label: '稍后', action: 'dismiss', onClick: dismissUpdate }}
            onPrimary={{
              label: '立即下载',
              action: 'download',
              onClick: () => void downloadUpdate(),
            }}
          />
        )}
        {state.kind === 'downloading' && (
          <Actions
            onSecondary={{ label: '取消', action: 'dismiss', onClick: dismissUpdate }}
          />
        )}
        {state.kind === 'downloaded' && (
          <Actions
            onSecondary={{ label: '稍后更新', action: 'dismiss', onClick: dismissUpdate }}
            onPrimary={{
              label: '立即更新并退出',
              action: 'install',
              onClick: () => void installAndQuit(),
            }}
          />
        )}
        {state.kind === 'error' && (
          <Actions
            onPrimary={{ label: '好的', action: 'dismiss', onClick: dismissUpdate }}
          />
        )}
      </div>
    </Modal>
  )
}
