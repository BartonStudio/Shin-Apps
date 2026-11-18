// =============================================================================
// watch-hud.js —— 观看页动态 HUD + 控制条（P3）
//
// 三块职责，数据全部来自 playback-feed 的快照（每拍拉取，无需独立订阅）：
//   1. scorebar：比分（快照 score，按当前 tick 截算）、回合号与剩余时间
//      （快照 round：冻结期显示满 live 时长，live 阶段倒数）、地图名
//   2. killfeed：快照 recentKills（id 形式）+ 玩家映射还原名字，双方按队伍上色
//   3. controlbar：播放/暂停切换、倍速循环、进度条点击/拖拽 Seek、已播进度条
//
// Playback 命令走 IObject Invoke（Play/Pause/SetSpeed/Seek），与 P0 时钟同源。
// =============================================================================

import { decode, encode } from '@msgpack/msgpack';
import { getClient, initIObjectBridge } from './iobject.js';

const SPEED_STEPS = [1, 2, 4, 0.5];
const TICKRATE = 64;          // 与 native 时钟一致（demo 固定 64）
const ROUND_TIME_SEC = 115;   // CS2 竞技回合时长 1:55（demo 事件无此字段，按规则写死）
const KILLFEED_ROWS = 5;

let playbackNode = null;
async function playback() {
  if (!playbackNode) {
    await initIObjectBridge();
    const client = getClient();
    if (!client) throw Error('IObject 未连接');
    playbackNode = await client.root.getChildItem('Playback');
  }
  return playbackNode;
}

async function readState(node) {
  try {
    return decode(await node.readData('state'));
  } catch {
    return null;
  }
}

function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const TEAM_COLOR = { 1: 'var(--ct)', 2: 'var(--t)' };

// 武器显示名（native WeaponName 目录还原）→ 图标文件名。
// 图标库：原 csdemo.tv 的 /icons/weapons/*.svg（已镜像到 webapp/public/icons/weapons/）。
// 映射表源自原版逆向（web/src/deobfuscated/06-world-props.deobf.js WEAPON_DISPLAY_TO_ICON），
// 刀类图标本地只有 5 个，统一 fallback 到 knife。
const WEAPON_ICON = {
  'AK-47': 'ak47', 'M4A4': 'm4a1', 'M4A1-S': 'm4a1_silencer', 'AWP': 'awp',
  'SSG 08': 'ssg08', 'FAMAS': 'famas', 'Galil AR': 'galilar', 'AUG': 'aug',
  'SG 553': 'sg556', 'MAC-10': 'mac10', 'MP9': 'mp9', 'MP7': 'mp7',
  'MP5-SD': 'mp5sd', 'PP-Bizon': 'bizon', 'P90': 'p90', 'UMP-45': 'ump45',
  'Desert Eagle': 'deagle', 'Glock-18': 'glock', 'USP-S': 'usp_silencer',
  'P2000': 'hkp2000', 'P250': 'p250', 'Five-SeveN': 'fiveseven',
  'Tec-9': 'tec9', 'CZ75-Auto': 'cz75a', 'Dual Berettas': 'elite',
  'R8 Revolver': 'revolver', 'M249': 'm249', 'Negev': 'negev', 'Nova': 'nova',
  'XM1014': 'xm1014', 'MAG-7': 'mag7', 'MAG7': 'mag7', 'Sawed-Off': 'sawedoff',
  'SCAR-20': 'scar20', 'SCAR20': 'scar20', 'G3SG1': 'g3sg1',
  'Zeus x27': 'taser', 'Taser': 'taser',
  'High Explosive Grenade': 'hegrenade', 'Flashbang': 'flashbang',
  'Smoke Grenade': 'smokegrenade', 'Molotov': 'molotov',
  'Incendiary Grenade': 'incgrenade', 'Decoy Grenade': 'decoy',
  'C4 Explosive': 'c4', 'Healthshot': 'healthshot',
};

