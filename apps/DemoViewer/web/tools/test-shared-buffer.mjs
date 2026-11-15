// 验证 src/deobfuscated/shared-buffer.js：用真实 demo 的数据打包成共享内存镜像，
// 再走一遍 JS 侧的读取路径，与原始 data 逐字段比对。
//
// 这是「C++ 侧还没写完之前，先证明 JS 这一半是对的」的关键测试。
//
// 用法：
//   node tools/test-shared-buffer.mjs            # 全量比对（约 20s，含一次 demo 解析）
//   node tools/test-shared-buffer.mjs --keep     # 保留 tmp/shared-buffer.bin 供检查
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);

globalThis.self = { onmessage: null, postMessage: () => {}, close: () => {} };

// ── 准备可在 Node 运行的 worker（解析真实 demo）──
{
  let src = fs.readFileSync(R('src/workers/parser.worker.js'), 'utf8');
  src = src.replace(/At\.onmessage = async \(e\) => \{[\s\S]*?\n\}\n?$/, '\n');
  src += `\nexport { lt as initParser, gt as parseDemoCore };\n`;
  fs.mkdirSync(R('tmp'), { recursive: true });
  fs.mkdirSync(tmpDir(), { recursive: true });
  fs.writeFileSync(tmpFile('worker-runnable.mjs'), src, 'utf8');
}

const { computeSpeedColumns } = await import('file:///' + R('src/deobfuscated/speed-columns.js').replace(/\\/g, '/'));
const SB = await import('file:///' + R('src/deobfuscated/shared-buffer.js').replace(/\\/g, '/'));
const CSDF = await import('file:///' + R('tools/csdf-format.mjs').replace(/\\/g, '/'));

const w = await import('file:///' + tmpFile('worker-runnable.mjs').replace(/\\/g, '/'));
{
  const wasm = fs.readFileSync(R('raw/assets/csplayer_parser_bg-qigVgicw.wasm'));
  const quiet = console.warn; console.warn = () => {};
  await w.initParser({ module_or_path: new Response(wasm, { headers: { 'Content-Type': 'application/wasm' } }) });
  console.warn = quiet;
}

import {
  REPO_ROOT as P_ROOT, needDemo, tmpDir, tmpFile, imagePath, sidecarPath,
  goldenPath, needFile, opt, hasFlag, wantsHelp, printUsage, COMMON_OPTIONS,
} from './paths.mjs';

if (wantsHelp()) {
  printUsage('tools/test-shared-buffer.mjs',
    'JS 写共享内存 -> JS 读回，逐字节比对（不需要 C++）',
    [COMMON_OPTIONS.demo, COMMON_OPTIONS.tmp, ['--keep', '保留中间镜像'], COMMON_OPTIONS.help],
    ['node tools/test-shared-buffer.mjs',
     'node tools/test-shared-buffer.mjs --demo D:\\demos\\match.dem --keep']);
  process.exit(0);
}

const DEMO = needFile(needDemo(), 'demo 文件', '--demo', 'CSDEMO_DEM');

console.log(`解析 ${DEMO} …`);
const t0 = Date.now();
const { data } = w.parseDemoCore(new Uint8Array(fs.readFileSync(DEMO)), { sampleRate: 64 }, {});
computeSpeedColumns(data);
const N = data.frames.frameTick.length, P = data.meta.numPlayers, M = data.panelFrames.frameTick.length;
console.log(`解析完成 ${((Date.now() - t0) / 1000).toFixed(1)}s：N=${N} P=${P} M=${M}\n`);

const out = [];
const PASS = (l, d = '') => out.push(['PASS', l, d]);
const FAIL = (l, d = '') => out.push(['FAIL', l, d]);
const INFO = (l, d = '') => out.push(['INFO', l, d]);

