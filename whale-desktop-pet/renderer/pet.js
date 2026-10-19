// 渲染端：管形象切换、气泡、点击反应与拖拽
const pet = document.getElementById("pet");
const holder = document.getElementById("holder");
const bubble = document.getElementById("bubble");

let cfg = null;
let current = null;
let idleTimer = null;
let bubbleTimer = null;
let forcedState = null; // 菜单里手动指定的形象；null 表示自动
let dragging = false;
let moved = false;
let pressAt = null;
let pressPoint = null;

const FALLBACK_TEXT =
  "没有找到鲸鱼娘的素材，把这个应用放到安装了 dsh-whale-musume 的机器上，" +
  "或用 --assets=<目录> 指向 assets/generated。";

function stateUrl(name) {
  return cfg.assetBase + "dsh-whale-state-" + name + ".webp";
}

function hasState(name) {
  return cfg.states.includes(name);
}

function pick(list) {
  const usable = list.filter(hasState);
  return usable.length ? usable[Math.floor(Math.random() * usable.length)] : null;
}

function showPlaceholder(text) {
  if (document.querySelector(".placeholder")) return;
  const box = document.createElement("div");
  box.className = "placeholder";
  box.textContent = text;
  holder.appendChild(box);
  pet.style.display = "none";
}

/** 主入口：设置当前形象 */
function setState(name, { transient = false } = {}) {
  if (!cfg) return;
  if (name === "auto") {
    forcedState = null;
    scheduleIdle(true);
    return;
  }
  if (!hasState(name)) return;
  if (!transient) forcedState = name;
  if (current === name) return;
  current = name;
  pet.src = stateUrl(name);
}

function hop() {
  pet.classList.remove("hop");
  // 强制回流，让动画能重复触发
  void pet.offsetWidth;
  pet.classList.add("hop");
}

function say(text, ms = 3000) {
  bubble.textContent = text;
  bubble.hidden = false;
  requestAnimationFrame(() => bubble.classList.add("show"));
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubble.classList.remove("show");
    setTimeout(() => (bubble.hidden = true), 220);
  }, ms);
}

/** 待机：每隔一段时间自己换个表情，别像张静止图 */
function scheduleIdle(immediate = false) {
  clearTimeout(idleTimer);
  if (forcedState) return; // 手动指定的形象不会被自动切走
  const delay = immediate ? 600 : 7000 + Math.random() * 7000;
  idleTimer = setTimeout(() => {
    const next = pick(cfg.defaultStates);
    if (next) setState(next, { transient: true });
    scheduleIdle();
  }, delay);
}

/** 被点一下：冒个泡 + 换个反应表情，几秒后回待机 */
function reactToClick() {
  hop();
  const line = cfg.lines[Math.floor(Math.random() * cfg.lines.length)];
  say(line);
  const reaction = pick(cfg.reactions);
  if (reaction) {
    setState(reaction, { transient: true });
    setTimeout(() => {
      if (forcedState) setState(forcedState);
      else scheduleIdle();
    }, 2600);
  }
}

function onPointerDown(event) {
  if (event.button === 2) return; // 右键交给 contextmenu
  if (event.button !== 0) return;
  dragging = false;
  moved = false;
  pressAt = Date.now();
  pressPoint = { x: event.screenX, y: event.screenY };
  holder.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!pressPoint) return;
  const dx = event.screenX - pressPoint.x;
  const dy = event.screenY - pressPoint.y;
  if (!dragging && Math.hypot(dx, dy) > 4) {
    dragging = true;
    moved = true;
    holder.classList.add("dragging");
    window.petHost.dragStart();
  }
}

function onPointerUp(event) {
  if (!pressPoint) return;
  holder.releasePointerCapture?.(event.pointerId);
  const quick = Date.now() - pressAt < 420;
  pressPoint = null;
  pressAt = null;
  if (dragging) {
    dragging = false;
    holder.classList.remove("dragging");
    window.petHost.dragEnd();
    return;
  }
  if (quick) reactToClick();
}

// ---------------------------------------------------------------- 启动
(async function boot() {
  cfg = await window.petHost.init();

  if (!cfg.states || cfg.states.length === 0) {
    showPlaceholder(FALLBACK_TEXT);
    return;
  }

  pet.addEventListener("error", () => {
    showPlaceholder(FALLBACK_TEXT);
  });

  holder.addEventListener("pointerdown", onPointerDown);
  holder.addEventListener("pointermove", onPointerMove);
  holder.addEventListener("pointerup", onPointerUp);
  holder.addEventListener("pointercancel", onPointerUp);
  holder.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.petHost.openMenu();
  });

  // 菜单里选了固定形象 / 点了「自动」
  window.petHost.onStateChange((name) => {
    if (name === "auto") {
      forcedState = null;
      scheduleIdle(true);
      return;
    }
    forcedState = name;
    setState(name);
  });

  const first = hasState(cfg.stateName) ? cfg.stateName : pick(cfg.defaultStates);
  if (first) {
    forcedState = cfg.stateName === "auto" ? null : null;
    setState(first, { transient: true });
  }
  scheduleIdle(true);
})();
