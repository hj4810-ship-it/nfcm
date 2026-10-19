import { BufferAttribute, BufferGeometry, MeshBasicMaterial } from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { makeSdfSampler } from './imageMask.js';

/**
 * Recover a shape from three orthographic silhouettes with a voxel visual hull.
 *
 * Coordinates used throughout:
 *   X = right, Y = depth (front is +Y), Z = up
 * Each silhouette bounding box is mapped onto the corresponding physical face.
 * Three bounding-box aspect ratios give an over-determined system for X:Y:Z;
 * we solve it in log space, which is exactly a least-squares fit of the ratios.
 */

function clampedLog(value, min = 0.06, max = 16) {
  const logValue = Math.log(value);
  return Math.max(Math.log(min), Math.min(Math.log(max), logValue));
}

export function estimateExtents(views) {
  const { front, top, side } = views;
  for (const [name, view] of Object.entries({ front, top, side })) {
    if (!view?.bbox) throw new Error(`缺少${name}视图`);
  }

  const f = clampedLog(front.bbox.width / front.bbox.height); // X / Z
  const t = clampedLog(top.bbox.width / top.bbox.height); // X / Y
  const s = clampedLog(side.bbox.width / side.bbox.height); // Y / Z

  // Minimise (x-z-f)^2 + (x-y-t)^2 + (y-z-s)^2 with z = 0.
  const lx = (2 * f + s + t) / 3;
  const ly = (f + 2 * s - t) / 3;

  let x = Math.exp(lx);
  let y = Math.exp(ly);
  let z = 1;
  const longest = Math.max(x, y, z);
  x /= longest;
  y /= longest;
  z /= longest;

  // Never collapse an axis completely: a silhouette can legitimately be thin.
  const floor = 0.035;
  x = Math.max(floor, x);
  y = Math.max(floor, y);
  z = Math.max(floor, z);

  return { x, y, z, ratios: { f, t, s } };
}

function makeSamplers(views, extents, settings) {
  const maxExtent = Math.max(extents.x, extents.y, extents.z);
  const f = views.front;
  const t = views.top;
  const s = views.side;

  const frontScale =
    Math.sqrt(
      (extents.x / Math.max(1, f.sdfBBoxW - 1)) *
        (extents.z / Math.max(1, f.sdfBBoxH - 1)),
    ) / maxExtent;
  const topScale =
    Math.sqrt(
      (extents.x / Math.max(1, t.sdfBBoxW - 1)) *
        (extents.y / Math.max(1, t.sdfBBoxH - 1)),
    ) / maxExtent;
  const sideScale =
    Math.sqrt(
      (extents.y / Math.max(1, s.sdfBBoxW - 1)) *
        (extents.z / Math.max(1, s.sdfBBoxH - 1)),
    ) / maxExtent;

  return {
    front: makeSdfSampler(f, false, false, frontScale),
    top: makeSdfSampler(t, false, !!settings.topFlipY, topScale),
    side: makeSdfSampler(s, !!settings.sideFlipX, false, sideScale),
  };
}

export function buildField(views, extents, settings, resolution) {
  const size = resolution;
  const size2 = size * size;
  const field = new Float32Array(size * size * size);
  const samplers = makeSamplers(views, extents, settings);
  const inner = 0.90;
  const step = 2 / (size - 1);
  const toNorm = (c) => (c / inner + 1) * 0.5;

  let maxField = -Infinity;
  let inside = 0;

  for (let iz = 0; iz < size; iz++) {
    // three.js z -> math Y (depth)
    const yNorm = toNorm(-1 + iz * step);
    const zBase = iz * size2;
    for (let iy = 0; iy < size; iy++) {
      // three.js y -> math Z (up)
      const zNorm = toNorm(-1 + iy * step);
      const row = zBase + iy * size;
      for (let ix = 0; ix < size; ix++) {
        const xNorm = toNorm(-1 + ix * step);
        const a = samplers.front(xNorm, 1 - zNorm);
        const b = samplers.top(xNorm, yNorm);
        const c = samplers.side(yNorm, 1 - zNorm);
        // A tiny tolerance absorbs the half-pixel quantisation of the three
        // independently cropped silhouettes.
        const value = Math.min(a, b, c) + 0.0018;
        field[row + ix] = value;
        if (value > maxField) maxField = value;
        if (value > 0) inside++;
      }
    }
  }

  return { field, size, maxField, inside };
}

function polygonize(field, size) {
  let maxPoly = Math.max(50000, Math.ceil(size * size * 9));
  let lastCount = 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    const material = new MeshBasicMaterial();
    const mc = new MarchingCubes(size, material, false, false, maxPoly);
    mc.isolation = 0;
    mc.field.set(field);
    mc.update();

    lastCount = mc.count / 3;
    const overflowed = mc.count >= maxPoly * 3 * 0.985 || lastCount >= maxPoly * 0.985;
    if (overflowed && attempt < 2) {
      mc.geometry.dispose();
      material.dispose();
      maxPoly *= 2;
      continue;
    }

    const position = mc.positionArray.slice(0, mc.count * 3);
    const normal = mc.normalArray.slice(0, mc.count * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('normal', new BufferAttribute(normal, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.triangleCount = lastCount;

    mc.geometry.dispose();
    material.dispose();
    return { geometry, triangleCount: lastCount };
  }

  throw new Error(`网格生成失败（${lastCount} 个三角形）`);
}

/**
 * @param {Record<string, any>} views extracted front / top / side views
 * @param {{resolution?:number, topFlipY?:boolean, sideFlipX?:boolean}} settings
 */
export function reconstruct(views, settings = {}) {
  if (!views.front || !views.top || !views.side) throw new Error('请先导入三张视图');
  const resolution = Math.max(48, Math.min(192, Math.round(settings.resolution ?? 112)));
  const started = performance.now();
  const extents = estimateExtents(views);
  const { field, maxField, inside } = buildField(views, extents, settings, resolution);

  if (maxField <= 0 || inside < 24) {
    const error = new Error(
      '三张轮廓在空间中几乎没有交集。请检查视图是否对应，或尝试翻转俯视图 / 左视图。',
    );
    error.code = 'EMPTY_HULL';
    throw error;
  }

  const { geometry, triangleCount } = polygonize(field, resolution);
  const toleranceExpanded = maxField < 0.012;
  return {
    geometry,
    extents,
    resolution,
    triangleCount,
    insideVoxels: inside,
    toleranceExpanded,
    duration: performance.now() - started,
  };
}
