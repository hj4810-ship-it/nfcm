import frontDemoUrl from '../assets/demo-front.png';
import topDemoUrl from '../assets/demo-top.png';
import sideDemoUrl from '../assets/demo-side.png';
import { extractView, VIEW_META } from './imageMask.js';
import { reconstruct } from './reconstruct.js';
import { Viewer } from './scene.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEMO_SOURCES = {
  front: frontDemoUrl,
  top: topDemoUrl,
  side: sideDemoUrl,
};

const state = {
  views: { front: null, top: null, side: null },
  settings: {
    threshold: 30,
    mode: 'auto',
    resolution: 112,
    topFlipY: false,
    sideFlipX: false,
  },
  building: false,
  pendingBuild: false,
  buildTimer: null,
  reprocessTimer: null,
  buildToken: 0,
  builtOnce: false,
  lastResult: null,
};

const els = {
  slots: $('#slots'),
  buildBtn: $('#buildBtn'),
  buildHint: $('#buildHint'),
  clearBtn: $('#clearBtn'),
  demoBtn: $('#demoBtn'),
  emptyDemoBtn: $('#emptyDemoBtn'),
  emptyState: $('#emptyState'),
  loading: $('#loading'),
  loadingTitle: $('#loadingTitle'),
  loadingText: $('#loadingText'),
  statusBlock: $('#statusBlock'),
  statRatio: $('#statRatio'),
  statTris: $('#statTris'),
  statRes: $('#statRes'),
  statTime: $('#statTime'),
  statusNote: $('#statusNote'),
  toasts: $('#toasts'),
  refs: $('#refs'),
  rotateBtn: $('#rotateBtn'),
  wireBtn: $('#wireBtn'),
  downloadBtn: $('#downloadBtn'),
  mode: $('#mode'),
  threshold: $('#threshold'),
  thresholdOut: $('#thresholdOut'),
  resolution: $('#resolution'),
  topFlip: $('#topFlip'),
  sideFlip: $('#sideFlip'),
  viewport: $('#viewport'),
};

const slotMap = {};
$$('.slot').forEach((slot) => {
  slotMap[slot.dataset.view] = slot;
});

let viewer = null;
try {
  viewer = new Viewer($('#scene'), els.viewport);
} catch (error) {
  console.error(error);
  toast('当前浏览器无法初始化 WebGL，请使用最新版 Chrome / Edge。', 'error', 9000);
}

if (viewer) {
  viewer.onUserInteract = () => syncToolButtons();
  viewer.setWireframe(false);
}

/* --------------------------------------------------------------- toasts */

function toast(message, type = 'info', duration = 4000) {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  els.toasts.appendChild(item);
  window.setTimeout(() => {
    item.classList.add('out');
    window.setTimeout(() => item.remove(), 240);
  }, duration);
  while (els.toasts.children.length > 3) els.toasts.firstElementChild.remove();
}

/* ------------------------------------------------------------ image slots */

function updateSlotMode(key) {
  const view = state.views[key];
  const slot = slotMap[key];
  const badge = slot.querySelector('.slot-mode');
  if (!view?.extracted) {
    badge.classList.remove('show');
    badge.textContent = '';
    return;
  }
  const ex = view.extracted;
  badge.textContent = ex.mode === 'line' ? '线稿填充' : '实拍轮廓';
  badge.title = ex.warning || (ex.mode === 'line' ? '已将封闭线稿填充为轮廓' : '按颜色提取实心轮廓');
  badge.classList.add('show');
}

function showSlotPreview(key, src) {
  const slot = slotMap[key];
  slot.querySelector('.slot-empty').hidden = true;
  const filled = slot.querySelector('.slot-filled');
  filled.hidden = false;
  const image = filled.querySelector('img');
  image.src = src;
  image.alt = `${VIEW_META[key].label}预览`;
}

