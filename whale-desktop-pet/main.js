// 鲸鱼娘桌面宠物 —— 主进程
//
// 为什么需要这个独立程序：
//   DSH 的鲸鱼娘插件是「渲染进程里的 DOM」，只能在 DSH 窗口的可见区域内活动，
//   宿主也没有向插件开放创建系统窗口的 API。想让她站到桌面上，就必须有一个
//   属于自己的、透明的、置顶的系统窗口 —— 就是这个 Electron 小程序。
//
// 设计要点：
//   · 窗口透明、无边框、不进任务栏、始终置顶，里面只画她本人；
//   · 拖拽移动的是「整个窗口」，所以她能被拖到屏幕任意角落，不受 DSH 窗口限制；
//   · 素材直接复用 dsh-whale-musume 的 95 张状态图（找不到时退回自带素材）；
//   · 不调用 app.getPath()/requestSingleInstanceLock()：这两个 API 在受限环境里
//     会触发 Electron 早期初始化并原生崩溃，这里改用固定数据目录 + pid 文件。
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  screen,
  shell
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

// ---------------------------------------------------------------- 常量与状态
const APP_TITLE = "鲸鱼娘桌宠";
const BASE_SIZE = 320; // 缩放 1.0 时的窗口逻辑边长
const SCALES = { small: 0.7, medium: 1, large: 1.35 };
const DEFAULT_STATES = ["idle-cute", "wink", "blush", "tail-swing", "sleep"];

// 点击时的随机反应（没有对应素材会自动跳过）
const REACTIONS = [
  "curious", "blush", "wink", "celebrate", "thinking", "meme-heart",
  "greet", "star", "teasing", "meme-smile-pain", "tail-swing", "pick-up"
];

const LINES = [
  "今天也要好好写代码哦～",
  "这段逻辑……要不要再想想？",
  "喝口水吧，我帮你看着终端。",
  "唔…这个报错看起来挺眼熟的。",
  "主人，我已经在这待了一整天啦。",
  "要不要休息五分钟？",
  "别熬夜啦，明天再改也来得及。",
  "我在这里，不会走的。"
];

const state = {
  scale: "medium",
  alwaysOnTop: true,
  clickThrough: false,
  stateName: "idle-cute",
  x: null,
  y: null
};

let win = null;
let tray = null;
let dragTimer = null;
let dragOffset = null;
let sizeFactor = 1; // 实测 DPI 补偿系数（某些启动上下文里 DPI 会被重复缩放）
let sizeNormalized = false;

// ---------------------------------------------------------------- 路径与存档
// 刻意不用 app.getPath("userData")：它会在 Electron 早期触发用户档案初始化，
// 在受限环境里会直接原生崩溃。这里用固定目录，启动器会先建好。
const DATA_DIR =
  process.env.WHALE_PET_DATA ||
  path.join(process.env.APPDATA || process.env.LOCALAPPDATA || __dirname, "WhaleDesktopPet");

const STATE_FILE = path.join(DATA_DIR, "pet-state.json");
const PID_FILE = path.join(DATA_DIR, "pet.pid");

function loadState() {
  try {
    Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
  } catch {
    /* 首次运行没有存档，用默认值 */
  }
}

function saveState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    /* 存不下就下次再说，不影响运行 */
  }
}

// 单实例：不用 requestSingleInstanceLock（它要建命名管道/互斥量，会崩），用 pid 文件
function otherInstanceRunning() {
  if (process.argv.includes("--allow-multiple")) return false;
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    if (!pid || pid === process.pid) return false;
    process.kill(pid, 0); // 只探活，不真的发信号
    return true;
  } catch {
    return false;
  }
}

function claimPidFile() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
  } catch {
    /* ignore */
  }
}