// ═══ 1. 常量一致性：shared-buffer.js 与 tools/csdf-format.mjs 必须对齐 ═══
{
  const pairs = [
    ['CSDF_MAGIC', SB.CSDF_MAGIC, CSDF.MAGIC],
    ['CSDF_VERSION', SB.CSDF_VERSION, CSDF.VERSION],
    ['CSDF_HEADER_BYTES', SB.CSDF_HEADER_BYTES, CSDF.HEADER_BYTES],
    ['CSDF_ALIGN', SB.CSDF_ALIGN, CSDF.ALIGN],
    ['FLAG_ACCURACY', SB.FLAG_ACCURACY, CSDF.FLAG_ACCURACY],
    ['FLAG_RELOADING', SB.FLAG_RELOADING, CSDF.FLAG_RELOADING],
    ['FLAG_PLAYER_FLAGS', SB.FLAG_PLAYER_FLAGS, CSDF.FLAG_PLAYER_FLAGS],
    ['FLAG_PANELS', SB.FLAG_PANELS, CSDF.FLAG_PANELS],
    ['FLAG_SPEED', SB.FLAG_SPEED, CSDF.FLAG_SPEED],
    ['FLAG_SMOOTH_SPEED', SB.FLAG_SMOOTH_SPEED, CSDF.FLAG_SMOOTH_SPEED],
  ];
  const bad = pairs.filter(([, a, b]) => a !== b);
  bad.length === 0 ? PASS(`与 tools/csdf-format.mjs 的 ${pairs.length} 个常量一致`, '')
    : FAIL('常量不一致', bad.map(([n, a, b]) => `${n}: ${a} vs ${b}`).join(', '));
}

// ═══ 2. 布局：块对齐、互不重叠 ═══
let layout, bytes;
{
  const plan = SB.planSharedBuffer(data);
  layout = plan.layout;
  bytes = plan.bytes;
  INFO('元数据 JSON 大小', `${(JSON.stringify(plan.meta).length / 1024).toFixed(0)} KB（blob ${(plan.counts.blobBytes / 1048576).toFixed(1)} MB 单独存放）`);

  layout.blocks[0].offset === SB.DATA_OFFSET
    ? PASS('第一个列块起点 = DATA_OFFSET（header 64B + 2×1MB 元数据区）', `${SB.DATA_OFFSET}`)
    : FAIL('第一个列块起点不对', String(layout.blocks[0].offset));

  const misaligned = layout.blocks.filter((b) => b.offset % CSDF.ALIGN !== 0);
  misaligned.length === 0 ? PASS('所有列块起点 64 字节对齐', `${layout.blocks.length} 个块`)
    : FAIL('列块未对齐', misaligned.map((b) => b.name).join(','));

  const wrongTypeAlign = layout.blocks.filter((b) => b.offset % SB_TS(b.type) !== 0);
  function SB_TS(t) { return { i32: 4, f32: 4, u8: 1, u16: 2 }[t]; }
  wrongTypeAlign.length === 0 ? PASS('所有列块起点按类型对齐（能安全建视图）', '')
    : FAIL('类型对齐失败', wrongTypeAlign.map((b) => `${b.name}(${b.offset}%${SB_TS(b.type)})`).join(','));

  let overlap = null;
  for (let i = 1; i < layout.blocks.length; i++) {
    if (layout.blocks[i].offset < layout.blocks[i - 1].offset + layout.blocks[i - 1].padded) {
      overlap = `${layout.blocks[i - 1].name} / ${layout.blocks[i].name}`; break;
    }
  }
  overlap === null ? PASS('列块无重叠', `${layout.blocks.length} 个块，共 ${(bytes / 1048576).toFixed(1)} MB`)
    : FAIL('列块重叠', overlap);

  INFO('共享内存总需求', `${(bytes / 1048576).toFixed(1)} MB（含 2 MB 元数据区）`);
}

