# Windows 打包速查

脚本位置：

```powershell
.\scripts\package_windows.ps1
```

## 1. 普通打包

把版本号和构建号换成你要发布的：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_windows.ps1 -Version 1.0.1 -BuildNumber 2
```

如果你不小心写成了 `package_windows_windows.ps1`，项目里也提供了兼容入口，可以继续转发到正确脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_windows_windows.ps1 -Version 1.0.1 -BuildNumber 2
```

执行后会生成：

```text
dist\imusic-1.0.1+2-windows-x64\
dist\imusic-1.0.1+2-windows-x64.zip
```

## 2. 带自动更新文件

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

## 3. 上传到服务器

把 `dist\releases\` 里面的文件上传到服务器：

```text
/opt/imusic-desktop/releases
```

示例：

```powershell
scp .\dist\releases\* root@60.205.218.90:/opt/imusic-desktop/releases/
```

客户端会读取：

```text
http://60.205.218.90:8787/releases/desktop-update.json
```

安装包下载地址会类似：

```text
http://60.205.218.90:8787/releases/IMusic-Setup-1.0.1.exe
```

## 4. 版本号怎么填

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

## 5. 常见报错

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
http://60.205.218.90:8787/releases/desktop-update.json
```
