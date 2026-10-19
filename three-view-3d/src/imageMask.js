/**
 * Convert a photographed / rendered / line-art three-view image into a clean
 * binary silhouette plus a signed distance field.
 *
 * The important part for line drawings is that the white *inside* of a closed
 * outline must become solid. We do that by closing small gaps in the ink,
 * flood-filling the outside of the drawing, then taking the complement.
 */

const MAX_PROCESS_SIDE = 720;
const SQRT2 = Math.SQRT2;

export const VIEW_META = {
  front: { label: '主视图', hint: '从正面看', axis: 'X-Z' },
  top: { label: '俯视图', hint: '从上方看', axis: 'X-Y' },
  side: { label: '左视图', hint: '从左侧看', axis: 'Y-Z' },
};

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Most common quantised border colour. Works for white paper / flat renders. */
function estimateBackground(data, width, height) {
  const buckets = new Map();
  const step = Math.max(1, Math.floor((width + height) / 500));
  const add = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 24) return;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    let entry = buckets.get(key);
    if (!entry) {
      entry = { n: 0, r: 0, g: 0, b: 0 };
      buckets.set(key, entry);
    }
    entry.n++;
    entry.r += data[i];
    entry.g += data[i + 1];
    entry.b += data[i + 2];
  };

  for (let x = 0; x < width; x += step) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    add(0, y);
    add(width - 1, y);
  }

  let best = null;
  for (const entry of buckets.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  if (!best) return { r: 255, g: 255, b: 255 };
  return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n };
}

function buildInk(data, width, height, background, threshold, useAlpha) {
  const ink = new Uint8Array(width * height);
  let count = 0;
  for (let i = 0, p = 0; p < ink.length; p++, i += 4) {
    let isInk;
    if (useAlpha) {
      isInk = data[i + 3] > 42;
    } else {
      const dr = data[i] - background.r;
      const dg = data[i + 1] - background.g;
      const db = data[i + 2] - background.b;
      // Perceptual-ish colour distance. Any strongly coloured object also counts.
      const dist = Math.sqrt(0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
      isInk = dist > threshold;
    }
    if (isInk) {
      ink[p] = 1;
      count++;
    }
  }
  return { ink, count };
}

/** 3x3 binary dilation; radius is in pixels. */
function dilate(mask, width, height, radius = 1) {
  let src = mask;
  for (let pass = 0; pass < radius; pass++) {
    const dst = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        if (
          src[i] ||
          (x > 0 && src[i - 1]) ||
          (x < width - 1 && src[i + 1]) ||
          (y > 0 && src[i - width]) ||
          (y < height - 1 && src[i + width]) ||
          (x > 0 && y > 0 && src[i - width - 1]) ||
          (x < width - 1 && y > 0 && src[i - width + 1]) ||
          (x > 0 && y < height - 1 && src[i + width - 1]) ||
          (x < width - 1 && y < height - 1 && src[i + width + 1])
        ) {
          dst[i] = 1;
        }
      }
    }
    src = dst;
  }
  return src;
}

/** Flood fill non-ink pixels connected to the image border. */
function exteriorFill(ink, width, height) {
  const outside = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const seed = (i) => {
    if (!ink[i] && !outside[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };

  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (i >= width) seed(i - width);
    if (i < width * (height - 1)) seed(i + width);
  }
  return outside;
}

function areaOf(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

/**
 * Turn a sparse line drawing into a filled silhouette.
 * We try increasing gap-closing radii; the first result that encloses a
 * meaningful area wins. If the outline is open we fall back to the ink itself.
 */
function fillLineArt(ink, width, height, total) {
  let best = null;
  for (const radius of [1, 2, 3, 4]) {
    const grown = dilate(ink, width, height, radius);
    const outside = exteriorFill(grown, width, height);
    const filled = new Uint8Array(width * height);
    let area = 0;
    for (let i = 0; i < filled.length; i++) {
      if (!outside[i]) {
        filled[i] = 1;
        area++;
      }
    }
    const gain = area / Math.max(1, areaOf(grown));
    if (!best || area > best.area) best = { mask: filled, area, gain, radius };
    // A normal drawing gains a lot of interior area once the outline closes.
    if (gain > 1.35 && area > total * 0.006) break;
  }
  return best;
}

/** Remove tiny isolated blobs, but keep genuinely separate parts of an object. */
function removeSpecks(mask, width, height, minArea) {
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) {
        seen[i - 1] = 1;
        queue[tail++] = i - 1;
      }
      if (x < width - 1 && mask[i + 1] && !seen[i + 1]) {
        seen[i + 1] = 1;
        queue[tail++] = i + 1;
      }
      if (i >= width && mask[i - width] && !seen[i - width]) {
        seen[i - width] = 1;
        queue[tail++] = i - width;
      }
      if (i < width * (height - 1) && mask[i + width] && !seen[i + width]) {
        seen[i + width] = 1;
        queue[tail++] = i + width;
      }
    }
    if (tail < minArea) {
      for (let k = 0; k < tail; k++) mask[queue[k]] = 0;
    }
  }
}

