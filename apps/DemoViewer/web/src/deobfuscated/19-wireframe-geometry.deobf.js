// ─────────────────────────────────────────────────────────────────────────────
// 19-wireframe-geometry.deobf.js — 线段几何 + LineSegments 材质（line 系列）
//
// 来源：src/app/19-wireframe-geometry.js（Vite 生产构建，prettier 展开版）
// 原文范围：decompiled/index.beautified.js L40908–41380（切片 19-wireframe-geometry）
// 原始压缩名：XO = LineSegmentsGeometry，q/bc = 材质库（common/fog/line uniforms + shader）
//
// 本文件包含：
//   1. LineSegmentsGeometry（XO）—— 用于批量渲染大量线段（如弹道 tracers）的
//      实例化线段几何：用 instanceStart/instanceEnd 两个属性存每条线段的两个端点。
//   2. line 材质定义（bc.line）—— 顶点/片元 shader：支持 WORLD_UNITS（世界空间
//      线宽）、USE_DASH（虚线）、USE_COLOR（端点渐变色）、USE_ALPHA_TO_COVERAGE。
//
// 说明：这是 three.js 的 LineSegmentsGeometry/LineMaterial（examples）的缩减版，
//       被 csdemo.tv 打进主 bundle 用于渲染弹道。标识符已重命名，关键逻辑补注释。
//       未改任何语义。
// ─────────────────────────────────────────────────────────────────────────────

// ── LineSegmentsGeometry（XO） ────────────────────────────────────────────────

class LineSegmentsGeometry extends InstancedBufferGeometry {
  constructor() {
    super();
    this.isLineSegmentsGeometry = true;
    this.type = 'LineSegmentsGeometry';

    // 预定义的 index/position/uv：一个 2D 线段四边形（用于 GS 扩展成线）
    this.setIndex([0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5]);
    this.setAttribute(
      'position',
      new InterleavedBufferAttribute(
        new InterleavedBuffer(new Float32Array([-1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1, -1, 0]), 3),
      ),
    );
    this.setAttribute('uv', new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array([-1, 2, 1, 2, -1, 1, 1, 1, -1, -1, 1, -1, -1, -2, 1, -2]), 2)));
  }

  applyMatrix4(matrix) {
    const start = this.attributes.instanceStart;
    const end = this.attributes.instanceEnd;
    if (start !== undefined) {
      start.applyMatrix4(matrix);
      end.applyMatrix4(matrix);
      start.needsUpdate = true;
    }
    if (this.boundingBox !== null) this.computeBoundingBox();
    if (this.boundingSphere !== null) this.computeBoundingSphere();
    return this;
  }

  /** 设置线段端点（每 6 个 float 一条：start.xyz + end.xyz） */
  setPositions(array) {
    let positions;
    if (array instanceof Float32Array) positions = array;
    else if (Array.isArray(array)) positions = new Float32Array(array);

    const interleaved = new InterleavedBuffer(positions, 6, 1); // 6 个 float/条，偏移 0
    this.setAttribute('instanceStart', new InterleavedBufferAttribute(interleaved, 3, 0));
    this.setAttribute('instanceEnd', new InterleavedBufferAttribute(interleaved, 3, 3));
    this.instanceCount = this.attributes.instanceStart.count;
    this.computeBoundingBox();
    this.computeBoundingSphere();
    return this;
  }

  /** 设置线段端点颜色（start.rgb + end.rgb） */
  setColors(array) {
    let colors;
    if (array instanceof Float32Array) colors = array;
    else if (Array.isArray(array)) colors = new Float32Array(array);

    const interleaved = new InterleavedBuffer(colors, 6, 1);
    this.setAttribute('instanceColorStart', new InterleavedBufferAttribute(interleaved, 3, 0));
    this.setAttribute('instanceColorEnd', new InterleavedBufferAttribute(interleaved, 3, 3));
    return this;
  }

  fromWireframeGeometry(geometry) {
    this.setPositions(geometry.attributes.position.array);
    return this;
  }

  fromEdgesGeometry(geometry) {
    this.setPositions(geometry.attributes.position.array);
    return this;
  }

  fromMesh(mesh) {
    this.fromWireframeGeometry(new WireframeGeometry(mesh.geometry));
    return this;
  }

  fromLineSegments(lineSegments) {
    const geometry = lineSegments.geometry;
    this.setPositions(geometry.attributes.position.array);
    return this;
  }

  computeBoundingBox() {
    if (this.boundingBox === null) this.boundingBox = new Box3();
    const start = this.attributes.instanceStart;
    const end = this.attributes.instanceEnd;
    if (start !== undefined && end !== undefined) {
      this.boundingBox.setFromBufferAttribute(start);
      _lineBoundingBox.setFromBufferAttribute(end);
      this.boundingBox.union(_lineBoundingBox);
    }
  }

  computeBoundingSphere() {
    if (this.boundingSphere === null) this.boundingSphere = new Sphere();
    if (this.boundingBox === null) this.computeBoundingBox();
    const start = this.attributes.instanceStart;
    const end = this.attributes.instanceEnd;
    if (start !== undefined && end !== undefined) {
      const center = this.boundingSphere.center;
      this.boundingBox.getCenter(center);
      let maxRadiusSq = 0;
      for (let i = 0, n = start.count; i < n; i++) {
        _lineVector.fromBufferAttribute(start, i);
        maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_lineVector));
        _lineVector.fromBufferAttribute(end, i);
        maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_lineVector));
      }
      this.boundingSphere.radius = Math.sqrt(maxRadiusSq);
      if (isNaN(this.boundingSphere.radius)) {
        console.error(
          'THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.',
          this,
        );
      }
    }
  }

  toJSON() {}
}

