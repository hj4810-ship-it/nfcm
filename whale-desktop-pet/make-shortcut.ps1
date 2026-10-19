# 在桌面创建「鲸鱼娘桌宠」快捷方式
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $here "start.cmd"
$icon = Join-Path $here "assets\icon.ico"

if (-not (Test-Path $target)) { throw "找不到 start.cmd：$target" }

$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "鲸鱼娘桌宠.lnk"

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = $target
$lnk.WorkingDirectory = $here
$lnk.Description = "鲸鱼娘桌面宠物"
$lnk.WindowStyle = 7

# 图标用 assets\icon.ico（由 daily-eat 形象转出来的多尺寸 ico）
if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }

$lnk.Save()
Write-Output "已创建：$lnkPath"
Write-Output "图标：$icon"