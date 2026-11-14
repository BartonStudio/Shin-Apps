// ─────────────────────────────────────────────────────────────────────────────
// 20-line-material.deobf.js — 线段材质 + 线段 raycast（LineMaterial）
//
// 来源：src/app/20-line-material.js（Vite 生产构建，prettier 展开版）
// 原始压缩名：ZO = LineMaterial，pk = getWorldUnitLineWidth，mk/hk = 线段 raycast
//
// 本文件包含：
//   1. LineMaterial（ZO）—— 线段材质（继承 ShaderMaterial），提供 color / worldUnits /
//      linewidth / dashed / dashScale / dashSize / dashOffset / gapSize / opacity /
//      resolution / alphaToCoverage 等 getter/setter。
//   2. 线段 raycast（mk / hk）—— 计算鼠标拾取与线段的最近距离，返回交点。
//
// 说明：这是 three.js LineMaterial（examples）的缩减版。标识符已重命名，
//       关键逻辑补注释。未改任何语义。
// ─────────────────────────────────────────────────────────────────────────────

// ── LineMaterial（ZO） ────────────────────────────────────────────────────────

class LineMaterial extends ShaderMaterial {
  constructor(parameters) {
    super({
      type: 'LineMaterial',
      uniforms: UniformsUtils.clone(ShaderLib.line.uniforms),
      vertexShader: ShaderLib.line.vertexShader,
      fragmentShader: ShaderLib.line.fragmentShader,
      clipping: true,
    });
    this.isLineMaterial = true;
    this.setValues(parameters);
  }

  get color() {
    return this.uniforms.diffuse.value;
  }
  set color(value) {
    this.uniforms.diffuse.value = value;
  }

  get worldUnits() {
    return 'WORLD_UNITS' in this.defines;
  }
  set worldUnits(value) {
    if ((value === true) !== this.worldUnits) this.needsUpdate = true;
    if (value === true) this.defines.WORLD_UNITS = '';
    else delete this.defines.WORLD_UNITS;
  }

  get linewidth() {
    return this.uniforms.linewidth.value;
  }
  set linewidth(value) {
    if (this.uniforms.linewidth) this.uniforms.linewidth.value = value;
  }

  get dashed() {
    return 'USE_DASH' in this.defines;
  }
  set dashed(value) {
    if ((value === true) !== this.dashed) this.needsUpdate = true;
    if (value === true) this.defines.USE_DASH = '';
    else delete this.defines.USE_DASH;
  }

  get dashScale() {
    return this.uniforms.dashScale.value;
  }
  set dashScale(value) {
    this.uniforms.dashScale.value = value;
  }

  get dashSize() {
    return this.uniforms.dashSize.value;
  }
  set dashSize(value) {
    this.uniforms.dashSize.value = value;
  }

  get dashOffset() {
    return this.uniforms.dashOffset.value;
  }
  set dashOffset(value) {
    this.uniforms.dashOffset.value = value;
  }

  get gapSize() {
    return this.uniforms.gapSize.value;
  }
  set gapSize(value) {
    this.uniforms.gapSize.value = value;
  }

  get opacity() {
    return this.uniforms.opacity.value;
  }
  set opacity(value) {
    if (this.uniforms) this.uniforms.opacity.value = value;
  }

  get resolution() {
    return this.uniforms.resolution.value;
  }
  set resolution(value) {
    this.uniforms.resolution.value.copy(value);
  }

  get alphaToCoverage() {
    return 'USE_ALPHA_TO_COVERAGE' in this.defines;
  }
  set alphaToCoverage(value) {
    if (this.defines) {
      if ((value === true) !== this.alphaToCoverage) this.needsUpdate = true;
      if (value === true) this.defines.USE_ALPHA_TO_COVERAGE = '';
      else delete this.defines.USE_ALPHA_TO_COVERAGE;
    }
  }
}

// ── 线段 raycast ──────────────────────────────────────────────────────────────

// 复用向量/矩阵（模块级）
const _raycastVector = new Vector4();
const _raycastPoint = new Vector3();
const _raycastA = new Vector3();
const _raycastB = new Vector3();
const _raycastV4a = new Vector4();
const _raycastV4b = new Vector4();
const _raycastV4c = new Vector4();
const _raycastPoint2 = new Vector3();
const _raycastMatrix = new Matrix4();
const _raycastRay = new Ray();
const _raycastClosest = new Vector3();
const _raycastBox = new Box3();
const _raycastSphere = new Sphere();
const _raycastV4 = new Vector4();
let _lineRay; // Raycaster（模块级共享）
let _linePixelSize; // 像素大小

/** 计算世界单位线宽对应的像素比例（供 raycast 用） */
function getWorldUnitLineWidth(camera, pixelSize, viewportSize) {
  _raycastV4.set(0, 0, -pixelSize, 1).applyMatrix4(camera.projectionMatrix);
  _raycastV4.multiplyScalar(1 / _raycastV4.w);
  _raycastV4.x = pixelSize / viewportSize.width;
  _raycastV4.y = pixelSize / viewportSize.height;
  _raycastV4.applyMatrix4(camera.projectionMatrixInverse);
  _raycastV4.multiplyScalar(1 / _raycastV4.w);
  return Math.abs(Math.max(_raycastV4.x, _raycastV4.y));
}