// 复用向量（模块级）
const _lineVector = new Vector3();
const _lineBoundingBox = new Box3();

// ── line 材质（bc.line） ──────────────────────────────────────────────────────

// 注册 line 材质到材质库（q = uniform 库，bc = shader 库，So = UniformsUtils）
UniformsLib.line = {
  worldUnits: { value: 1 },
  linewidth: { value: 1 },
  resolution: { value: new Vector2(1, 1) },
  dashOffset: { value: 0 },
  dashScale: { value: 1 },
  dashSize: { value: 1 },
  gapSize: { value: 1 },
};

ShaderLib.line = {
  uniforms: UniformsUtils.merge([UniformsLib.common, UniformsLib.fog, UniformsLib.line]),
  vertexShader: `
	#include <common>
	#include <color_pars_vertex>
	#include <fog_pars_vertex>
	#include <logdepthbuf_pars_vertex>
	#include <clipping_planes_pars_vertex>

	uniform float linewidth;
	uniform vec2 resolution;

	attribute vec3 instanceStart;
	attribute vec3 instanceEnd;

	attribute vec3 instanceColorStart;
	attribute vec3 instanceColorEnd;

	#ifdef WORLD_UNITS

		varying vec4 worldPos;
		varying vec3 worldStart;
		varying vec3 worldEnd;

		#ifdef USE_DASH

			varying vec2 vUv;

		#endif

	#else

		varying vec2 vUv;

	#endif

	#ifdef USE_DASH

		uniform float dashScale;
		attribute float instanceDistanceStart;
		attribute float instanceDistanceEnd;
		varying float vLineDistance;

	#endif

	void trimSegment( const in vec4 start, inout vec4 end ) {

		// 裁剪线段末端，使其终止在相机平面与近平面之间
		float a = projectionMatrix[ 2 ][ 2 ];
		float b = projectionMatrix[ 3 ][ 2 ];
		float nearEstimate = - 0.5 * b / a;

		float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

		end.xyz = mix( start.xyz, end.xyz, alpha );

	}

	void main() {

		#ifdef USE_COLOR

			vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

		#endif

		#ifdef USE_DASH

			vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
			vUv = uv;

		#endif

		float aspect = resolution.x / resolution.y;

		// 相机空间
		vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
		vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

		#ifdef WORLD_UNITS

			worldStart = start.xyz;
			worldEnd = end.xyz;

		#else

			vUv = uv;

		#endif

		bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 );

		if ( perspective ) {

			if ( start.z < 0.0 && end.z >= 0.0 ) {

				trimSegment( start, end );

			} else if ( end.z < 0.0 && start.z >= 0.0 ) {

				trimSegment( end, start );

			}

		}

		// 裁剪空间
		vec4 clipStart = projectionMatrix * start;
		vec4 clipEnd = projectionMatrix * end;

		// NDC 空间
		vec3 ndcStart = clipStart.xyz / clipStart.w;
		vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

		// 方向
		vec2 dir = ndcEnd.xy - ndcStart.xy;

		// 考虑裁剪空间宽高比
		dir.x *= aspect;
		dir = normalize( dir );

		#ifdef WORLD_UNITS

			vec3 worldDir = normalize( end.xyz - start.xyz );
			vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );
			vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
			vec3 worldFwd = cross( worldDir, worldUp );
			worldPos = position.y < 0.5 ? start: end;

			// 高度偏移（线宽）
			float hw = linewidth * 0.5;
			worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

			#ifndef USE_DASH

				// 端点延伸
				worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;

				// 加宽
				worldPos.xyz += worldFwd * hw;

				// 端帽
				if ( position.y > 1.0 || position.y < 0.0 ) {

					worldPos.xyz -= worldFwd * 2.0 * hw;

				}

			#endif

			vec4 clip = projectionMatrix * worldPos;

			// 调整深度使线段重叠整齐
			vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
			clip.z = clipPose.z * clip.w;

		#else

			vec2 offset = vec2( dir.y, - dir.x );
			dir.x /= aspect;
			offset.x /= aspect;

			if ( position.x < 0.0 ) offset *= - 1.0;

			// 端帽
			if ( position.y < 0.0 ) {

				offset += - dir;

			} else if ( position.y > 1.0 ) {

				offset += dir;

			}

			offset *= linewidth;

			offset /= resolution.y;

			vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

			offset *= clip.w;

			clip.xy += offset;

		#endif

		gl_Position = clip;

		vec4 mvPosition = ( position.y < 0.5 ) ? start : end;

		#include <logdepthbuf_vertex>
		#include <clipping_planes_vertex>
		#include <fog_vertex>

	}
	`,
  fragmentShader: `
	uniform vec3 diffuse;
	uniform float opacity;
	uniform float linewidth;

	#ifdef USE_DASH

		uniform float dashOffset;
		uniform float dashSize;
		uniform float gapSize;

	#endif

	varying float vLineDistance;

	#ifdef WORLD_UNITS

		varying vec4 worldPos;
		varying vec3 worldStart;
		varying vec3 worldEnd;

		#ifdef USE_DASH

			varying vec2 vUv;

		#endif

	#else

		varying vec2 vUv;

	#endif

	#include <common>
	#include <color_pars_fragment>
	#include <fog_pars_fragment>
	#include <logdepthbuf_pars_fragment>
	#include <clipping_planes_pars_fragment>

	// 求两条线段之间的最近点参数（线段 p1-p2 与 p3-p4）
	vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

		float mua;
		float mub;

		vec3 p13 = p1 - p3;
		vec3 p43 = p4 - p3;

		vec3 p21 = p2 - p1;

		float d1343 = dot( p13, p43 );
		float d4321 = dot( p43, p21 );
		float d1321 = dot( p13, p21 );
		float d4343 = dot( p43, p43 );
		float d2121 = dot( p21, p21 );

		float denom = d2121 * d4343 - d4321 * d4321;

		float numer = d1343 * d4321 - d1321 * d4343;

		mua = numer / denom;
		mua = clamp( mua, 0.0, 1.0 );
		mub = ( d1343 + d4321 * ( mua ) ) / d4343;
		mub = clamp( mub, 0.0, 1.0 );

		return vec2( mua, mub );

	}

	void main() {

		float alpha = opacity;
		vec4 diffuseColor = vec4( diffuse, alpha );

		#include <clipping_planes_fragment>

		#ifdef USE_DASH

			if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // 丢弃端帽

			if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard;

		#endif

		#ifdef WORLD_UNITS

			// 在视线与线段之间找最近点，用于世界空间线宽抗锯齿
			vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
			vec3 lineDir = worldEnd - worldStart;
			vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

			vec3 p1 = worldStart + lineDir * params.x;
			vec3 p2 = rayEnd * params.y;
			vec3 delta = p1 - p2;
			float len = length( delta );
			float norm = len / linewidth;

			#ifndef USE_DASH

				#ifdef USE_ALPHA_TO_COVERAGE

					float dnorm = fwidth( norm );
					alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

				#else

					if ( norm > 0.5 ) {

						discard;

					}

				#endif

			#endif

		#else

			#ifdef USE_ALPHA_TO_COVERAGE

				float a = vUv.x;
				float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
				float len2 = a * a + b * b;
				float dlen = fwidth( len2 );

				if ( abs( vUv.y ) > 1.0 ) {

					alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

				}

			#else

				if ( abs( vUv.y ) > 1.0 ) {

					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;

					if ( len2 > 1.0 ) discard;

				}

			#endif

		#endif

		#include <logdepthbuf_fragment>
		#include <color_fragment>

		gl_FragColor = vec4( diffuseColor.rgb, alpha );

		#include <tonemapping_fragment>
		#include <colorspace_fragment>
		#include <fog_fragment>
		#include <premultiplied_alpha_fragment>

	}
	`,
};