function releasePidFile() {
  try {
    if (Number(fs.readFileSync(PID_FILE, "utf8").trim()) === process.pid) fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- 素材
/**
 * 素材根目录解析顺序：
 * 1) 命令行 --assets=<目录>
 * 2) 已安装的 DSH 鲸鱼娘插件（95 张状态图，效果最好）
 * 3) 本应用自带的 assets/（换台机器也能跑）
 */
function resolveAssetsRoot() {
  const arg = process.argv.find((a) => a.startsWith("--assets="));
  if (arg) {
    const dir = path.resolve(arg.slice("--assets=".length));
    if (fs.existsSync(dir)) return dir;
  }
  const fromPlugin = path.join(
    process.env.LOCALAPPDATA || process.env.APPDATA || "",
    "dsh-plugins",
    "dsh-whale-musume",
    "assets",
    "generated"
  );
  if (fs.existsSync(fromPlugin)) return fromPlugin;
  return path.join(__dirname, "assets");
}

function listStates(root) {
  const names = new Set();
  try {
    for (const file of fs.readdirSync(root)) {
      const m = /^dsh-whale-state-(.+)\.webp$/i.exec(file);
      if (m) names.add(m[1]);
    }
  } catch {
    /* 目录不可读时返回空集合，渲染端会显示兜底提示 */
  }
  return [...names].sort();
}

// ---------------------------------------------------------------- 窗口几何
function targetSize() {
  return Math.round(BASE_SIZE * (SCALES[state.scale] || 1) * sizeFactor);
}

function clampToDisplay(x, y, size) {
  const displays = screen.getAllDisplays();
  const host =
    displays.find((d) => {
      const b = d.workArea;
      return x + size > b.x && x < b.x + b.width && y + size > b.y && y < b.y + b.height;
    }) || screen.getPrimaryDisplay();
  const b = host.workArea;
  return {
    x: Math.min(Math.max(x, b.x - Math.round(size * 0.4)), b.x + b.width - Math.round(size * 0.6)),
    y: Math.min(Math.max(y, b.y - Math.round(size * 0.2)), b.y + b.height - Math.round(size * 0.6))
  };
}

/** 默认位置：主屏右下角（任务栏上方） */
function cornerPosition(size) {
  const b = screen.getPrimaryDisplay().workArea;
  return { x: b.x + b.width - size - Math.round(24 * sizeFactor), y: b.y + b.height - size - Math.round(12 * sizeFactor) };
}

function restorePosition(size) {
  if (state.x === null || state.y === null) return cornerPosition(size);
  return clampToDisplay(state.x, state.y, size);
}

function applyBounds(x, y, size) {
  if (!win) return;
  win.setBounds({ x, y, width: size, height: size });
}

/**
 * DPI 自校正：某些启动上下文（父进程 DPI 感知设置不同）会让窗口按 1.5×1.5 被放大。
 * 窗口加载后对比渲染端的 innerWidth 与我们要的逻辑尺寸，按比例把窗口改回来。
 */
async function normalizeSize() {
  if (!win || sizeNormalized) return;
  sizeNormalized = true; // 只校准一次，避免反复缩放
  const wanted = Math.round(BASE_SIZE * (SCALES[state.scale] || 1));
  try {
    const inner = await win.webContents.executeJavaScript("window.innerWidth");
    if (!inner) return;
    const factor = wanted / inner;
    // 正常启动时 factor ≈ 1，不需要动；只有 DPI 被重复缩放（偏差 > 10%）才校正
    if (factor > 0.9 && factor < 1.1) return;
    sizeFactor = Number((sizeFactor * factor).toFixed(4));
    const size = targetSize();
    const [x, y] = win.getPosition();
    // 保持右下角不动，视觉上更自然
    applyBounds(x + (Math.round(inner) - size), y + (Math.round(inner) - size), size);
  } catch {
    /* 拿不到尺寸就保持原样 */
  }
}

function createWindow() {
  const size = targetSize();
  const pos = restorePosition(size);

  win = new BrowserWindow({
    width: size,
    height: size,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: state.alwaysOnTop,
    show: false,
    title: APP_TITLE,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(state.alwaysOnTop, "screen-saver");
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  win.once("ready-to-show", async () => {
    await normalizeSize();
    if (!win || win.isDestroyed()) return;
    win.showInactive();
    if (state.clickThrough) win.setIgnoreMouseEvents(true, { forward: true });
  });

  win.on("moved", () => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    state.x = x;
    state.y = y;
  });

  win.on("closed", () => {
    win = null;
  });
}

function applyScale(name) {
  if (!SCALES[name] || !win) return;
  state.scale = name;
  const size = targetSize();
  const [x, y] = win.getPosition();
  const p = clampToDisplay(x, y, size);
  applyBounds(p.x, p.y, size);
  state.x = p.x;
  state.y = p.y;
  saveState();
  win.webContents.send("pet:state", state.stateName);
}

function setAlwaysOnTop(on) {
  state.alwaysOnTop = on;
  if (win) win.setAlwaysOnTop(on, "screen-saver");
  saveState();
  rebuildTrayMenu();
}

function setClickThrough(on) {
  state.clickThrough = on;
  if (win) win.setIgnoreMouseEvents(on, { forward: true });
  saveState();
  rebuildTrayMenu();
}

function resetPosition() {
  if (!win) return;
  const size = targetSize();
  const p = cornerPosition(size);
  applyBounds(p.x, p.y, size);
  state.x = p.x;
  state.y = p.y;
  saveState();
}

function setStateName(name) {
  state.stateName = name;
  if (win) win.webContents.send("pet:state", name);
  saveState();
}

function quit() {
  saveState();
  releasePidFile();
  app.quit();
}

// ---------------------------------------------------------------- 菜单与托盘
function buildMenuTemplate() {
  const states = listStates(resolveAssetsRoot());
  const stateItems =
    states.length > 0
      ? states.slice(0, 40).map((name) => ({
          label: name,
          type: "radio",
          checked: state.stateName === name,
          click: () => setStateName(name)
        }))
      : [{ label: "（未找到素材）", enabled: false }];

  return [
    {
      label: "换形象",
      submenu: [
        { label: "自动（随机切状态）", click: () => setStateName("auto") },
        { type: "separator" },
        ...stateItems
      ]
    },
    {
      label: "大小",
      submenu: [
        { label: "小", type: "radio", checked: state.scale === "small", click: () => applyScale("small") },
        { label: "中", type: "radio", checked: state.scale === "medium", click: () => applyScale("medium") },
        { label: "大", type: "radio", checked: state.scale === "large", click: () => applyScale("large") }
      ]
    },
    {
      label: "总是置顶",
      type: "checkbox",
      checked: state.alwaysOnTop,
      click: (item) => setAlwaysOnTop(item.checked)
    },
    {
      label: "鼠标穿透（她不吃点击）",
      type: "checkbox",
      checked: state.clickThrough,
      click: (item) => setClickThrough(item.checked)
    },
    { type: "separator" },
    { label: "回到右下角", click: () => resetPosition() },
    { label: "打开素材目录", click: () => shell.openPath(resolveAssetsRoot()) },
    { type: "separator" },
    { label: "退出", click: () => quit() }
  ];
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
  tray.setToolTip(`${APP_TITLE}${state.clickThrough ? "（鼠标穿透中：点托盘图标恢复）" : ""}`);
}

function createTray() {
  const iconPath = path.join(__dirname, "assets", "icon.png");
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return; // 没图标就不建托盘，右键菜单仍可用
  image = image.resize({ width: 16, height: 16 });
  tray = new Tray(image);
  rebuildTrayMenu();
  tray.on("click", () => {
    if (state.clickThrough) setClickThrough(false);
  });
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle("pet:init", () => {
    const root = resolveAssetsRoot();
    return {
      assetBase: pathToFileURL(root).href + "/",
      states: listStates(root),
      defaultStates: DEFAULT_STATES,
      reactions: REACTIONS,
      lines: LINES,
      scale: state.scale,
      clickThrough: state.clickThrough,
      alwaysOnTop: state.alwaysOnTop,
      stateName: state.stateName
    };
  });

  // 拖拽：主进程跟着系统光标移动窗口，指针移出窗口也不会断
  ipcMain.on("pet:drag-start", () => {
    if (!win) return;
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    dragOffset = { x: cursor.x - wx, y: cursor.y - wy };
    if (dragTimer) clearInterval(dragTimer);
    dragTimer = setInterval(() => {
      if (!win || !dragOffset) return;
      const c = screen.getCursorScreenPoint();
      win.setPosition(c.x - dragOffset.x, c.y - dragOffset.y);
    }, 16);
  });

  ipcMain.on("pet:drag-end", () => {
    if (dragTimer) clearInterval(dragTimer);
    dragTimer = null;
    dragOffset = null;
    if (win) {
      const [x, y] = win.getPosition();
      state.x = x;
      state.y = y;
    }
    saveState();
  });

  ipcMain.on("pet:menu", () => {
    if (!win) return;
    Menu.buildFromTemplate(buildMenuTemplate()).popup({ window: win });
  });

  ipcMain.on("pet:poke", () => {
    // 预留：点击事件目前由渲染端处理（气泡 + 随机反应）
  });
}

// ---------------------------------------------------------------- 生命周期
if (otherInstanceRunning()) {
  app.quit();
} else {
  claimPidFile();

  app.whenReady().then(() => {
    loadState();
    registerIpc();
    createWindow();
    createTray();
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", () => {
    if (dragTimer) clearInterval(dragTimer);
    saveState();
    releasePidFile();
  });
}
