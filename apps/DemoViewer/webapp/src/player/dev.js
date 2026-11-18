// =============================================================================
// player/dev.js —— 开发调试入口（仅 dev 构建挂载）
//
// 控制台调用：
//   __playerDev.open()                打开 3D 视口（空场景，可操作相机）
//   __playerDev.loadMap('de_mirage')  加载地图（v1 分类管线 + CS2 环境）
//   __playerDev.loadCs2Map('de_nuke') 加载地图（CS2 完整渲染管线）
// 生产播放流程走 main.js → player/world.js；本文件只做调试包装。
// =============================================================================
import { openWorld, worldApi } from './world.js';
import { decode, encode } from '@msgpack/msgpack';
import { getClient } from '../iobject.js';
import { openPlaybackFeed } from '../playback-feed.js';

let useCs2Environment = true; // 原版默认：桌面 GPU 走 CS2 模式（环境接管）
let world = null;
let playbackNode = null;

/** 拿 IObject Playback 节点（懒获取，桥未连好会抛错） */
async function playback() {
  if (!playbackNode) {
    const client = getClient();
    if (!client) throw Error('IObject 未连接');
    playbackNode = await client.root.getChildItem('Playback');
  }
  return playbackNode;
}

export function installPlayerDev() {
  window.__playerDev = {
    open() {
      world ??= openWorld();
      return world.player;
    },

    /** v1 分类管线（collision GLB → worker 着色），环境优先 CS2 manifest */
    async loadMap(name = 'de_mirage') {
      world ??= openWorld();
      return world.load(name, { engine: 'v1', cs2Environment: useCs2Environment });
    },

    /** CS2 完整管线：几何 chunk + BCn 纹理 + 烘焙光照 + 探针 + 天空 + PVS + LUT */
    async loadCs2Map(name = 'de_mirage') {
      world ??= openWorld();
      const info = await world.load(name, { engine: 'cs2' });
      window.__cs2 = world.cs2; // 调试
      return info;
    },

    /** 调自由视角旋转灵敏度（1.0 = 原版默认） */
    setSensitivity(x = 1) {
      if (!world) return '视口未打开';
      world.player.camera.controls.rotateSpeed = x;
      return `rotateSpeed = ${x}`;
    },

    /** CS2 门/可动物体时间线（M2 demo 回放调用）：records = demo 物体轨迹 */
    cs2UpdateObjects(records, tick) {
      const cs2 = world?.cs2;
      if (!cs2) return 'CS2 地图未加载';
      cs2.updateObjects(records, tick);
      return `objects @tick ${tick}`;
    },

    /** CS2 环境开关（true = manifest 接管雾/天空/曝光；false = 分类表环境） */
    useCs2Env(v = true) {
      useCs2Environment = v;
      return `useCs2Environment = ${v}（下次 loadMap 生效）`;
    },

    /** 播放控制（P0 验证 / P1 起持续使用）：play/pause/seek/speed/state */
    async play() {
      const n = await playback();
      await n.invoke('Play', new Uint8Array(0));
      return decode(await n.readData('state'));
    },
    async pause() {
      const n = await playback();
      await n.invoke('Pause', new Uint8Array(0));
      return decode(await n.readData('state'));
    },
    async seek(tick) {
      const n = await playback();
      await n.invoke('Seek', encode(Number(tick) >>> 0));
      return decode(await n.readData('state'));
    },
    async speed(x = 1) {
      const n = await playback();
      await n.invoke('SetSpeed', encode(Number(x)));
      return decode(await n.readData('state'));
    },
    async state() {
      return decode(await (await playback()).readData('state'));
    },
    /** 观察 tick 推进：每 200ms 采样一次 state，持续 ms 毫秒（默认 2000） */
    async watchState(ms = 2000) {
      const samples = [];
      const n = await playback();
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        const s = decode(await n.readData('state'));
        samples.push(`${s.currentTick}${s.playing ? '▶' : '⏸'}`);
        await new Promise((r) => setTimeout(r, 200));
      }
      return samples;
    },

    /**
     * P1 探针（修正版）：先订阅节拍，后播放——验证桥把 Playback 的
     * DataChannelChanged("state") 事件转发到前端（event.data 应为 state 快照）。
     */
    async probeBeats(ms = 2000) {
      const n = await playback();
      window.__beatCount = 0;
      const beatSamples = [];
      const cancel = await n.subscribe('DataChannelChanged', (event) => {
        window.__beatCount++;
        if (beatSamples.length < 3) {
          beatSamples.push({
            channel: event.channel,
            hasData: !!event.data,
            state: event.data ? decode(event.data) : null,
          });
        }
      });
      await this.play();
      await new Promise((r) => setTimeout(r, ms));
      await this.pause();
      cancel.cancel();
      return JSON.stringify({
        beats: window.__beatCount,
        samples: beatSamples,
      });
    },

    /** 直接拉一次当前快照（不经节拍） */
    async snapshot() {
      const w = await getClient().root.getChildItem('World');
      return decode(await w.readData('snapshot'));
    },

    /**
     * P1 数据流验证：打开 feed → seek 起点并播放 ms 毫秒 → 返回回调统计。
     * window.__feedSnaps 保留最近 3 帧快照供检查。
     */
    async feedTest(ms = 2000) {
      const d = window.__playerDev;
      const snaps = [];
      const close = await openPlaybackFeed((snap, state) => {
        snaps.push({ tick: snap.tick, n: snap.players.length, playing: state.playing });
        window.__feedSnaps = snaps.slice(-3);
      });
      try {
        await d.pause();
        await d.seek(30000);
        await d.play();
        await new Promise((r) => setTimeout(r, ms));
      } finally {
        await d.pause();
        close();
      }
      const last = await d.snapshot();
      return JSON.stringify({
        callbacks: snaps.length,
        distinctTicks: new Set(snaps.map((s) => s.tick)).size,
        first: snaps[0],
        last,
        lastPlayer0: last.players[0]
          ? { name: last.players[0].name, pos: last.players[0].pos, alive: last.players[0].alive, weapon: last.players[0].weapon }
          : null,
      });
    },

    get instance() {
      return worldApi.player; // 永远指向 world.js 单例（main.js 与本模块共用）
    },
    get world() {
      return worldApi; // 与 main.js 的 world 引用同源
    },
  };
}
