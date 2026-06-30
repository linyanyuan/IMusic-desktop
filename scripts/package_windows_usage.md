# Windows 打包速查

脚本位置：

```powershell
.\scripts\package_windows.ps1
```

## 1. 普通打包

大多数情况下用这个。它会生成可直接运行的 Windows 绿色版目录、zip，以及软件内更新需要的 `desktop-update.json`：

把版本号和构建号换成你要发布的：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_windows.ps1 -Version 1.0.1 -BuildNumber 2 -Changelog "修复若干问题，优化更新体验"
```

如果你不小心写成了 `package_windows_windows.ps1`，项目里也提供了兼容入口，可以继续转发到正确脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_windows_windows.ps1 -Version 1.0.1 -BuildNumber 2 -Changelog "修复若干问题，优化更新体验"
```

执行后会生成：

```text
dist\imusic-1.0.1+2-windows-x64\
dist\imusic-1.0.1+2-windows-x64.zip
dist\releases\imusic-1.0.1+2-windows-x64.zip
dist\releases\desktop-update.json
dist\releases\update-manifest-1.0.1.json
dist\releases\UPLOAD_TO_SERVER.txt
```

## 2. 上传到服务器

把 `dist\releases\` 里面的文件上传到服务器：

```text
/opt/imusic-desktop/releases
```

不要上传到 `/opt/imusic/server/releases`，那个目录用于移动端 APK 等发布文件。

示例：

```powershell
scp .\dist\releases\* root@60.205.218.90:/opt/imusic-desktop/releases/
```

也可以用项目里的上传脚本，它会上传后自动验证 `desktop-update.json`：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish_releases.ps1
```

客户端会读取：

```text
http://60.205.218.90:8787/desktop-releases/desktop-update.json
```

更新包下载地址会类似：

```text
http://60.205.218.90:8787/desktop-releases/imusic-1.0.1%2B2-windows-x64.zip
```

上传后先用浏览器或 PowerShell 检查：

```powershell
Invoke-WebRequest http://60.205.218.90:8787/desktop-releases/desktop-update.json
```

## 3. 测试软件内更新

1. 先安装或运行旧版本，例如 `1.0.0+1`。
2. 打包新版本时 `Version` 必须变大，例如 `1.0.1`。只增加 `BuildNumber` 不会触发更新。
3. 上传 `dist\releases\*` 到服务器。
4. 打开旧版本软件，进入设置里手动检查更新，或重启软件等待自动检查。
5. 点击下载，下载完成后点击立即更新并退出。

## 4. 可选：带安装器发布

只有你已经用 Inno Setup、NSIS、Advanced Installer 等工具提前生成了安装包，才使用 `-InstallerPath`。

`-InstallerPath` 不是“生成安装包”的意思，而是“把已经存在的安装包复制到 releases 目录，并为它生成自动更新 manifest”。

如果你还没有这个文件：

```text
.\IMusic-Setup-1.0.1.exe
```

不要复制下面这条命令，先用“普通打包”。

如果你已经有安装包，例如 `IMusic-Setup-1.0.1.exe`，用这个：

推荐复制这一行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_windows.ps1 -Version 1.0.1 -BuildNumber 2 -InstallerPath .\IMusic-Setup-1.0.1.exe -Changelog "修复若干问题，优化更新体验"
```

多行版本如下：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_windows.ps1 `
  -Version 1.0.1 `
  -BuildNumber 2 `
  -InstallerPath .\IMusic-Setup-1.0.1.exe `
  -Changelog "修复若干问题，优化更新体验"
```

执行后会额外生成：

```text
dist\releases\IMusic-Setup-1.0.1.exe
dist\releases\desktop-update.json
dist\releases\update-manifest-1.0.1.json
dist\releases\UPLOAD_TO_SERVER.txt
```

## 5. 版本号怎么填

每次发新版时递增：

```text
1.0.1+2
1.0.2+3
1.1.0+4
```

脚本里分开写：

```powershell
-Version 1.0.2 -BuildNumber 3
```

`Version` 是用户看到的版本号，`BuildNumber` 是构建号，建议每次发布都加 1。

注意：软件内更新判断主要看 `Version`。如果旧版是 `1.0.1+1`，你只打 `1.0.1+2`，软件不会认为这是新版；要打 `1.0.2+2`。

## 6. 常见报错

如果提示：

```text
-File 形式参数的实际参数“.\scripts\package_windows_windows.ps1”不存在
```

说明脚本名写错了。正确脚本是：

```text
.\scripts\package_windows.ps1
```

项目也提供了同名兼容入口 `.\scripts\package_windows_windows.ps1`，拉取最新代码后再执行即可。

如果提示：

```text
InstallerPath does not exist
```

说明 `-InstallerPath` 后面的安装包路径不存在。先确认当前目录下真的有这个文件：

```powershell
Get-ChildItem .\IMusic-Setup-1.0.1.exe
```

如果没有这个文件，就不要传 `-InstallerPath`，改用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_windows.ps1 -Version 1.0.1 -BuildNumber 2
```

如果提示：

```text
Close the running release app before packaging
```

说明旧的 `imusic.exe` 正在运行。先关闭软件，再重新执行打包命令。

如果自动更新没检测到新版，检查服务器上有没有这个文件：

```text
/opt/imusic-desktop/releases/desktop-update.json
```

并确认浏览器能打开：

```text
http://60.205.218.90:8787/desktop-releases/desktop-update.json
```