function boundingBox(mask, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return null;
  return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** One pass of an approximate Euclidean distance transform (chamfer 3-4). */
function chamferPasses(distance, width, height) {
  const d = distance;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      let v = d[i];
      if (!v) continue;
      if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
      if (y > 0) {
        if (d[i - width] + 1 < v) v = d[i - width] + 1;
        if (x > 0 && d[i - width - 1] + SQRT2 < v) v = d[i - width - 1] + SQRT2;
        if (x < width - 1 && d[i - width + 1] + SQRT2 < v) v = d[i - width + 1] + SQRT2;
      }
      d[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x--) {
      const i = row + x;
      let v = d[i];
      if (!v) continue;
      if (x < width - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1;
      if (y < height - 1) {
        if (d[i + width] + 1 < v) v = d[i + width] + 1;
        if (x < width - 1 && d[i + width + 1] + SQRT2 < v) v = d[i + width + 1] + SQRT2;
        if (x > 0 && d[i + width - 1] + SQRT2 < v) v = d[i + width - 1] + SQRT2;
      }
      d[i] = v;
    }
  }
  return d;
}

function signedDistance(mask, width, height) {
  const inside = new Float32Array(width * height);
  const outside = new Float32Array(width * height);
  const INF = 1e8;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      inside[i] = INF;
      outside[i] = 0;
    } else {
      inside[i] = 0;
      outside[i] = INF;
    }
  }
  chamferPasses(inside, width, height);
  chamferPasses(outside, width, height);
  const result = new Float32Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    result[i] = mask[i] ? inside[i] : -outside[i];
  }
  return result;
}

/**
 * @param {HTMLImageElement|ImageBitmap} image
 * @param {{threshold?:number, mode?:'auto'|'line'|'solid'}} options
 */
export function extractView(image, options = {}) {
  const threshold = options.threshold ?? 30;
  const modeSetting = options.mode ?? 'auto';
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) throw new Error('图片尺寸无效');

  const scale = Math.min(1, MAX_PROCESS_SIDE / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(2, Math.round(naturalWidth * scale));
  const height = Math.max(2, Math.round(naturalHeight * scale));

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;

  let transparentPixels = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 250) transparentPixels++;
  }
  const useAlpha = transparentPixels > (width * height) * 0.02;

  const background = estimateBackground(pixels, width, height);
  const { ink, count: inkCount } = buildInk(
    pixels,
    width,
    height,
    background,
    threshold,
    useAlpha,
  );
  if (inkCount < 12) throw new Error('没有检测到图形，请换一张对比更清晰的图片');

  const inkFraction = inkCount / (width * height);
  let mode = modeSetting;
  if (mode === 'auto') mode = inkFraction < 0.30 ? 'line' : 'solid';

  let mask = ink;
  let warning = null;
  let fillRatio = 1;
  if (mode === 'line') {
    const filled = fillLineArt(ink, width, height, width * height);
    fillRatio = filled.area / Math.max(1, inkCount);
    if (filled.gain > 1.10 && filled.area > width * height * 0.003) {
      mask = filled.mask;
      warning = null;
    } else {
      // The contour may be open. Keep the detected ink rather than inventing a
      // silhouette, and tell the user why the result may look thin.
      mask = ink;
      warning = '轮廓似乎没有完全闭合，重建结果可能偏薄；可尝试调低识别阈值';
    }
  } else {
    // Solid/rendered image: close single-pixel pinholes only.
    const grown = dilate(ink, width, height, 1);
    mask = grown;
  }

  removeSpecks(mask, width, height, Math.max(14, Math.round(width * height * 0.00008)));

  const bbox = boundingBox(mask, width, height);
  if (!bbox) throw new Error('未能提取出有效轮廓');
  if (bbox.width < 8 || bbox.height < 8) throw new Error('轮廓太小，请导入分辨率更高的图片');

  // Build a padded crop and its signed distance field. Padding gives the 3D
  // sampler well-defined negative values just outside the silhouette.
  const pad = 3;
  const cropW = bbox.width + pad * 2;
  const cropH = bbox.height + pad * 2;
  const cropMask = new Uint8Array(cropW * cropH);
  for (let y = 0; y < bbox.height; y++) {
    const src = (bbox.y0 + y) * width + bbox.x0;
    const dst = (y + pad) * cropW + pad;
    cropMask.set(mask.subarray(src, src + bbox.width), dst);
  }
  const rawSdf = signedDistance(cropMask, cropW, cropH);

  return {
    width,
    height,
    mask,
    bbox,
    inkFraction,
    mode,
    fillRatio,
    warning,
    sdf: rawSdf,
    sdfWidth: cropW,
    sdfHeight: cropH,
    sdfBBoxX: pad,
    sdfBBoxY: pad,
    sdfBBoxW: bbox.width,
    sdfBBoxH: bbox.height,
    preview: canvas.toDataURL('image/png'),
    background,
  };
}

/** Bilinear sampler over a padded signed-distance crop. */
export function makeSdfSampler(view, flipX = false, flipY = false, pixelScale = 1) {
  const {
    sdf,
    sdfWidth: w,
    sdfHeight: h,
    sdfBBoxX: bx,
    sdfBBoxY: by,
    sdfBBoxW: bw,
    sdfBBoxH: bh,
  } = view;
  return (u, v) => {
    if (flipX) u = 1 - u;
    if (flipY) v = 1 - v;
    let x = bx + u * Math.max(1, bw - 1);
    let y = by + v * Math.max(1, bh - 1);
    if (x < 0) x = 0;
    else if (x > w - 1) x = w - 1;
    if (y < 0) y = 0;
    else if (y > h - 1) y = h - 1;
    const x0 = x | 0;
    const y0 = y | 0;
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const a = sdf[y0 * w + x0];
    const b = sdf[y0 * w + x1];
    const c = sdf[y1 * w + x0];
    const d = sdf[y1 * w + x1];
    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return (top + (bottom - top) * fy) * pixelScale;
  };
}