function resetSlot(key) {
  const slot = slotMap[key];
  slot.querySelector('.slot-empty').hidden = false;
  const filled = slot.querySelector('.slot-filled');
  filled.hidden = true;
  filled.querySelector('img').removeAttribute('src');
  const badge = slot.querySelector('.slot-mode');
  badge.classList.remove('show');
  badge.textContent = '';
  slot.classList.remove('dragover');
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读取失败，请换一张图片'));
    image.src = src;
  });
}

function processView(key, { notify = false } = {}) {
  const view = state.views[key];
  if (!view) return false;
  try {
    const extracted = extractView(view.image, {
      threshold: state.settings.threshold,
      mode: state.settings.mode,
    });
    view.extracted = extracted;
    view.warning = extracted.warning || null;
    updateSlotMode(key);
    if (notify && extracted.warning) toast(extracted.warning, 'warn', 6500);
    return true;
  } catch (error) {
    view.extracted = null;
    view.warning = error.message;
    updateSlotMode(key);
    if (notify) toast(`${VIEW_META[key].label}：${error.message}`, 'error', 6500);
    return false;
  }
}

function processAll(options = {}) {
  return Object.keys(state.views).map((key) => processView(key, options));
}

async function acceptImage(key, image, src, { objectUrl = false, fileName = '', notify = true } = {}) {
  const current = state.views[key];
  if (current?.objectUrl && current.src) URL.revokeObjectURL(current.src);

  state.views[key] = {
    key,
    image,
    src,
    objectUrl,
    fileName,
    extracted: null,
    warning: null,
  };
  showSlotPreview(key, src);
  updateBuildState();

  // Let the UI show the preview before the synchronous mask pass.
  await sleep(20);
  const ok = processView(key, { notify });
  updateBuildState();
  if (ok) scheduleBuild(140);
  return ok;
}

async function handleFile(key, file) {
  if (!file) return;
  if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) {
    toast('请选择 PNG、JPG、WebP 等图片文件。', 'error');
    return;
  }
  if (file.size > 40 * 1024 * 1024) {
    toast('图片超过 40 MB，请先压缩后再导入。', 'error');
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    if (image.naturalWidth < 20 || image.naturalHeight < 20) throw new Error('图片尺寸太小');
    await acceptImage(key, image, objectUrl, {
      objectUrl: true,
      fileName: file.name,
      notify: true,
    });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    toast(error.message, 'error');
  }
}

function removeView(key) {
  const view = state.views[key];
  if (!view) return;
  if (view.objectUrl && view.src) URL.revokeObjectURL(view.src);
  state.views[key] = null;
  resetSlot(key);
  state.buildToken++;
  state.pendingBuild = false;
  state.lastResult = null;
  if (viewer) viewer.clearModel();
  els.emptyState.classList.remove('hidden');
  els.statusBlock.hidden = true;
  els.refs.hidden = true;
  syncToolButtons();
  updateBuildState();
}

/* ------------------------------------------------------------- drag & drop */

$$('.slot').forEach((slot) => {
  const key = slot.dataset.view;
  const input = slot.querySelector('input[type="file"]');

  input.addEventListener('change', () => {
    const [file] = input.files || [];
    if (file) handleFile(key, file);
    input.value = '';
  });

  slot.addEventListener('dragenter', (event) => {
    event.preventDefault();
    slot.classList.add('dragover');
  });
  slot.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  slot.addEventListener('dragleave', (event) => {
    if (!slot.contains(event.relatedTarget)) slot.classList.remove('dragover');
  });
  slot.addEventListener('drop', (event) => {
    event.preventDefault();
    slot.classList.remove('dragover');
    const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) handleFile(key, file);
  });

  slot.querySelector('.slot-remove').addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeView(key);
  });
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

/* ---------------------------------------------------------------- build */

function readyCount() {
  return Object.values(state.views).filter((view) => view?.extracted).length;
}

