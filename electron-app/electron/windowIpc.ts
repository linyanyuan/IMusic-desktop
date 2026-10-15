import { ipcMain, BrowserWindow } from 'electron'

/** 无边框窗口控制 IPC */
export function registerWindowIpc(getWindow: () => BrowserWindow | null) {
  ipcMain.handle('imusic:winMinimize', () => getWindow()?.minimize())
  ipcMain.handle('imusic:winMaximize', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('imusic:winClose', () => getWindow()?.close())
  ipcMain.handle('imusic:winIsMaximized', () => getWindow()?.isMaximized() ?? false)
}
