# 鲸鱼娘桌面宠物（独立窗口版）

把 DSH 里的鲸鱼娘「放到桌面上」：透明背景、无边框、始终置顶的独立小窗口，
可以被拖到屏幕任意位置，不受 DSH 窗口边界限制。

## 为什么原来出不了 DSH 界面

DSH 的 `dsh-whale-musume` 插件是**渲染进程里的 DOM**：

- `lib/client.js` 把样式和脚本塞进页面 `document.body`，鲸鱼娘只是页面上的一个元素；
- 宿主（`lib/index.js`）只提供了一个只读静态资源路由，**没有开放任何"创建窗口"的能力**；
- 于是她的活动范围就是 DSH 窗口的可见区域，鼠标拖拽也只是在页面坐标系里移动 DOM。

要真正站到桌面上，必须有一个系统级窗口（透明 + 置顶 + 无边框）。这只能用
Electron 在主进程里创建 —— 所以这个目录是一个独立的小程序，而不是插件。

## 运行

双击 `start.cmd`，或者先建一个桌面快捷方式：

```powershell
powershell -ExecutionPolicy Bypass -File .\make-shortcut.ps1
```

启动后：

| 操作 | 效果 |
|---|---|
| 按住左键拖动 | 把她拖到桌面任意位置（移动的是窗口本身） |
| 单击 | 冒个泡说句话 + 随机换个表情 |
| 右键 | 原生菜单：换形象 / 大小 / 置顶 / 鼠标穿透 / 回到右下角 / 退出 |
| 托盘图标 | 单击 = 取消鼠标穿透；右键 = 同一套菜单 |

位置、大小、当前形象会存到 `%APPDATA%\WhaleDesktopPet\pet-state.json`，下次启动还原。

## 素材从哪来

按顺序找：

1. 命令行 `--assets=<目录>`
2. 已安装的 DSH 插件：`%LOCALAPPDATA%\dsh-plugins\dsh-whale-musume\assets\generated`（95 张状态图，效果最全）
3. 本目录自带的 `assets/`（6 张常用表情，换台机器也能跑）

> 注意：第 2 项依赖插件源码目录还在。删了也能用，只是形象不齐。

## 代码结构

```
main.js            主进程：窗口、拖拽、托盘、菜单、DPI 自校正
preload.js         contextBridge 暴露的最小 IPC 面
renderer/
  index.html       只有一个 img + 气泡
  pet.css          透明窗口样式、呼吸/回弹动画
  pet.js           形象切换、点击反应、拖拽手势识别
assets/            兜底素材 + 托盘图标
start.cmd          正常启动
start-debug.cmd    带 _run.log 的启动（排查用）
```

## 踩过的坑（都写进代码注释了）

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动即 `c0000005` 崩溃 | `app.requestSingleInstanceLock()` 要建命名管道，受限环境里崩 | 改成 pid 文件软互斥 |
| 同上 | `app.getPath("userData")` 触发 Chromium 建档初始化，同样会崩 | 改用固定目录 `WHALE_PET_DATA`，启动器先 `mkdir` |
| 窗口按 1.5×1.5 被放大 | 父进程 DPI 感知不同导致重复缩放 | 加载后读 `innerWidth` 反算，自动改回目标尺寸 |
| 托盘/窗口不出现 | `--user-data-dir` 指向的目录不存在 | 启动器先建目录再传参 |

## 已知限制

- 仍然是 Electron 程序，约 150MB 的运行时占位（`.tools/electron44`），不属于正常发行方式；
  真要分发给别人，需要用 electron-builder 打包成单文件 exe。
- 目前不读取 DSH 的会话状态（不会因为你写代码就变成 working 表情）。
  想联动的话，可以在 `main.js` 里轮询 DSH 的本地 API，再用 `win.webContents.send("pet:state", …)` 驱动。
- `--no-sandbox` 是为了兼容受限父进程；窗口只加载本地文件，不加载远程内容。
