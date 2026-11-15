// 用真实 .dem 验证 docs/07 数据契约。
//
// 为什么需要它：`fixtures/` 里的合成数据只能证明「规范与实现自洽」，
// 不能证明「规范本身对不对」。这个脚本直接驱动 raw/assets 里的 wasm 解析真实 demo，
// 再把解析结果逐条对照 docs/07 的每一条约定。
//
// 用法：
//   node tools/validate-contract-against-demo.mjs [--demo test.dem] [--rate 64]
//
// 退出码 0 = 全部通过。FAIL 项都会指出 docs/07 需要修正的具体条目。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = (p) => path.join(ROOT, p);
import {
  REPO_ROOT as P_ROOT, needDemo, tmpDir, tmpFile, imagePath, sidecarPath,
  goldenPath, needFile, opt, hasFlag, wantsHelp, printUsage, COMMON_OPTIONS,
} from './paths.mjs';

if (wantsHelp()) {
  printUsage('tools/validate-contract-against-demo.mjs',
    '用真实 demo 验证 docs/07 的数据契约',
    [COMMON_OPTIONS.demo, ['--rate <16|32|64>', '采样率（默认 64）'], COMMON_OPTIONS.help],
    ['node tools/validate-contract-against-demo.mjs',
     'node tools/validate-contract-against-demo.mjs --demo D:\\demos\\match.dem']);
  process.exit(0);
}

// demo 路径：--demo > $CSDEMO_DEM（没有默认值，必须显式给出）
const DEMO = needFile(needDemo(), 'demo 文件', '--demo', 'CSDEMO_DEM');
const RATE = Number(opt('rate') ?? 64);

// ── 准备可在 Node 运行的 worker 胶水 ──
{
  let src = fs.readFileSync(R('src/workers/parser.worker.js'), 'utf8');
  src = src.replace(/At\.onmessage = async \(e\) => \{[\s\S]*?\n\}\n?$/, '\n');
  src += `\nexport { lt as initParser, Ue as parseHeaderRaw, gt as parseDemoCore };\n`;
  fs.mkdirSync(R('tmp'), { recursive: true });
  fs.writeFileSync(R('tmp/worker-runnable.mjs'), src, 'utf8');
}
globalThis.self = { onmessage: null, postMessage: () => {}, close: () => {} };
const w = await import('file:///' + R('tmp/worker-runnable.mjs').replace(/\\/g, '/'));
{
  const wasm = fs.readFileSync(R('raw/assets/csplayer_parser_bg-qigVgicw.wasm'));
  const quiet = console.warn;
  console.warn = () => {};
  await w.initParser({ module_or_path: new Response(wasm, { headers: { 'Content-Type': 'application/wasm' } }) });
  console.warn = quiet;
}

const { computeSpeedColumns } = await import('file:///' + R('src/deobfuscated/speed-columns.js').replace(/\\/g, '/'));