function updateBuildState() {
  const ready = readyCount();
  const count = Object.values(state.views).filter(Boolean).length;
  const building = state.building;
  els.buildBtn.disabled = ready < 3 || building || !viewer;
  els.buildHint.textContent = building
    ? '正在计算轮廓交集…'
    : ready < 3
      ? `还差 ${3 - ready} 张视图`
      : '三视图就绪，开始重建';
  els.clearBtn.disabled = count === 0;
  els.demoBtn.disabled = building;
  els.emptyDemoBtn.disabled = building;
  if (els.downloadBtn) els.downloadBtn.disabled = !state.lastResult;
}

function scheduleBuild(delay = 120) {
  if (state.buildTimer) window.clearTimeout(state.buildTimer);
  if (state.building) {
    state.pendingBuild = true;
    return;
  }
  state.buildTimer = window.setTimeout(() => {
    state.buildTimer = null;
    buildModel(false);
  }, delay);
}

function showLoading() {
  els.loading.hidden = false;
  els.loadingTitle.textContent = '正在雕刻三维形体';
  els.loadingText.textContent = `轮廓求交 · ${state.settings.resolution}³ 等值面提取`;
}

function hideLoading() {
  els.loading.hidden = true;
}

function updateStats(result) {
  const { extents, triangleCount, resolution, duration } = result;
  els.statusBlock.hidden = false;
  els.statRatio.textContent = `${extents.x.toFixed(2)} : ${extents.y.toFixed(2)} : ${extents.z.toFixed(2)}`;
  els.statTris.textContent = triangleCount.toLocaleString('zh-CN');
  els.statRes.textContent = `${resolution}³`;
  els.statTime.textContent = `${(duration / 1000).toFixed(2)} s`;
  const notes = [];
  if (result.toleranceExpanded) notes.push('三张轮廓略有偏差，已自动做轻微放宽。');
  notes.push('基于三向轮廓求交的视觉壳体，内部凹槽可能与真实物体不同。');
  els.statusNote.textContent = notes.join(' ');
}

function updateRefs() {
  els.refs.innerHTML = '';
  for (const key of ['front', 'top', 'side']) {
    const view = state.views[key];
    if (!view) continue;
    const figure = document.createElement('figure');
    const image = document.createElement('img');
    image.src = view.src;
    image.alt = `${VIEW_META[key].label}参考图`;
    const caption = document.createElement('figcaption');
    caption.textContent = VIEW_META[key].label.slice(0, 2);
    figure.append(image, caption);
    els.refs.appendChild(figure);
  }
  els.refs.hidden = false;
}

function syncToolButtons() {
  const hasModel = !!state.lastResult;
  els.rotateBtn.disabled = !hasModel;
  els.wireBtn.disabled = !hasModel;
  els.downloadBtn.disabled = !hasModel;
  els.rotateBtn.classList.toggle('active', !!viewer?.autoRotate);
  els.wireBtn.classList.toggle('active', !!viewer?.wireframe);
}