// 本地图标库文件名集合（webapp/public/icons/weapons/，原 csdemo.tv 资源）
const ICON_FILES = new Set([
  'ak47', 'armor', 'armor_helmet', 'aug', 'awp', 'bizon', 'blind_kill', 'c4',
  'crosshair', 'cz75a', 'deagle', 'decoy', 'defuser', 'elite', 'famas',
  'fiveseven', 'flashbang', 'g3sg1', 'galilar', 'glock', 'headshot',
  'healthshot', 'hegrenade', 'hkp2000', 'incgrenade', 'knife', 'knife_bowie',
  'knife_gypsy_jackknife', 'knife_m9_bayonet', 'knife_t', 'm249', 'm4a1',
  'm4a1_silencer', 'mac10', 'mag7', 'molotov', 'mp5sd', 'mp7', 'mp9', 'negev',
  'noscope', 'nova', 'p250', 'p90', 'penetrate', 'revolver', 'sawedoff',
  'scar20', 'sg556', 'skull', 'smokegrenade', 'smoke_kill', 'ssg08', 'taser',
  'tec9', 'ump45', 'usp_silencer', 'xm1014',
]);

/**
 * 武器名 → 图标文件名（无匹配返回 null；刀统一用 knife.svg）。
 * 兼容两种输入：显示名（快照 players[].weapon，如 "AK-47"）与
 * 内部名（快照 recentKills[].weapon，如 "ak47"、"m4a1_txz03"——带皮肤后缀）。
 */
function weaponIcon(name) {
  if (!name) return null;
  const n = String(name);
  if (/Knife|Bayonet|Karambit|Daggers/i.test(n) || /^knife/.test(n)) return 'knife';
  if (WEAPON_ICON[n]) return WEAPON_ICON[n];
  const stripped = n.replace(/^weapon_/, '');
  if (ICON_FILES.has(stripped)) return stripped;
  const base = stripped.split('_')[0]; // 去皮肤后缀：m4a1_txz03 → m4a1
  if (WEAPON_ICON[base]) return WEAPON_ICON[base];
  return ICON_FILES.has(base) ? base : null;
}

