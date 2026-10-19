// 预加载脚本：只把必要的 IPC 能力暴露给渲染进程（contextIsolation 开启）
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petHost", {
  /** 拉取初始化数据：素材根目录、可用形象、窗口状态、台词 */
  init: () => ipcRenderer.invoke("pet:init"),

  /** 开始拖拽：主进程接管，用系统光标位置移动窗口 */
  dragStart: (pointer) => ipcRenderer.send("pet:drag-start", pointer),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),

  /** 请求原生右键菜单 */
  openMenu: () => ipcRenderer.send("pet:menu"),

  /** 主进程主动切换形象时通知渲染进程 */
  onStateChange: (fn) => ipcRenderer.on("pet:state", (_e, name) => fn(name)),

  /** 通知主进程「点击了一下」：用于气泡与随机反应 */
  poke: (kind) => ipcRenderer.send("pet:poke", kind)
});