async function buildModel(manual = false) {
  if (!viewer || state.building) {
    state.pendingBuild = state.building;
    return;
  }
  if (readyCount() < 3) {
    if (manual) toast('请先导入完整的三张视图。', 'warn');
    return;
  }

  state.building = true;
  state.pendingBuild = false;
  const token = ++state.buildToken;
  updateBuildState();
  showLoading();
  await sleep(35);

  try {
    // Make sure threshold / mode changes are reflected even for a manual build.
    processAll();

    if (readyCount() < 3) throw new Error('有视图未能识别出轮廓，请检查图片对比度或调低阈值。');

    const silhouettes = {
      front: state.views.front.extracted,
      top: state.views.top.extracted,
      side: state.views.side.extracted,
    };
    const result = reconstruct(silhouettes, state.settings);
    if (token !== state.buildToken) return;

    state.lastResult = result;
    viewer.setModel(result);
    els.emptyState.classList.add('hidden');
    els.statusBlock.hidden = false;
    updateStats(result);
    updateRefs();
    updateBuildState();
    syncToolButtons();

    if (!state.builtOnce) {
      state.builtOnce = true;
      viewer.setAutoRotate(true);
      syncToolButtons();
    }

    if (manual) {
      toast(`已生成模型：${result.triangleCount.toLocaleString('zh-CN')} 个三角面`, 'info', 2600);
    }
  } catch (error) {
    console.error(error);
    toast(error.message || '重建失败，请检查三视图。', 'error', 7000);
  } finally {
    if (token === state.buildToken) {
      state.building = false;
      hideLoading();
      updateBuildState();
      syncToolButtons();
      if (state.pendingBuild) {
        state.pendingBuild = false;
        scheduleBuild(80);
      }
    } else {
      // The views were cleared/replaced while this build was running.
      state.building = false;
      hideLoading();
      updateBuildState();
      syncToolButtons();
    }
  }
}

/* ------------------------------------------------------------------ demo */

async function loadDemo() {
  if (state.building) return;
  clearAll({ silent: true });
  els.demoBtn.disabled = true;
  els.emptyDemoBtn.disabled = true;
  try {
    const keys = ['front', 'top', 'side'];
    const images = await Promise.all(keys.map((key) => loadImageElement(DEMO_SOURCES[key])));
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      await acceptImage(key, images[i], DEMO_SOURCES[key], {
        objectUrl: false,
        fileName: `示例-${VIEW_META[key].label}.png`,
        notify: false,
      });
    }
    toast('已载入示例：带斜撑与斜切顶面的 L 形支架，可直接拖动查看。', 'info', 4200);
    scheduleBuild(20);
  } catch (error) {
    console.error(error);
    toast('示例载入失败：' + error.message, 'error');
  } finally {
    els.demoBtn.disabled = false;
    els.emptyDemoBtn.disabled = false;
  }
}

function clearAll({ silent = false } = {}) {
  for (const key of Object.keys(state.views)) {
    const view = state.views[key];
    if (view?.objectUrl && view.src) URL.revokeObjectURL(view.src);
    state.views[key] = null;
    resetSlot(key);
  }
  state.buildToken++;
  state.pendingBuild = false;
  state.lastResult = null;
  if (state.buildTimer) {
    window.clearTimeout(state.buildTimer);
    state.buildTimer = null;
  }
  if (viewer) viewer.clearModel();
  els.emptyState.classList.remove('hidden');
  els.statusBlock.hidden = true;
  els.refs.hidden = true;
  els.refs.innerHTML = '';
  hideLoading();
  updateBuildState();
  syncToolButtons();
  if (!silent) toast('已清空所有视图。', 'info', 2000);
}

/* -------------------------------------------------------------- settings */

function reprocessAndBuild() {
  if (state.reprocessTimer) window.clearTimeout(state.reprocessTimer);
  state.reprocessTimer = window.setTimeout(() => {
    state.reprocessTimer = null;
    processAll();
    updateBuildState();
    if (readyCount() === 3) scheduleBuild(80);
  }, 180);
}

els.threshold.addEventListener('input', () => {
  els.thresholdOut.value = els.threshold.value;
});
els.threshold.addEventListener('change', () => {
  state.settings.threshold = Number(els.threshold.value);
  reprocessAndBuild();
});
els.mode.addEventListener('change', () => {
  state.settings.mode = els.mode.value;
  reprocessAndBuild();
});
els.resolution.addEventListener('change', () => {
  state.settings.resolution = Number(els.resolution.value);
  if (readyCount() === 3) scheduleBuild(60);
});
els.topFlip.addEventListener('change', () => {
  state.settings.topFlipY = els.topFlip.checked;
  if (readyCount() === 3) scheduleBuild(60);
});
els.sideFlip.addEventListener('change', () => {
  state.settings.sideFlipX = els.sideFlip.checked;
  if (readyCount() === 3) scheduleBuild(60);
});

