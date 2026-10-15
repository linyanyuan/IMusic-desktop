/**
 * 桌面端更新检查 / 下载 / 安装 —— 移植自 Flutter lib/services/update_service.dart。
 *
 * 放在主进程的原因：Electron 渲染进程没有 fs / child_process 权限（contextIsolation
 * + sandbox），而更新检查要落盘、要算 sha256、要拉起安装器。渲染层只通过 IPC 拿到
 * 状态机（见 src/state/update.ts）。
 *
 * 契约与 Dart 端保持一致：
 *   GET {base}/desktop-releases/desktop-update.json
 *   { "version": "1.0.1+2", "downloadUrl": "https://.../IMusic-Setup-1.0.1.exe",
 *     "sha256": "<64 位 hex>", "changelog": "..." }
 *
 * 版本比较复用 pub_semver 语义（Dart 端用的就是它）：先 major/minor/patch，再
 * pre-release，最后 **build 部分也参与比较**（`1.0.1+2 > 1.0.1+1 > 1.0.1`）。
 * 这点与严格 SemVer 不同，但对「每次打包 build 号自增」的桌面发布更有用，且必须
 * 与 Flutter 端行为一致，否则两端会出现「一端提示更新、另一端不提示」。
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import os from 'node:os'
import path from 'node:path'
import { ZIP_UPDATER_SCRIPT } from './zipUpdaterScript'

/**
 * 更新清单的默认来源。
 *
 * 打包发布走 GitHub Releases（见 .github/workflows/release-windows.yml），manifest 由
 * workflow 生成：{repo}/releases/download/{tag}/desktop-update.json。安装包地址同样
 * 指向 GitHub 的 release asset。
 *
 * 仍可用 IMUSIC_UPDATE_BASE_URL 覆盖（自建服务器 / QA 本地假服务）。
 */
export const DEFAULT_UPDATE_BASE_URL = 'https://github.com/linyanyuan/IMusic-desktop'
const UPDATE_MANIFEST_PATH = '/releases/latest/download/desktop-update.json'

/**
 * 下载域名白名单里始终放行的 host。
 *
 * GitHub 的 release asset 会 302 到 objects.githubusercontent.com，浏览器/Node 的
 * fetch 自动跟随重定向，而域名校验只针对 manifest 里的原始 URL，所以真正需要放行的
 * 是 github.com（清单与 asset 地址）。这里显式列出，避免有人把 baseUrl 改成别的
 * GitHub 镜像时漏掉。
 */
const ALWAYS_ALLOWED_HOSTS = ['github.com']

/** 静默检查的节流窗口（与 Dart 端 autoCheckThrottle 一致） */
const CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000
/** manifest 请求总超时 */
const MANIFEST_TIMEOUT_MS = 30_000
/** 下载空闲看门狗：连续这么久没有新数据就中止（对应 Dio 的 receiveTimeout 意图） */
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000
/** 进度上报间隔（字节），与 Dart 端 1MB 节流一致 */
const PROGRESS_STEP_BYTES = 1024 * 1024

export interface UpdateManifest {
  version: string
  downloadUrl: string
  sha256: string
  changelog: string | null
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  preRelease: (number | string)[]
  build: (number | string)[]
}

// ---------------------------------------------------------------------------
// 版本比较（pub_semver 的子集移植）
// ---------------------------------------------------------------------------

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/

function splitParts(text: string): (number | string)[] {
  return text
    .split('.')
    .filter((part) => part.length > 0)
    .map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : part))
}

export function parseVersion(text: string): ParsedVersion | null {
  const match = VERSION_RE.exec(text.trim())
  if (match == null) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    preRelease: match[4] != null ? splitParts(match[4]) : [],
    build: match[5] != null ? splitParts(match[5]) : [],
  }
}

/** 对应 pub_semver 的 _compareLists（SemVer 规则 12） */
function compareLists(a: (number | string)[], b: (number | string)[]): number {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const aPart = i < a.length ? a[i] : null
    const bPart = i < b.length ? b[i] : null
    if (aPart === bPart) continue
    // 缺失的部分排在存在的部分之前
    if (aPart == null) return -1
    if (bPart == null) return 1
    const aNum = typeof aPart === 'number'
    const bNum = typeof bPart === 'number'
    // 数字排在字符串之前
    if (aNum && bNum) return aPart < bPart ? -1 : 1
    if (aNum) return -1
    if (bNum) return 1
    return String(aPart) < String(bPart) ? -1 : 1
  }
  return 0
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1

  const aPre = a.preRelease.length > 0
  const bPre = b.preRelease.length > 0
  if (!aPre && bPre) return 1
  if (!bPre && aPre) return -1
  const preComparison = compareLists(a.preRelease, b.preRelease)
  if (preComparison !== 0) return preComparison

  const aBuild = a.build.length > 0
  const bBuild = b.build.length > 0
  if (!aBuild && bBuild) return -1
  if (!bBuild && aBuild) return 1
  return compareLists(a.build, b.build)
}

