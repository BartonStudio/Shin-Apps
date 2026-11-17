// 校验 three-bundle.js 的语义导出映射：import 全部符号，检查每个类的
// prototype.isXxx 标记与导出名一致（Color 等无标记类单独列出人工核对）。
// 用法：node tools/verify-exports.mjs
import * as T from '../../webapp/src/player/vendor/three-bundle.js';

const checks = [
  // [导出名, 期望的 prototype.isXxx 标记（可为 null = 无标记，需人工核对）]
  ['Scene', 'isScene'], ['Vector3', 'isVector3'], ['Vector2', 'isVector2'],
  ['PerspectiveCamera', 'isPerspectiveCamera'], ['OrthographicCamera', 'isOrthographicCamera'],
  ['Mesh', 'isMesh'], ['Object3D', 'isObject3D'], ['Bone', 'isBone'], ['SkinnedMesh', 'isSkinnedMesh'],
  ['InstancedMesh', 'isInstancedMesh'], ['Sprite', 'isSprite'], ['Points', 'isPoints'],
  ['Line', 'isLine'], ['LineSegments', 'isLineSegments'], ['Group', 'isGroup'],
  ['Quaternion', 'isQuaternion'], ['Matrix4', 'isMatrix4'], ['Matrix3', 'isMatrix3'],
  ['Box3', 'isBox3'], ['Sphere', 'isSphere'], ['BufferGeometry', 'isBufferGeometry'],
  ['Texture', 'isTexture'], ['DataTexture', 'isDataTexture'], ['CanvasTexture', 'isCanvasTexture'],
  ['Plane', 'isPlane'], ['Fog', 'isFog'], ['FogExp2', 'isFogExp2'],
  ['MeshBasicMaterial', 'isMeshBasicMaterial'], ['MeshStandardMaterial', 'isMeshStandardMaterial'],
  ['MeshLambertMaterial', 'isMeshLambertMaterial'], ['LineBasicMaterial', 'isLineBasicMaterial'],
  ['ShaderMaterial', 'isShaderMaterial'], ['PointsMaterial', 'isPointsMaterial'],
  ['SpriteMaterial', 'isSpriteMaterial'], ['AmbientLight', 'isAmbientLight'],
  ['DirectionalLight', 'isDirectionalLight'], ['PointLight', 'isPointLight'],
  ['HemisphereLight', 'isHemisphereLight'], ['SpotLight', 'isSpotLight'],
  ['WebGLRenderer', null], ['Color', null], ['Raycaster', 'isRaycaster'],
  ['OrbitControls', null], ['FlyControls', null], ['TouchControls', null], ['MathUtils', null],
  ['Euler', 'isEuler'], ['PlaneGeometry', null], ['BoxGeometry', null], ['SphereGeometry', null],
  ['CylinderGeometry', null], ['CapsuleGeometry', null], ['BufferAttribute', null],
];

let bad = 0;
for (const [name, marker] of checks) {
  const Ctor = T[name];
  if (typeof Ctor !== 'function') { console.log(`✗ ${name}: 导出缺失`); bad++; continue; }
  if (marker) {
    const proto = Ctor.prototype ?? {};
    const actual = Object.keys(proto).find((k) => k.startsWith('is'));
    if (proto[marker] !== true) {
      console.log(`✗ ${name}: 期望 ${marker}，实际标记 = ${actual ?? '（无）'}`);
      bad++;
    }
  }
}

// 无标记类的人工核对项
console.log('\n人工核对（无 isXxx 标记）：');
console.log('  Color.setHex 存在?', typeof T.Color?.prototype?.setHex === 'function', '| getHexString?', typeof T.Color?.prototype?.getHexString === 'function');
console.log('  WebGLRenderer.render 存在?', typeof T.WebGLRenderer?.prototype?.render === 'function');
console.log('  MathUtils.degToRad?', typeof T.MathUtils?.degToRad, '| clamp?', typeof T.MathUtils?.clamp);
console.log('  OrbitControls.update?', typeof T.OrbitControls?.prototype?.update === 'function');
console.log('  PlaneGeometry 类型串?', T.PlaneGeometry?.prototype?.type, '| BoxGeometry?', T.BoxGeometry?.prototype?.type, '| SphereGeometry?', T.SphereGeometry?.prototype?.type);

console.log(bad ? `\n共 ${bad} 个映射错误！` : '\n全部 isXxx 标记匹配 ✓');
process.exitCode = bad ? 1 : 0;