/* --------------------------------------------------------------- toolbar */

els.buildBtn.addEventListener('click', () => buildModel(true));
els.clearBtn.addEventListener('click', () => clearAll());
els.demoBtn.addEventListener('click', loadDemo);
els.emptyDemoBtn.addEventListener('click', loadDemo);

$$('.view-tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    $$('.view-tabs button').forEach((b) => b.classList.remove('active'));
    button.classList.add('active');
    if (viewer) {
      viewer.setAutoRotate(false);
      viewer.setView(button.dataset.camera);
      syncToolButtons();
    }
  });
});

els.rotateBtn.addEventListener('click', () => {
  if (!viewer || !state.lastResult) return;
  viewer.setAutoRotate(!viewer.autoRotate);
  syncToolButtons();
});

els.wireBtn.addEventListener('click', () => {
  if (!viewer || !state.lastResult) return;
  viewer.setWireframe(!viewer.wireframe);
  syncToolButtons();
});

$('#scene').addEventListener('dblclick', () => {
  if (!viewer || !state.lastResult) return;
  viewer.resetView();
  $$('.view-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.camera === 'iso'));
});

/* ------------------------------------------------------------ STL export */

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportSTL() {
  if (!viewer || !viewer.geometry) return;
  const geometry = viewer.geometry;
  const positions = geometry.getAttribute('position');
  if (!positions) return;
  const matrix = viewer.getExportMatrix();
  if (!matrix) return;

  const triangleCount = Math.floor(positions.count / 3);
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode('Three-view visual hull');
  new Uint8Array(buffer, 0, Math.min(80, header.length)).set(header.subarray(0, 80));
  view.setUint32(80, triangleCount, true);

  const p = [0, 0, 0];
  const q = [0, 0, 0];
  const r = [0, 0, 0];
  let offset = 84;

  const transform = (index, out) => {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    out[0] = matrix.elements[0] * x + matrix.elements[4] * y + matrix.elements[8] * z + matrix.elements[12];
    out[1] = matrix.elements[1] * x + matrix.elements[5] * y + matrix.elements[9] * z + matrix.elements[13];
    out[2] = matrix.elements[2] * x + matrix.elements[6] * y + matrix.elements[10] * z + matrix.elements[14];
  };

  for (let i = 0; i < triangleCount; i++) {
    transform(i * 3, p);
    transform(i * 3 + 1, q);
    transform(i * 3 + 2, r);
    const ux = q[0] - p[0];
    const uy = q[1] - p[1];
    const uz = q[2] - p[2];
    const vx = r[0] - p[0];
    const vy = r[1] - p[1];
    const vz = r[2] - p[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;

    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);
    let pOffset = offset + 12;
    for (const point of [p, q, r]) {
      view.setFloat32(pOffset, point[0], true);
      view.setFloat32(pOffset + 4, point[1], true);
      view.setFloat32(pOffset + 8, point[2], true);
      pOffset += 12;
    }
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  downloadBlob(new Blob([buffer], { type: 'model/stl' }), 'three-view-model.stl');
  toast(`已导出 STL（${triangleCount.toLocaleString('zh-CN')} 个三角面）`, 'info', 2800);
}

els.downloadBtn.addEventListener('click', exportSTL);

/* ------------------------------------------------------------------- init */

function init() {
  updateBuildState();
  syncToolButtons();
  els.thresholdOut.value = els.threshold.value;
  if (!viewer) {
    els.buildBtn.disabled = true;
    els.buildHint.textContent = 'WebGL 不可用';
  }
}

init();

// A small inspection hook used by the automated visual tests.
window.__THREE_VIEW__ = {
  state,
  get viewer() {
    return viewer;
  },
  loadDemo,
  build: () => buildModel(true),
  clear: clearAll,
  exportSTL,
};