/** 无法解析的版本一律视为「无更新」（与 Dart 端 catch 后返回 false 一致） */
export function isUpdateAvailable(current: string, remote: string): boolean {
  const currentParsed = parseVersion(current)
  const remoteParsed = parseVersion(remote)
  if (currentParsed == null || remoteParsed == null) return false
  return compareVersions(remoteParsed, currentParsed) > 0
}

// ---------------------------------------------------------------------------
// manifest 解析
// ---------------------------------------------------------------------------

function readString(json: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = json[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return ''
}

/** 兼容 snake_case（服务端两种命名都出现过） */
export function parseManifest(raw: unknown): UpdateManifest | null {
  if (raw == null || typeof raw !== 'object') return null
  const json = raw as Record<string, unknown>
  const version = readString(json, 'version')
  const downloadUrl = readString(json, 'downloadUrl', 'download_url')
  const sha256 = readString(json, 'sha256')
  const changelog = readString(json, 'changelog', 'change_log')
  return {
    version,
    downloadUrl,
    sha256,
    changelog: changelog.length > 0 ? changelog : null,
  }
}

export function manifestIsValid(manifest: UpdateManifest | null): manifest is UpdateManifest {
  if (manifest == null) return false
  if (parseVersion(manifest.version) == null) return false
  if (!/^https?:\/\/[^\s]+$/.test(manifest.downloadUrl)) return false
  return /^[0-9a-fA-F]{64}$/.test(manifest.sha256)
}

/** 与 Dart 端 _installerName 一致：IMusic-Setup-{version}-{arch}.exe */
export function installerFileName(manifest: UpdateManifest): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const version = manifest.version.split('+')[0]
  return `IMusic-Setup-${version}-${arch}.exe`
}

// ---------------------------------------------------------------------------
// 服务本体
// ---------------------------------------------------------------------------

type ProgressListener = (progress: { received: number; total: number | null }) => void

export class UpdateService {
  private readonly baseUrl: string
  private downloadAbort: AbortController | null = null
  private downloading = false

  constructor(baseUrl?: string) {
    // 供 QA 用本地假 manifest 服务替换上游
    this.baseUrl =
      baseUrl ?? process.env.IMUSIC_UPDATE_BASE_URL ?? DEFAULT_UPDATE_BASE_URL
  }

  get currentVersion(): string {
    return app.getVersion()
  }