/** 创建 HUD 控制器。update(snap, state) 由 playback-feed 每拍驱动。 */
export function createWatchHud() {
  const $ = (sel) => document.querySelector(sel);
  const els = {
    numT: $('.scorebar__num--t'),
    numCT: $('.scorebar__num--ct'),
    map: $('.scorebar__map'),
    timer: $('.scorebar__timer'),
    round: $('.scorebar__round'),
    killfeed: $('.killfeed'),
    rosterT: $('.watch-roster--t'),
    rosterCT: $('.watch-roster--ct'),
    timeline: $('.controlbar__timeline'),
    played: $('.controlbar__played'),
    play: $('.controlbar__play'),
    speed: $('.controlbar__speed'),
    pov: $('.controlbar__pov'),
  };

  let speedIndex = 0;
  let scrubbing = false;    // 拖拽进度条期间暂停覆盖 played 宽度
  let lastMaxTick = 0;
  let lastPlaying = null;
  let rosterKey = '';       // 名册结构指纹（id/team/teamSlot），换边或人数变化才重建 DOM
  let rosterCards = new Map(); // id -> { card, nameEl, hpFill, armorFill }

  // ------------------------------------------------------------- 名册（左右面板）

  const CARD_HTML =
    '<span class="player-card__bar"></span>' +
    '<span class="player-card__name"></span>' +
    '<img class="player-card__weapon" alt="">' +
    '<span class="player-card__hp"><span class="player-card__hp-fill"></span></span>' +
    '<span class="player-card__armor"><span class="player-card__armor-fill"></span></span>' +
    '<span class="player-card__util"></span><span class="player-card__util"></span>';

  function rebuildRoster(snap) {
    rosterCards = new Map();
    els.rosterT.innerHTML = '';
    els.rosterCT.innerHTML = '';
    const sideOf = (team) => (team === 2 ? 't' : team === 1 ? 'ct' : null); // Team 枚举：None=0 CT=1 T=2
    const players = [...snap.players].sort((a, b) =>
      (a.team - b.team) || (a.teamSlot - b.teamSlot)); // T 侧在前、各按 slot 升序
    for (const p of players) {
      const side = sideOf(p.team);
      if (!side) continue;
      const card = document.createElement('div');
      card.className = `player-card player-card--${side}`;
      card.innerHTML = CARD_HTML;
      (side === 't' ? els.rosterT : els.rosterCT).appendChild(card);
      rosterCards.set(p.id, {
        card,
        nameEl: card.querySelector('.player-card__name'),
        weaponEl: card.querySelector('.player-card__weapon'),
        hpFill: card.querySelector('.player-card__hp-fill'),
        armorFill: card.querySelector('.player-card__armor-fill'),
      });
    }
  }

  function updateRoster(snap) {
    if (!snap.players || snap.players.length === 0) {
      if (rosterKey) { els.rosterT.innerHTML = ''; els.rosterCT.innerHTML = ''; rosterKey = ''; rosterCards = new Map(); }
      return;
    }
    // 换边（上下半场）/人数变化 → 重建；否则只刷新数值
    const key = snap.players.map((p) => `${p.id}:${p.team}:${p.teamSlot}`).join('|');
    if (key !== rosterKey) {
      rosterKey = key;
      rebuildRoster(snap);
    }
    const clamp01 = (v) => Math.max(0, Math.min(1, v / 100));
    for (const p of snap.players) {
      const c = rosterCards.get(p.id);
      if (!c) continue;
      c.nameEl.textContent = p.name || `PLAYER ${p.id}`;
      // hover 详情：id / 队伍槽位 / 武器 / 经济（道具数在 P4 实体层接入后补）
      c.nameEl.title = `id:${p.id} slot:${p.teamSlot} ${p.weapon || '—'} $${p.money ?? '?'}`;
      // 当前武器图标（本地武器 SVG 库）
      const icon = weaponIcon(p.weapon);
      if (icon) {
        c.weaponEl.src = `/icons/weapons/${icon}.svg`;
        c.weaponEl.title = p.weapon;
        c.weaponEl.style.display = '';
      } else {
        c.weaponEl.style.display = 'none';
      }
      const dead = !p.alive || p.health <= 0;
      c.card.classList.toggle('player-card--dead', dead);
      c.hpFill.style.transform = `scaleX(${dead ? 0 : clamp01(p.health)})`;
      c.armorFill.style.transform = `scaleX(${dead ? 0 : clamp01(p.armor)})`;
    }
  }

  // ---------------------------------------------------------------- HUD 更新

  function updateTimer(snap) {
    const r = snap.round;
    if (!r) {
      els.timer.textContent = '0:00';
      els.round.textContent = 'ROUND —';
      return;
    }
    const tick = snap.tick;
    const liveStart = r.liveStartTick;
    const liveEnd = r.liveEndTick || 0;
    let remain;
    if (tick < liveStart) {
      // 准备阶段（冻结）：准备倒计时
      remain = (liveStart - tick) / TICKRATE;
    } else if (!liveEnd || tick < liveEnd) {
      // 开打阶段：1:55 回合倒计时（liveEnd 缺失时按满时长倒数）
      remain = ROUND_TIME_SEC - (tick - liveStart) / TICKRATE;
    } else {
      // 结算阶段（round_end 之后）：归零
      remain = 0;
    }
    els.timer.textContent = fmtClock(remain);
    els.round.textContent = `ROUND ${r.index + 1}`;
  }

  function updateKillfeed(snap) {
    const nameOf = new Map(snap.players.map((p) => [p.id, p]));
    const rows = [];
    for (const k of snap.recentKills.slice(-KILLFEED_ROWS).reverse()) {
      const killer = nameOf.get(k.killer);
      const victim = nameOf.get(k.victim);
      const wIcon = weaponIcon(k.weapon);
      const weapon = wIcon
        ? `<img class="killfeed__weapon" src="/icons/weapons/${wIcon}.svg" alt="${escapeHtml(k.weapon ?? '')}" title="${escapeHtml(k.weapon ?? '')}">`
        : `<span class="killfeed__weapon" title="${escapeHtml(k.weapon ?? '')}"></span>`;
      const hs = k.headshot ? '<span class="killfeed__headshot"></span>' : '';
      const kName = killer ? killer.name || `PLAYER${k.killer}` : `PLAYER${k.killer}`;
      const vName = victim ? victim.name || `PLAYER${k.victim}` : `PLAYER${k.victim}`;
      const kColor = killer ? TEAM_COLOR[killer.team] ?? '' : '';
      const vColor = victim ? TEAM_COLOR[victim.team] ?? '' : '';
      rows.push(
        `<div class="killfeed__row">` +
          `<span class="killfeed__attacker" style="${kColor ? `color:${kColor}` : ''}">${escapeHtml(kName)}</span>` +
          weapon + hs +
          `<span class="killfeed__victim" style="${vColor ? `color:${vColor}` : ''}">${escapeHtml(vName)}</span>` +
        `</div>`
      );
    }
    // 空 feed（本回合无人死亡）时留白，不显示旧占位
    els.killfeed.innerHTML = rows.join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function updateProgress(snap) {
    lastMaxTick = snap.maxTick || lastMaxTick;
    if (scrubbing || !lastMaxTick) return;
    els.played.style.width = `${Math.min(100, (snap.tick / lastMaxTick) * 100)}%`;
  }

  function updatePlayIcon(state) {
    const playing = state ? state.playing : lastPlaying;
    if (playing === null || playing === undefined) return;
    lastPlaying = playing;
    els.play.textContent = playing ? '⏸' : '▶';
  }

  /** feed 每拍调用 */
  function update(snap, state) {
    if (snap.score) {
      els.numT.textContent = snap.score.t;
      els.numCT.textContent = snap.score.ct;
    }
    updateTimer(snap);
    updateRoster(snap);
    updateKillfeed(snap);
    updateProgress(snap);
    updatePlayIcon(state);
  }

  // ------------------------------------------------------------- 控制条交互

  /** 进入观看界面即播放（直接 Play，不切换）。 */
  async function play() {
    const node = await playback();
    await node.invoke('Play', new Uint8Array(0));
  }

  async function togglePlay() {
    const node = await playback();
    const state = await readState(node);
    const next = !(state?.playing ?? false);
    await node.invoke(next ? 'Play' : 'Pause', new Uint8Array(0));
    // 以 native 实际状态为准刷新（避免与 feed 的状态读回竞态时图标闪回）
    updatePlayIcon((await readState(node)) ?? { playing: next });
  }

  async function cycleSpeed() {
    speedIndex = (speedIndex + 1) % SPEED_STEPS.length;
    const x = SPEED_STEPS[speedIndex];
    const node = await playback();
    await node.invoke('SetSpeed', encode(x));
    els.speed.textContent = `${x}X`;
  }

  function seekToRatio(ratio) {
    if (!lastMaxTick) return;
    const tick = Math.max(0, Math.min(lastMaxTick, Math.round(ratio * lastMaxTick)));
    els.played.style.width = `${ratio * 100}%`;
    playback().then((n) => n.invoke('Seek', encode(tick >>> 0)));
  }

  function bindTimeline() {
    const ratioOf = (e) => {
      const rect = els.timeline.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    };
    els.timeline.addEventListener('pointerdown', (e) => {
      scrubbing = true;
      try { els.timeline.setPointerCapture(e.pointerId); } catch { /* 合成事件无有效 pointerId */ }
      els.played.style.width = `${ratioOf(e) * 100}%`;
    });
    els.timeline.addEventListener('pointermove', (e) => {
      if (!scrubbing) return;
      els.played.style.width = `${ratioOf(e) * 100}%`;
    });
    const finish = (e) => {
      if (!scrubbing) return;
      scrubbing = false;
      seekToRatio(ratioOf(e));
    };
    els.timeline.addEventListener('pointerup', finish);
    els.timeline.addEventListener('pointercancel', finish);
  }

  function bindControls() {
    els.play.addEventListener('click', () => togglePlay().catch((err) => console.warn('[hud] play 失败:', err.message)));
    els.speed.addEventListener('click', () => cycleSpeed().catch((err) => console.warn('[hud] speed 失败:', err.message)));
    bindTimeline();
  }

  /** 地图名（进观看页时设置一次）：de_dust2 → DUST2 */
  function setMapName(mapName) {
    if (!mapName) return;
    els.map.textContent = mapName.replace(/^de_/i, '').toUpperCase();
  }

  return { update, bindControls, setMapName, play };
}
