import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const ACCENT = 0x7dd3fc;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class Viewer {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container;
    this.model = null;
    this.modelGroup = null;
    this.extents = null;
    this.fitDistance = 3;
    this.tween = null;
    this.autoRotate = false;
    this.wireframe = false;
    this.onUserInteract = null;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
    this.camera.position.set(2.3, 1.8, 3.0);
    this.camera.lookAt(0, 0.4, 0);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new RoomEnvironment();
    this.environmentTexture = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environment = this.environmentTexture;
    envScene.dispose?.();
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.75;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.7;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.minPolarAngle = 0.015;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.012;
    this.controls.minDistance = 0.55;
    this.controls.maxDistance = 14;
    this.controls.autoRotateSpeed = 0.7;
    this.controls.target.set(0, 0.4, 0);

    this.controls.addEventListener('start', () => {
      this.tween = null;
      if (this.autoRotate) {
        this.setAutoRotate(false);
        this.onUserInteract?.();
      }
    });

    this.setupLights();
    this.setupGround();

    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x6f94bd,
      metalness: 0.35,
      roughness: 0.32,
      clearcoat: 0.65,
      clearcoatRoughness: 0.24,
      envMapIntensity: 1.0,
      side: THREE.FrontSide,
    });
    this.material.userData.baseColor = new THREE.Color(0x6f94bd);

    this.clock = new THREE.Clock();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.renderer.setAnimationLoop(() => this.tick());
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0xb9dcff, 0x070b12, 1.25);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3.4, 6.2, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -2;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    this.scene.add(key);
    this.keyLight = key;

    const fill = new THREE.PointLight(0x5da9ff, 18, 12, 2);
    fill.position.set(-3.3, 1.5, 2.6);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0x9a8cff, 2.4);
    rim.position.set(-3.5, 3.2, -4);
    this.scene.add(rim);

    const warm = new THREE.PointLight(0xffc98a, 6, 8, 2);
    warm.position.set(2.5, 0.8, -2.5);
    this.scene.add(warm);
  }

  setupGround() {
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.42, depthWrite: false }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.002;
    shadowPlane.receiveShadow = true;
    this.scene.add(shadowPlane);

    const grid = new THREE.GridHelper(12, 60, 0x5e88a8, 0x203243);
    grid.position.y = 0.0005;
    grid.material.transparent = true;
    grid.material.opacity = 0.24;
    grid.material.depthWrite = false;
    this.scene.add(grid);
    this.grid = grid;

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setModel(result) {
    const preserveView = !!this.extents;
    let oldDirection = null;
    let zoomRatio = 1;
    if (preserveView) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const distance = offset.length();
      if (distance > 0.001) {
        oldDirection = offset.divideScalar(distance);
        zoomRatio = THREE.MathUtils.clamp(distance / this.fitDistance, 0.72, 1.55);
      }
    }

    this.clearModel(false);
    const { geometry, extents } = result;
    this.extents = extents;
    this.geometry = geometry;

    const inner = 0.90;
    const group = new THREE.Group();
    group.name = 'reconstructed-model';

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.set(
      extents.x / (2 * inner),
      extents.z / (2 * inner),
      extents.y / (2 * inner),
    );
    mesh.position.y = extents.z / 2;
    group.add(mesh);
    this.mesh = mesh;

    const radius = Math.max(extents.x, extents.y) * 0.66 + 0.035;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius, radius + 0.0035, 160),
      this.ringMaterial,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.0015;
    group.add(ring);
    this.ring = ring;

    this.modelGroup = group;
    this.scene.add(group);

    this.keyLight.shadow.camera.left = -Math.max(2.5, extents.x * 2.2);
    this.keyLight.shadow.camera.right = Math.max(2.5, extents.x * 2.2);
    this.keyLight.shadow.camera.top = Math.max(3, extents.z * 2.2);
    this.keyLight.shadow.camera.bottom = -Math.max(2, extents.z);
    this.keyLight.shadow.camera.updateProjectionMatrix();

    this.fitModel({
      animate: true,
      intro: !preserveView,
      direction: oldDirection,
      zoomRatio,
    });
    return mesh;
  }

  clearModel(resetCamera = true) {
    if (this.modelGroup) {
      this.scene.remove(this.modelGroup);
      this.modelGroup.traverse((child) => {
        if (child.isMesh && child.geometry) child.geometry.dispose();
      });
      this.modelGroup = null;
    }
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    this.mesh = null;
    this.ring = null;
    this.extents = null;
    this.model = null;
    if (resetCamera) {
      this.tween = null;
      this.camera.position.set(2.3, 1.8, 3.0);
      this.controls.target.set(0, 0.4, 0);
      this.controls.update();
    }
  }

  fitModel({ animate = true, intro = false, direction = null, zoomRatio = 1 } = {}) {
    if (!this.extents) return;
    const { x, y, z } = this.extents;
    const radius = Math.hypot(x, y, z) / 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    this.fitDistance = Math.max(1.35, (radius / Math.sin(fov / 2)) * 1.18);
    const target = new THREE.Vector3(0, z * 0.46, 0);
    const viewDirection = direction || this.getViewDirection('iso');
    const distance = this.fitDistance * (intro ? 1.32 : zoomRatio);
    const position = target.clone().addScaledVector(viewDirection, distance);

    if (animate) {
      this.animateCamera(position, target, intro ? 900 : 620);
    } else {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.camera.lookAt(target);
      this.controls.update();
    }
  }

  getViewDirection(name) {
    switch (name) {
      case 'front':
        return new THREE.Vector3(0, 0.045, 1).normalize();
      case 'top':
        return new THREE.Vector3(0, 1, 0.004).normalize();
      case 'side':
        return new THREE.Vector3(-1, 0.045, 0).normalize();
      case 'back':
        return new THREE.Vector3(0, 0.045, -1).normalize();
      default:
        return new THREE.Vector3(1.25, 0.88, 1.85).normalize();
    }
  }

  setView(name) {
    if (!this.extents) return;
    const target = new THREE.Vector3(0, this.extents.z * 0.46, 0);
    const position = target
      .clone()
      .addScaledVector(this.getViewDirection(name), this.fitDistance);
    this.animateCamera(position, target, 620);
  }

  animateCamera(position, target, duration = 620) {
    this.tween = {
      start: performance.now(),
      duration,
      fromPosition: this.camera.position.clone(),
      toPosition: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
    };
  }

  setAutoRotate(enabled) {
    this.autoRotate = enabled;
    this.controls.autoRotate = enabled;
  }

  setWireframe(enabled) {
    this.wireframe = enabled;
    this.material.wireframe = enabled;
  }

  tick() {
    const now = performance.now();
    if (this.tween) {
      const t = Math.min(1, (now - this.tween.start) / this.tween.duration);
      const k = easeInOutCubic(t);
      this.camera.position.lerpVectors(this.tween.fromPosition, this.tween.toPosition, k);
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, k);
      if (t >= 1) this.tween = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resetView() {
    this.fitModel({ animate: true });
  }

  getExportMatrix() {
    if (!this.mesh) return null;
    this.mesh.updateMatrixWorld(true);
    return this.mesh.matrixWorld.clone();
  }
}