/** 非透视（正交）相机的线段拾取 */
function raycastOrthographic(lineSegments, raycaster, intersects) {
  const matrixWorld = lineSegments.matrixWorld;
  const geometry = lineSegments.geometry;
  const startAttr = geometry.attributes.instanceStart;
  const endAttr = geometry.attributes.instanceEnd;
  const count = Math.min(geometry.instanceCount, startAttr.count);

  for (let i = 0, n = count; i < n; i++) {
    _raycastRay.start.fromBufferAttribute(startAttr, i);
    _raycastRay.end.fromBufferAttribute(endAttr, i);
    _raycastRay.applyMatrix4(matrixWorld);

    const closest = new Vector3();
    const pointOnLine = new Vector3();
    _lineRay.distanceSqToSegment(_raycastRay.start, _raycastRay.end, closest, pointOnLine);

    if (closest.distanceTo(pointOnLine) < _linePixelSize * 0.5) {
      intersects.push({
        point: closest,
        pointOnLine,
        distance: _lineRay.origin.distanceTo(closest),
        object: lineSegments,
        face: null,
        faceIndex: i,
        uv: null,
        uv1: null,
      });
    }
  }
}

/** 透视相机的线段拾取 */
function raycastPerspective(lineSegments, raycaster, intersects) {
  const projectionMatrix = raycaster.camera.projectionMatrix;
  const resolution = lineSegments.material.resolution;
  const matrixWorld = lineSegments.matrixWorld;
  const geometry = lineSegments.geometry;
  const startAttr = geometry.attributes.instanceStart;
  const endAttr = geometry.attributes.instanceEnd;
  const count = Math.min(geometry.instanceCount, startAttr.count);
  const near = -raycaster.camera.near;

  // 先把 ray origin 变换到屏幕空间
  _lineRay.at(1, _raycastV4c);
  _raycastV4c.w = 1;
  _raycastV4c.applyMatrix4(raycaster.camera.matrixWorldInverse);
  _raycastV4c.applyMatrix4(projectionMatrix);
  _raycastV4c.multiplyScalar(1 / _raycastV4c.w);
  _raycastV4c.x *= resolution.x / 2;
  _raycastV4c.y *= resolution.y / 2;
  _raycastV4c.z = 0;
  _raycastPoint2.copy(_raycastV4c);
  _raycastMatrix.multiplyMatrices(raycaster.camera.matrixWorldInverse, matrixWorld);

  for (let i = 0, n = count; i < n; i++) {
    _raycastV4a.fromBufferAttribute(startAttr, i);
    _raycastV4b.fromBufferAttribute(endAttr, i);
    _raycastV4a.w = 1;
    _raycastV4b.w = 1;
    _raycastV4a.applyMatrix4(_raycastMatrix);
    _raycastV4b.applyMatrix4(_raycastMatrix);

    // 裁剪到近平面
    if (_raycastV4a.z > near && _raycastV4b.z > near) continue;
    if (_raycastV4a.z > near) {
      const span = _raycastV4a.z - _raycastV4b.z;
      const t = (_raycastV4a.z - near) / span;
      _raycastV4a.lerp(_raycastV4b, t);
    } else if (_raycastV4b.z > near) {
      const span = _raycastV4b.z - _raycastV4a.z;
      const t = (_raycastV4b.z - near) / span;
      _raycastV4b.lerp(_raycastV4a, t);
    }

    _raycastV4a.applyMatrix4(projectionMatrix);
    _raycastV4b.applyMatrix4(projectionMatrix);
    _raycastV4a.multiplyScalar(1 / _raycastV4a.w);
    _raycastV4b.multiplyScalar(1 / _raycastV4b.w);
    _raycastV4a.x *= resolution.x / 2;
    _raycastV4a.y *= resolution.y / 2;
    _raycastV4b.x *= resolution.x / 2;
    _raycastV4b.y *= resolution.y / 2;

    _raycastRay.start.copy(_raycastV4a);
    _raycastRay.start.z = 0;
    _raycastRay.end.copy(_raycastV4b);
    _raycastRay.end.z = 0;

    const param = _raycastRay.closestPointToPointParameter(_raycastPoint2, true);
    _raycastRay.at(param, _raycastClosest);

    const z = MathUtils.lerp(_raycastV4a.z, _raycastV4b.z, param);
    const inNdc = z >= -1 && z <= 1;
    const isHit = _raycastPoint2.distanceTo(_raycastClosest) < _linePixelSize * 0.5;

    if (inNdc && isHit) {
      _raycastRay.start.fromBufferAttribute(startAttr, i);
      _raycastRay.end.fromBufferAttribute(endAttr, i);
      _raycastRay.start.applyMatrix4(matrixWorld);
      _raycastRay.end.applyMatrix4(matrixWorld);

      const point = new Vector3();
      const pointOnLine = new Vector3();
      _lineRay.distanceSqToSegment(_raycastRay.start, _raycastRay.end, point, pointOnLine);

      intersects.push({
        point,
        pointOnLine,
        distance: _lineRay.origin.distanceTo(point),
        object: lineSegments,
        face: null,
        faceIndex: i,
        uv: null,
        uv1: null,
      });
    }
  }
}