  get manifestUrl(): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${UPDATE_MANIFEST_PATH}`
  }

  /**
   * 出站地址白名单。
   *
   * 更新器会下载并**执行**拿到的东西，所以下载地址不能被远端 manifest 随便指向
   * 任意域名（否则 manifest 被篡改/MITM 就等于任意代码执行）。除了发布服务器本身
   * 的域名，只能用 IMUSIC_UPDATE_ALLOWED_HOSTS 显式追加（逗号分隔，QA 用本地
   * 假服务时需要）。这里比 Dart 端严格，是有意的。
   */
  private allowedHosts(): Set<string> {
    const hosts = new Set<string>()
    // 发布域名（GitHub Releases）始终放行
    for (const host of ALWAYS_ALLOWED_HOSTS) hosts.add(host)
    try {
      hosts.add(new URL(this.baseUrl).hostname.toLowerCase())
    } catch {
      // baseUrl 非法时白名单为空 → 所有请求都会被拒
    }
    for (const entry of (process.env.IMUSIC_UPDATE_ALLOWED_HOSTS ?? '').split(',')) {
      const host = entry.trim().toLowerCase()
      if (host.length > 0) hosts.add(host)
    }
    return hosts
  }

  private assertAllowedUrl(rawUrl: string, purpose: string): string {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw new Error(`${purpose}地址无效：${rawUrl}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`${purpose}协议不被允许：${url.protocol}`)
    }
    const host = url.hostname.toLowerCase()
    if (!this.allowedHosts().has(host)) {
      throw new Error(`${purpose}域名不在白名单内：${host}`)
    }
    return url.toString()
  }

  private get prefsPath(): string {
    return path.join(app.getPath('userData'), 'update-prefs.json')
  }

  private readLastCheck(): number | null {
    try {
      const raw = JSON.parse(readFileSync(this.prefsPath, 'utf8')) as Record<string, unknown>
      const value = raw['update_last_check_iso']
      if (typeof value !== 'string') return null
      const parsed = Date.parse(value)
      return Number.isNaN(parsed) ? null : parsed
    } catch {
      return null
    }
  }

  private writeLastCheck(when: Date): void {
    try {
      mkdirSync(path.dirname(this.prefsPath), { recursive: true })
      writeFileSync(
        this.prefsPath,
        JSON.stringify({ update_last_check_iso: when.toISOString() }, null, 2),
        'utf8',
      )
    } catch {
      // 节流时间戳写失败不影响更新流程
    }
  }

  private shouldAutoCheck(): boolean {
    const last = this.readLastCheck()
    if (last == null) return true
    return Date.now() - last >= CHECK_THROTTLE_MS
  }

  /** 拉取远端 manifest；网络/解析/校验失败一律返回 null（对应 Dart 端 catch → null） */
  async fetchManifest(options: { manual?: boolean } = {}): Promise<UpdateManifest | null> {
    if (!options.manual && !this.shouldAutoCheck()) return null
    try {
      const manifestUrl = this.assertAllowedUrl(this.manifestUrl, '更新清单')
      const response = await fetch(manifestUrl, {
        signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) return null
      const manifest = parseManifest(await response.json())
      if (!manifestIsValid(manifest)) return null
      this.writeLastCheck(new Date())
      return manifest
    } catch {
      return null
    }
  }

  /** 检查更新：返回远端版本 / 是否有更新 / 当前版本 */
  async check(manual: boolean): Promise<{
    currentVersion: string
    remote: UpdateManifest | null
    available: boolean
  }> {
    const currentVersion = this.currentVersion
    const remote = await this.fetchManifest({ manual })
    return {
      currentVersion,
      remote,
      available: remote != null && isUpdateAvailable(currentVersion, remote.version),
    }
  }

  /** 下载安装包到临时目录并校验 sha256；返回本地路径 */
  async download(manifest: UpdateManifest, onProgress?: ProgressListener): Promise<string> {
    if (!manifestIsValid(manifest)) throw new Error('更新清单无效，无法下载')
    if (this.downloading) throw new Error('已有下载任务进行中')

    const extension = installerExtension(manifest.downloadUrl)
    const dir = path.join(os.tmpdir(), 'imusic-updates')
    await fsp.mkdir(dir, { recursive: true })
    const fileName = extension === '.exe' ? installerFileName(manifest) : `imusic-update-${manifest.version}${extension}`
    const finalPath = path.join(dir, fileName)
    const partialPath = `${finalPath}.part`

    const controller = new AbortController()
    this.downloadAbort = controller
    this.downloading = true

    // 空闲看门狗：Dio 的 receiveTimeout 是「两个数据块之间」的超时，
    // 不是整个下载的总时长，这里用同样的语义。
    let idleTimer: NodeJS.Timeout | null = null
    const armIdleWatchdog = () => {
      if (idleTimer != null) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(new Error('下载超时：长时间没有数据')), DOWNLOAD_IDLE_TIMEOUT_MS)
    }
    const clearIdleWatchdog = () => {
      if (idleTimer != null) clearTimeout(idleTimer)
      idleTimer = null
    }

    try {
      armIdleWatchdog()
      const downloadUrl = this.assertAllowedUrl(manifest.downloadUrl, '安装包下载')
      const response = await fetch(downloadUrl, { signal: controller.signal })
      if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
      const totalHeader = response.headers.get('content-length')
      const total = totalHeader != null ? Number.parseInt(totalHeader, 10) : null
      if (response.body == null) throw new Error('下载失败：响应体为空')

      const hash = createHash('sha256')
      let received = 0
      let lastReported = 0
      onProgress?.({ received: 0, total })

      const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
      source.on('data', (chunk: Buffer) => {
        hash.update(chunk)
        received += chunk.length
        armIdleWatchdog()
        if (received - lastReported >= PROGRESS_STEP_BYTES) {
          lastReported = received
          onProgress?.({ received, total })
        }
      })

      await pipeline(source, createWriteStream(partialPath))
      clearIdleWatchdog()
      onProgress?.({ received, total: total ?? received })

      const digest = hash.digest('hex')
      if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) {
        await fsp.rm(partialPath, { force: true })
        throw new Error('安装包校验失败（sha256 不匹配），已删除下载文件')
      }

      // 校验通过后才落到最终文件名：.part 不会被当成可安装的包
      await fsp.rm(finalPath, { force: true })
      await fsp.rename(partialPath, finalPath)
      return finalPath
    } catch (error) {
      clearIdleWatchdog()
      await fsp.rm(partialPath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      clearIdleWatchdog()
      this.downloading = false
      this.downloadAbort = null
    }
  }

  /** 取消进行中的下载（用户关闭更新弹窗） */
  cancelDownload(): void {
    this.downloadAbort?.abort(new Error('用户取消下载'))
  }

  /**
   * 拉起安装器并退出当前进程。
   * .exe → 直接执行（NSIS）；.msi → msiexec；.zip → PowerShell 绿色包更新脚本。
   */
  async installAndQuit(filePath: string): Promise<void> {
    const extension = path.extname(filePath).toLowerCase()
    if (extension === '.exe') {
      const installer = spawn(filePath, [], { detached: true, stdio: 'ignore' })
      installer.unref()
      setTimeout(() => app.exit(0), 300)
      return
    }
    if (extension === '.msi') {
      const installer = spawn('msiexec.exe', ['/i', filePath], { detached: true, stdio: 'ignore' })
      installer.unref()
      app.exit(0)
      return
    }
    if (extension === '.zip') {
      await this.runZipUpdater(filePath)
      return
    }
    throw new Error(`不支持的安装包类型: ${extension}`)
  }

  /** 绿色包更新：脚本会等当前进程退出、覆盖安装目录、再拉起新版本 */
  private async runZipUpdater(zipPath: string): Promise<void> {
    if (process.platform !== 'win32') {
      throw new Error('绿色包（zip）更新仅支持 Windows')
    }
    const targetDir = path.dirname(process.execPath)
    const exeName = path.basename(process.execPath)
    const scriptPath = path.join(os.tmpdir(), `imusic-updater-${Date.now()}.ps1`)
    await fsp.writeFile(scriptPath, ZIP_UPDATER_SCRIPT, 'utf8')

    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        scriptPath,
        '-ZipPath',
        zipPath,
        '-TargetDir',
        targetDir,
        '-ExePath',
        process.execPath,
        '-CurrentPid',
        String(process.pid),
        '-ExeName',
        exeName,
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    )

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    // 脚本前 800ms 的快速失败（参数错误等）应当报给用户，而不是静默退出应用
    const exitedEarly = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 800)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })

    if (exitedEarly) {
      throw new Error(`更新脚本启动失败：${stderr.trim() || '未知错误'}`)
    }
    child.unref()
    app.exit(0)
  }
}