// ═══ 3. 打包 → 读回 → 逐字段比对 ═══
{
  const ab = new ArrayBuffer(bytes);
  const t1 = Date.now();
  SB.writeSharedBuffer(ab, data, { version: 2 });
  const writeMs = Date.now() - t1;
  INFO('writeSharedBuffer 耗时', `${writeMs} ms`);

  fs.writeFileSync(tmpFile('shared-buffer.bin'), Buffer.from(ab));

  const visible = {
    version: 2,
    loadedRounds: data.rounds.length,
    visibleFrames: N,
    panelVisibleFrames: M,
    durationSeconds: data.meta.durationSeconds,
  };
  const t2 = Date.now();
  const back = SB.buildDataFromSharedBuffer(ab, visible);
  INFO('buildDataFromSharedBuffer 耗时', `${Date.now() - t2} ms（含一次 JSON.parse）`);

  // ---- meta ----
  const metaKeys = ['mapName', 'tickRate', 'sampleRate', 'numPlayers', 'numFrames', 'startTick', 'endTick'];
  const metaBad = metaKeys.filter((k) => back.meta[k] !== data.meta[k]);
  metaBad.length === 0 ? PASS('meta 全部标量一致', metaKeys.join(','))
    : FAIL('meta 不一致', metaBad.map((k) => `${k}: ${back.meta[k]} vs ${data.meta[k]}`).join(', '));

  // ---- TypedArray 列逐字节比对 ----
  const cmpTyped = (label, a, b) => {
    if (!a || !b) return FAIL(`${label} 缺失`, `${!!a} vs ${!!b}`);
    if (a.length !== b.length) return FAIL(`${label} 长度不同`, `${a.length} vs ${b.length}`);
    const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return FAIL(`${label} 第 ${i} 字节不同`, '');
    return PASS(`${label} 逐字节一致`, `${a.length} 元素`);
  };

  const frameCols = ['frameTick', 'posX', 'posY', 'posZ', 'yaw', 'pitch', 'health', 'alive', 'team', 'score',
    'duck', 'flash', 'flashAlpha', 'zoom', 'accuracyPenalty', 'reloading', 'playerFlags', 'speed', 'smoothSpeed'];
  let frameOk = 0;
  for (const k of frameCols) {
    const r = cmpTyped(`frames.${k}`, back.frames[k], data.frames[k]);
    if (r[0] === 'FAIL') out.push(r); else frameOk++;
  }
  if (frameOk === frameCols.length) PASS(`frames 全部 ${frameCols.length} 列逐字节一致`, `含 speed/smoothSpeed`);

  const panelCols = ['frameTick', 'health', 'alive', 'team', 'armor', 'flags', 'money', 'clipAmmo', 'reserveAmmo', 'activeWeapon', 'utilCounts'];
  let panelOk = 0;
  for (const k of panelCols) {
    const r = cmpTyped(`panelFrames.${k}`, back.panelFrames[k], data.panelFrames[k]);
    if (r[0] === 'FAIL') out.push(r); else panelOk++;
  }
  if (panelOk === panelCols.length) PASS(`panelFrames 全部 ${panelCols.length} 列逐字节一致`, '');
  back.panelFrames.numFrames === data.panelFrames.numFrames
    ? PASS('panelFrames.numFrames 一致', String(back.panelFrames.numFrames))
    : FAIL('panelFrames.numFrames 不一致', `${back.panelFrames.numFrames} vs ${data.panelFrames.numFrames}`);

  // ---- 区间数据 ----
  for (const k of ['origin', 'end', 'tick', 'team', 'hitKind']) {
    const r = cmpTyped(`tracers.${k}`, back.tracers[k], data.tracers[k]);
    if (r[0] === 'FAIL') out.push(r);
  }
  back.tracers.count === data.tracers.count ? PASS('tracers 5 列 + count 一致', String(back.tracers.count)) : FAIL('tracers.count 不一致', '');
  for (const k of ['attackerSlot', 'victimSlot', 'tick', 'dmg']) {
    const r = cmpTyped(`damage.${k}`, back.damage[k], data.damage[k]);
    if (r[0] === 'FAIL') out.push(r);
  }
  back.damage.count === data.damage.count ? PASS('damage 4 列 + count 一致', String(back.damage.count)) : FAIL('damage.count 不一致', '');
  cmpTyped('weaponFires.ticks', back.weaponFires.ticks, data.weaponFires.ticks);
  cmpTyped('weaponFires.slots', back.weaponFires.slots, data.weaponFires.slots);
  for (const k of ['tickBegin', 'detonation', 'color', 'bufferOffsets', 'buffers', 'frameOffsets', 'frameTicks']) {
    const r = cmpTyped(`smokeVoxels.${k}`, back.smokeVoxels[k], data.smokeVoxels[k]);
    if (r[0] === 'FAIL') out.push(r);
  }
  back.smokeVoxels.count === data.smokeVoxels.count ? PASS('smokeVoxels 7 列 + count 一致', String(back.smokeVoxels.count)) : FAIL('smoke count 不一致', '');

  // ---- 元数据对象 ----
  // 语义深比对：把 TypedArray 与普通数组视为等价（只比数值，容差 1e-6）
  // 为什么需要：mapEntities[].origin 在本地解析路径里是普通数组，
  // 读回共享内存后是 Float32Array 视图 —— 数值相同、类型不同，下游只做下标访问，功能无差。
  const deepEq = (a, b, path = '') => {
    if (a === b) return null;
    const isArr = (x) => Array.isArray(x) || ArrayBuffer.isView(x);
    if (isArr(a) && isArr(b)) {
      if (a.length !== b.length) return `${path} 长度 ${a.length} vs ${b.length}`;
      for (let i = 0; i < a.length; i++) {
        const r = deepEq(a[i], b[i], `${path}[${i}]`);
        if (r) return r;
      }
      return null;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      // 值为 undefined 的键视为不存在（JSON 无法表示 undefined，
      // 而 obj.k === undefined 与键缺失在 JS 里等价）
      const ka = Object.keys(a).filter((k) => a[k] !== undefined);
      const kb = Object.keys(b).filter((k) => b[k] !== undefined);
      const onlyA = ka.filter((k) => !(k in b)), onlyB = kb.filter((k) => !(k in a));
      if (onlyA.length || onlyB.length) return `${path} 键不同（多 ${onlyA.join(',')} / 缺 ${onlyB.join(',')}）`;
      for (const k of ka) {
        const r = deepEq(a[k], b[k], `${path}.${k}`);
        if (r) return r;
      }
      return null;
    }
    if (typeof a === 'number' && typeof b === 'number') {
      return Math.abs(a - b) <= 1e-6 ? null : `${path} ${a} vs ${b}`;
    }
    return `${path} ${JSON.stringify(a)?.slice(0, 40)} vs ${JSON.stringify(b)?.slice(0, 40)}`;
  };
  const jsonEq = (label, a, b) => {
    const diff = deepEq(a, b);
    diff === null ? PASS(label, `${JSON.stringify(a)?.length ?? 0} 字节`) : FAIL(`${label} 不一致`, diff);
  };
  jsonEq('players 一致', back.players, data.players);
  jsonEq('rounds 一致', back.rounds, data.rounds);
  jsonEq('weaponNames 一致', back.weaponNames, data.weaponNames);
  jsonEq('events 一致', back.events, data.events);
  jsonEq('bomb 一致', back.bomb, data.bomb);
  jsonEq('deathMarkers 一致', back.deathMarkers, data.deathMarkers);
  jsonEq('timeouts 一致', back.timeouts, data.timeouts);
  jsonEq('deathRagdolls 一致', back.deathRagdolls, data.deathRagdolls);
  jsonEq('mapEntities 一致', back.mapEntities, data.mapEntities);
  jsonEq('droppedWeapons 一致', back.droppedWeapons, data.droppedWeapons);
  jsonEq('grenades.effects 一致', back.grenades.effects, data.grenades.effects);

  // grenades 的 Float32Array 被 JSON 化过，比数值而不是比引用
  {
    const a = back.grenades.trajectories, b = data.grenades.trajectories;
    if (a.length !== b.length) FAIL('grenades.trajectories 数量不同', `${a.length} vs ${b.length}`);
    else {
      let bad = 0, firstBad = null;
      for (let i = 0; i < a.length; i++) {
        if (a[i].kind !== b[i].kind || a[i].throwerSlot !== b[i].throwerSlot ||
          a[i].startTick !== b[i].startTick || a[i].endTick !== b[i].endTick ||
          a[i].detonationTick !== b[i].detonationTick ||
          a[i].posXYZ.length !== b[i].posXYZ.length || a[i].ticks.length !== b[i].ticks.length) { bad++; firstBad ??= i; continue; }
        for (let j = 0; j < a[i].posXYZ.length; j++) {
          if (Math.abs(a[i].posXYZ[j] - b[i].posXYZ[j]) > 1e-6) { bad++; firstBad ??= i; break; }
        }
      }
      bad === 0 ? PASS('grenades.trajectories 一致', `${a.length} 条（JSON 化后数值比对）`)
        : FAIL('grenades.trajectories 不一致', `${bad} 条不同，首个 #${firstBad}`);
    }
  }
  {
    const a = back.grenades.infernos, b = data.grenades.infernos;
    if (a.length !== b.length) FAIL('grenades.infernos 数量不同', `${a.length} vs ${b.length}`);
    else {
      let bad = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i].entityId !== b[i].entityId || a[i].startTick !== b[i].startTick || a[i].frames.length !== b[i].frames.length) { bad++; continue; }
        for (let k = 0; k < a[i].frames.length; k++) {
          if (a[i].frames[k].tick !== b[i].frames[k].tick) { bad++; break; }
          const pa = a[i].frames[k].positions, pb = b[i].frames[k].positions;
          for (let j = 0; j < pb.length; j++) if (Math.abs(pa[j] - pb[j]) > 1e-6) { bad++; break; }
        }
      }
      bad === 0 ? PASS('grenades.infernos 一致', `${a.length} 条（含嵌套 frames）`)
        : FAIL('grenades.infernos 不一致', `${bad} 条不同`);
    }
  }

  // ═══ 4. 部分可见：只发布前半段，视图长度必须跟着变 ═══
  {
    const halfN = Math.floor(N / 2), halfM = Math.floor(M / 2);
    const part = SB.buildDataFromSharedBuffer(ab, { ...visible, visibleFrames: halfN, panelVisibleFrames: halfM });
    const ok = part.frames.frameTick.length === halfN
      && part.frames.posX.length === halfN * P
      && part.panelFrames.frameTick.length === halfM
      && part.meta.numFrames === halfN
      && part.meta.endTick === data.frames.frameTick[halfN - 1];
    ok ? PASS('部分可见：视图长度与 endTick 自动跟随', `N=${halfN} M=${halfM}`)
      : FAIL('部分可见失败', `${part.frames.frameTick.length}/${part.meta.numFrames}/${part.meta.endTick}`);
  }

  // ═══ 5. 越界防护 ═══
  {
    let threw = false;
    try { SB.buildDataFromSharedBuffer(ab, { ...visible, visibleFrames: N + 1 }); } catch { threw = true; }
    threw ? PASS('visibleFrames 超出容量会抛错（不静默读脏数据）', '') : FAIL('越界未抛错', '');
  }

  // ═══ 6. 自检输出可用 ═══
  {
    const txt = SB.describeSharedBuffer(ab);
    const ok = txt.includes('CSDF v1') && txt.includes('元数据区 A') && txt.includes('counts');
    ok ? PASS('describeSharedBuffer 能输出布局自检', `${txt.split('\n').length} 行`)
      : FAIL('describeSharedBuffer 输出异常', txt.slice(0, 120));
  }
}

// ── 输出 ──
const width = Math.max(...out.map((o) => o[1].length));
for (const [s, l, d] of out) console.log(`[${s}] ${l.padEnd(width)}  ${d}`);
const fails = out.filter((o) => o[0] === 'FAIL');
const passes = out.filter((o) => o[0] === 'PASS');
console.log(`\n${'─'.repeat(74)}`);
console.log(`PASS ${passes.length}  FAIL ${fails.length}  INFO ${out.length - passes.length - fails.length}`);
if (!process.argv.includes('--keep')) fs.rmSync(tmpFile('shared-buffer.bin'), { force: true });
process.exitCode = fails.length ? 1 : 0;