const demoBytes = new Uint8Array(fs.readFileSync(DEMO));
console.log(`解析 ${DEMO}（${(demoBytes.length / 1e6).toFixed(1)} MB，采样率 ${RATE} Hz）…`);
const t0 = Date.now();
let manifest = null;
const { data } = w.parseDemoCore(demoBytes, { sampleRate: RATE }, { onManifest: (mf) => { manifest = mf; } });
console.log(`解析完成 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

const F = data.frames, P = data.panelFrames, META = data.meta, NP = META.numPlayers;
const out = [];
const PASS = (l, d = '') => out.push(['PASS', l, d]);
const FAIL = (l, d = '') => out.push(['FAIL', l, d]);
const INFO = (l, d = '') => out.push(['INFO', l, d]);
const isArr = (v) => v && typeof v.length === 'number' && typeof v !== 'string';

// ═══ 1. 索引公式 value = arr[frame*P + player] ═══
{
  const N = F.frameTick.length;
  const bad = Object.entries(F).filter(([k, v]) => k !== 'frameTick' && isArr(v) && v.length !== N * NP);
  bad.length === 0
    ? PASS('§3.1 frames 所有列长度 = N × P', `N=${N} P=${NP} → ${N * NP}`)
    : FAIL('§3.1 frames 列长度不等于 N×P', bad.map(([k, v]) => `${k}:${v.length}`).join(', '));

  const M = P.frameTick.length;
  const badP = Object.entries(P).filter(([k, v]) => k !== 'frameTick' && k !== 'numFrames' && isArr(v) && v.length !== M * NP);
  badP.length === 0
    ? PASS('§4 panelFrames 所有列长度 = M × P', `M=${M} P=${NP} → ${M * NP}`)
    : FAIL('§4 panelFrames 列长度不等于 M×P', badP.map(([k, v]) => `${k}:${v.length}`).join(', '));
}

// ═══ 2. 附录 B：两套 tick 可以不同 ═══
{
  const N = F.frameTick.length, M = P.frameTick.length;
  INFO('附录 B frames/panelFrames 的 tick 数', `${N} / ${M}`);
  if (N === M) {
    // 数量相同不代表集合相同，所以还要比内容
    const same = F.frameTick.every((t, i) => t === P.frameTick[i]);
    same ? FAIL('附录 B 无法验证（两套 tick 完全相同）', `${N} 个 tick 逐一相同`) : PASS('附录 B 成立（数量相同但内容不同）', '');
  } else {
    const fset = new Set(F.frameTick);
    const inF = [...P.frameTick].filter((t) => fset.has(t)).length;
    PASS('附录 B 成立：两套 tick 独立', `${N} != ${M}；panelFrames 有 ${((inF / M) * 100).toFixed(1)}% 落在 frames 集合内`);
    const fg = new Set(); for (let i = 1; i < Math.min(N, 5000); i++) fg.add(F.frameTick[i] - F.frameTick[i - 1]);
    const pg = new Set(); for (let i = 1; i < Math.min(M, 3000); i++) pg.add(P.frameTick[i] - P.frameTick[i - 1]);
    INFO('frames 相邻 tick 间隔', [...fg].sort((a, b) => a - b).slice(0, 6).join(','));
    INFO('panelFrames 相邻 tick 间隔', [...pg].sort((a, b) => a - b).slice(0, 6).join(','));
  }
}

// ═══ 3. frameTick 严格升序 + 与 meta 端点一致 ═══
{
  const mono = (a) => { for (let i = 1; i < a.length; i++) if (a[i] <= a[i - 1]) return false; return true; };
  mono(F.frameTick) ? PASS('§3.2 frames.frameTick 严格升序', '') : FAIL('§3.2 frames.frameTick 非严格升序', '');
  mono(P.frameTick) ? PASS('§4 panelFrames.frameTick 严格升序', '') : FAIL('§4 panelFrames.frameTick 非严格升序', '');
  F.frameTick[0] === META.startTick ? PASS('frames.frameTick[0] == meta.startTick', String(META.startTick)) : INFO('frames.frameTick[0] != meta.startTick', `${F.frameTick[0]} vs ${META.startTick}`);
  F.frameTick[F.frameTick.length - 1] === META.endTick ? PASS('frames.frameTick[末] == meta.endTick', String(META.endTick)) : INFO('frames 末 tick != meta.endTick', `${F.frameTick[F.frameTick.length - 1]} vs ${META.endTick}`);
}

// ═══ 4. 值域与取值集合（§3.2 字段表）═══
{
  const ranges = (arr, name, lo, hi) => {
    let mn = Infinity, mx = -Infinity, bad = 0;
    for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (!Number.isFinite(v)) { bad++; continue; } if (v < mn) mn = v; if (v > mx) mx = v; }
    if (bad) FAIL(`${name} 含非有限值`, String(bad));
    else if (mn < lo || mx > hi) FAIL(`${name} 超出 docs/07 约定`, `[${mn}, ${mx}] 不在 [${lo}, ${hi}]`);
    else PASS(`${name} 值域 ⊂ 约定`, `[${mn.toFixed(3)}, ${mx.toFixed(3)}]`);
  };
  const sets = (arr, name, allowed) => {
    const s = new Set(); for (let i = 0; i < arr.length; i++) s.add(arr[i]);
    const extra = [...s].filter((v) => !allowed.includes(v));
    extra.length
      ? FAIL(`${name} 出现 docs/07 未列的取值`, `实际 {${[...s].sort((a, b) => a - b).join(',')}}，未列 ${extra.slice(0, 6).join(',')}`)
      : PASS(`${name} 取值集合 ⊂ 约定`, `{${[...s].sort((a, b) => a - b).join(',')}}`);
  };

  sets(F.team, '§3.2 frames.team', [0, 2, 3]);
  sets(F.alive, '§3.2 frames.alive', [0, 1]);
  sets(F.zoom, '§3.2 frames.zoom', [0, 1, 2]);
  sets(F.reloading, '§3.2 frames.reloading', [0, 1]);
  ranges(F.health, '§3.2 frames.health', 0, 100);
  ranges(F.duck, '§3.2 frames.duck', 0, 1);
  ranges(F.yaw, '§3.4 frames.yaw（度）', -360, 360);
  ranges(F.pitch, '§3.4 frames.pitch（度）', -90, 90);
  sets(P.alive, '§4 panelFrames.alive', [0, 1]);
  sets(P.team, '§4 panelFrames.team', [0, 2, 3]);
  ranges(P.health, '§4 panelFrames.health', 0, 100);

  // team=0 是什么
  let t0 = 0, t0alive = 0;
  for (let i = 0; i < F.team.length; i++) { if (F.team[i] === 0) { t0++; if (F.alive[i] === 1) t0alive++; } }
  if (t0 > 0) INFO('frames.team === 0 的语义线索', `出现 ${t0} 次（${((t0 / F.team.length) * 100).toFixed(1)}%），其中 alive=1 的有 ${t0alive} 个 → 是「该回合未参与的玩家」`);

  // yaw 归一化区间
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < F.yaw.length; i++) { if (F.yaw[i] < mn) mn = F.yaw[i]; if (F.yaw[i] > mx) mx = F.yaw[i]; }
  INFO('§3.4 yaw 的归一化区间', `[${mn}, ${mx}] → 归一化到 ${mn < -90 ? '(-180, 180]' : '未知'}`);

  // accuracyPenalty
  let hasData = 0, illegal = 0;
  for (let i = 0; i < F.accuracyPenalty.length; i++) { const v = F.accuracyPenalty[i]; if (v === -1) continue; hasData++; if (!(v >= 0)) illegal++; }
  illegal === 0 ? PASS('§3.2 frames.accuracyPenalty = -1 或 ≥0', `有数据 ${hasData} 个`) : FAIL('§3.2 frames.accuracyPenalty 含非法值', String(illegal));
}

// ═══ 5. meta / manifest ═══
{
  META.tickRate === 64 ? PASS('§2 meta.tickRate == 64', '') : FAIL('§2 meta.tickRate 不是 64', String(META.tickRate));
  META.sampleRate === RATE ? PASS('§2 meta.sampleRate 反映请求值', String(RATE)) : INFO('§2 meta.sampleRate', `${META.sampleRate}（请求 ${RATE}）`);
  INFO('§2 data.meta 全部字段', Object.keys(META).join(', '));
  INFO('data 顶层字段', Object.keys(data).join(', '));
  if (manifest) {
    const ks = Object.keys(manifest);
    INFO('§1 manifest 字段', ks.join(', '));
    ['mapName', 'tickRate', 'startTick', 'endTick', 'durationSeconds', 'rounds'].every((k) => k in manifest)
      ? PASS('§1 manifest 含 docs/07 列出的全部字段', '')
      : FAIL('§1 manifest 缺字段', ['mapName', 'tickRate', 'startTick', 'endTick', 'durationSeconds', 'rounds'].filter((k) => !(k in manifest)).join(','));
  }
}

// ═══ 6. players / 死字段 / rounds ═══
{
  const p0 = data.players[0];
  INFO('§5 players[] 实际字段', Object.keys(p0).join(', '));
  typeof p0.steamId === 'string'
    ? PASS('§5 players[].steamId 是字符串', `如 "${p0.steamId}"`)
    : FAIL('§5 players[].steamId 不是字符串', typeof p0.steamId);
  if (data.players.every((p) => !('team' in p))) {
    INFO('§5 players[] 没有 team 字段', '队伍信息只在 frames.team / panelFrames.team 里 —— docs/07 需注明');
  }
  const noClan = data.players.filter((p) => p.clanName === undefined || p.clanName === null).length;
  if (noClan > 0) INFO('§5 players[].clanName 是可选字段', `${noClan}/${data.players.length} 人没有 clanName`);
  INFO('§5 players[].color 取值', [...new Set(data.players.map((p) => p.color))].join(', '));

  // equipValue（docs/07 认定为死字段）
  let nz = 0;
  for (let i = 0; i < P.equipValue.length; i++) if (P.equipValue[i] !== 0) nz++;
  nz > 0
    ? PASS('§4 panelFrames.equipValue 确实被填充（印证「只写不读」）', `${nz}/${P.equipValue.length} 非零`)
    : FAIL('§4 panelFrames.equipValue 全为 0', '');

  // rounds 字段
  INFO('§6 rounds[] 实际字段', Object.keys(data.rounds[0]).join(', '));
  if (!('index' in data.rounds[0])) FAIL('§6 rounds[] 缺 index 字段（docs/07 未列）', '');
  else PASS('§6 rounds[].index 存在', 'docs/07 §6 需补这一字段');

  // panelFrames.numFrames 是标量
  if (typeof P.numFrames === 'number' && !('numFrames' in F)) {
    INFO('§4 panelFrames.numFrames 是标量字段', `${P.numFrames}；frames 没有对应字段（用 frameTick.length）—— docs/07 需注明这个不对称`);
  }

  // weaponNames 第 0 项
  if (data.weaponNames[0] === '') INFO('§4 weaponNames[0] 是空字符串', 'activeWeapon 索引到 0 时会取到空串 —— docs/07 需注明');
  INFO('§4 weaponNames 数量与样例', `${data.weaponNames.length}：${data.weaponNames.slice(0, 8).join(' / ')}`);

  INFO('各集合规模', JSON.stringify({
    events: data.events?.length, rounds: data.rounds?.length,
    grenadeTrajectories: data.grenades?.trajectories?.length, tracers: data.tracers?.count,
    damage: data.damage?.length, deathMarkers: data.deathMarkers?.length,
    droppedWeapons: data.droppedWeapons?.length, mapEntities: data.mapEntities?.length,
    deathRagdolls: data.deathRagdolls?.length, timeouts: data.timeouts?.length,
  }));
}

// ═══ 7. 速度两列（src/deobfuscated/speed-columns.js）═══
{
  const tS = Date.now();
  computeSpeedColumns(data);
  INFO('§3.5 computeSpeedColumns 全量耗时', (Date.now() - tS) + ' ms');
  const N0 = F.frameTick.length, TR0 = META.tickRate, SR0 = META.sampleRate;
  F.speed && F.speed.length === N0 * NP ? PASS('§3.5 frames.speed 长度 = N×P', String(N0 * NP)) : FAIL('§3.5 frames.speed 长度不对', F.speed ? String(F.speed.length) : '缺失');
  F.smoothSpeed && F.smoothSpeed.length === N0 * NP ? PASS('§3.5 frames.smoothSpeed 长度 = N×P', String(N0 * NP)) : FAIL('§3.5 frames.smoothSpeed 长度不对', F.smoothSpeed ? String(F.smoothSpeed.length) : '缺失');

  // 原渲染层算法 A（bg.sample 的守卫式）
  const origA = (i, p) => {
    const a = i, o = Math.min(a + 1, N0 - 1), f = a === o ? Math.max(0, a - 1) : a, q = o;
    const g = (F.frameTick[q] - F.frameTick[f]) / TR0;
    const ok = g > 0 && g <= 2 / SR0 && !data.rounds.some((r) => r.startTick > F.frameTick[f] && r.startTick <= F.frameTick[q]);
    const i1 = f * NP + p, i2 = q * NP + p;
    return ok && F.alive[i1] === 1 && F.alive[i2] === 1 && F.team[i1] === F.team[i2]
      ? Math.hypot(F.posX[i2] - F.posX[i1], F.posY[i2] - F.posY[i1]) / g : 0;
  };
  // 原渲染层算法 B（jC → FC → IC）
  const fC0 = 0.1, mC0 = 600, pC0 = 0.25;
  const IC0 = (x, tau) => { const n = x / tau; return 1 - (1 + n) * Math.exp(-n); };
  const bf0 = (arr, tv) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const md = (lo + hi) >> 1; if (arr[md] <= tv) { r = md; lo = md + 1; } else hi = md - 1; } return r; };
  const origB = (tick, slot) => {
    const s = F.frameTick, L2 = s.length; if (L2 < 2) return 0;
    const u = 10 * fC0; let dd = 0;
    for (let e = Math.min(bf0(s, tick), L2 - 2); e >= 0; e--) {
      const lo = Math.max(0, (tick - s[e + 1]) / TR0); if (lo >= u) break;
      const hi = Math.min(u, (tick - s[e]) / TR0); if (hi <= lo) continue;
      const pi = e * NP + slot, qi = pi + NP, h = (s[e + 1] - s[e]) / TR0;
      if (h <= 0 || h > pC0 || F.alive[pi] !== 1 || F.alive[qi] !== 1) continue;
      const v = Math.hypot(F.posX[qi] - F.posX[pi], F.posY[qi] - F.posY[pi]) / h;
      dd += (v > mC0 ? 0 : v) * (IC0(hi, fC0) - IC0(lo, fC0));
    }
    return dd / IC0(u, fC0);
  };
  let maxA = 0, maxB = 0, badA = 0, badB = 0, cnt = 0;
  for (let i = 0; i < N0; i++) for (let p = 0; p < NP; p++) {
    cnt++;
    const dA = Math.abs(origA(i, p) - F.speed[i * NP + p]); if (dA > maxA) maxA = dA; if (dA > 1e-3) badA++;
    const dB = Math.abs(origB(F.frameTick[i], p) - F.smoothSpeed[i * NP + p]); if (dB > maxB) maxB = dB; if (dB > 1e-3) badB++;
  }
  badA === 0 ? PASS('§3.5 speed 与原 bg.sample() 逐值一致', `${cnt} 个样本，最大偏差 ${maxA.toExponential(2)}`) : FAIL('§3.5 speed 与原算法有偏差', `${badA} 个超 1e-3，最大 ${maxA}`);
  badB === 0 ? PASS('§3.5 smoothSpeed 与原 jC() 逐值一致', `${cnt} 个样本，最大偏差 ${maxB.toExponential(2)}`) : FAIL('§3.5 smoothSpeed 与原算法有偏差', `${badB} 个超 1e-3，最大 ${maxB}`);

  // equipValue 已从契约剔除（原 worker 仍会产，由 patched worker 去掉）
  INFO('§4 equipValue 状态', '已从契约与 csdf-format 移除；原 worker 仍产，src/deobfuscated/parser.worker.deobf.js 已去掉');
}

// ── 输出 ──
const width = Math.max(...out.map((o) => o[1].length));
for (const [s, l, dd] of out) console.log(`[${s}] ${l.padEnd(width)}  ${dd}`);
const fails = out.filter((o) => o[0] === 'FAIL');
const passes = out.filter((o) => o[0] === 'PASS');
console.log(`\n${'─'.repeat(70)}`);
console.log(`PASS ${passes.length}  FAIL ${fails.length}  INFO ${out.length - passes.length - fails.length}`);
fs.mkdirSync(R('tmp'), { recursive: true });
fs.writeFileSync(R('tmp/contract-validation.txt'), out.map(([s, l, d]) => `[${s}] ${l}  ${d}`).join('\n'), 'utf8');
console.log('明细已写入 tmp/contract-validation.txt');
process.exitCode = fails.length ? 1 : 0;