/** 从下载地址推断安装包类型；不支持的扩展名直接报错（与 Dart 端一致） */
export function installerExtension(url: string): '.exe' | '.msi' | '.zip' {
  const pathname = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return url
    }
  })().toLowerCase()
  if (pathname.endsWith('.exe')) return '.exe'
  if (pathname.endsWith('.msi')) return '.msi'
  if (pathname.endsWith('.zip')) return '.zip'
  throw new Error('不支持的安装包类型（仅支持 .exe / .msi / .zip）')
}

// ---------------------------------------------------------------------------
// IPC 注册
// ---------------------------------------------------------------------------

let service: UpdateService | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function registerUpdateIpc(getWindow?: () => BrowserWindow | null): UpdateService {
  service = new UpdateService()
  const svc = service

  ipcMain.handle('imusic:updateInfo', () => ({
    currentVersion: svc.currentVersion,
    manifestUrl: svc.manifestUrl,
  }))

  ipcMain.handle('imusic:updateCheck', async (_event, manual: boolean) => {
    const result = await svc.check(manual === true)
    return result
  })

  ipcMain.handle('imusic:updateDownload', async (_event, manifest: UpdateManifest) => {
    const filePath = await svc.download(manifest, (progress) => {
      broadcast('imusic:updateProgress', progress)
    })
    return { filePath }
  })

  ipcMain.handle('imusic:updateInstall', async (_event, filePath: string) => {
    await svc.installAndQuit(filePath)
    return { ok: true }
  })

  ipcMain.handle('imusic:updateCancel', () => {
    svc.cancelDownload()
    return { ok: true }
  })

  // getWindow 目前只用于日志/未来扩展；保留参数以对齐其他 register* 的签名
  void getWindow
  return svc
}

export function currentUpdateService(): UpdateService | null {
  return service
}
