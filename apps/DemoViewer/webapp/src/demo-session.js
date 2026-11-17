// =============================================================================
// demo-session.js —— demo 装载会话（前端 → IObject 对象树）
//
// 对照 native 协议（apps/DemoViewer/native/cs2/DemoLoaderNode.hpp）：
//   Root/Loader   Invoke("Load", path)               开始后台解析（msgpack string）
//                 ReadData("progress") → {stage, percent, done, failed, error, mapName, maxTick, fileSize}
//                 ReadData("meta")     → {mapName, maxTick, durationSec, fileSize}
//   Root/Scoreboard ReadData("rows")    → {ct:[{name,kills,deaths,assists,adr,money,alive}], t:[…]}
//                   ReadData("summary") → {ct, t, rounds, total, mapName, maxTick}
//   Root/World    Invoke("InitializePlayers")        解析完成后装配玩家节点
//
// 通道载荷是 C++ 侧 EncodeMsgPack 的 MessagePack，这里用 @msgpack/msgpack 解码。
// =============================================================================
import { decode, encode } from '@msgpack/msgpack';
import { getClient, initIObjectBridge } from './iobject.js';

const POLL_MS = 200;
const LOAD_TIMEOUT_MS = 120_000;

async function node(name) {
  await initIObjectBridge();
  const client = getClient();
  if (!client) throw Error('IObject 未连接');
  return client.root.getChildItem(name);
}

async function readJson(nodeObj, channel) {
  const bytes = await nodeObj.readData(channel);
  return decode(bytes);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 装载一个 demo 并返回真实元信息 + 战绩数据。
 * @param {string} path demo 绝对路径（native 侧读取）
 * @param {(p: {stage:string, percent:number, mapName:string}) => void} [onProgress]
 * @returns {Promise<{meta: object, rows: object, summary: object}>}
 */
export async function loadDemoSession(path, onProgress) {
  const loader = await node('Loader');
  await loader.invoke('Load', encode(path));

  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  let progress = null;
  for (;;) {
    progress = await readJson(loader, 'progress');
    onProgress?.(progress);
    if (progress.done) break;
    if (progress.failed) throw Error(progress.error || 'demo 解析失败');
    if (Date.now() > deadline) throw Error('demo 解析超时');
    await sleep(POLL_MS);
  }

  // done 与 meta 之间有极小窗口（worker 写 meta / 置 done 的可见性），
  // 读不到 mapName 就短等重试；仍为空则用 progress / summary 兜底。
  let meta = await readJson(loader, 'meta');
  for (let i = 0; i < 10 && !meta.mapName; i++) {
    await sleep(150);
    meta = await readJson(loader, 'meta');
  }
  if (!meta.mapName && progress?.mapName) {
    meta = {
      mapName: progress.mapName,
      maxTick: progress.maxTick,
      fileSize: progress.fileSize,
      durationSec: progress.maxTick / 64,
    };
  }

  // 解析完成 → 按装配顺序初始化玩家节点（POV 等消费方需要）
  try {
    const world = await node('World');
    await world.invoke('InitializePlayers', new Uint8Array(0));
  } catch (err) {
    console.warn('[demo] InitializePlayers 失败:', err.message);
  }

  const scoreboard = await node('Scoreboard');
  // final = 末 tick 整场统计（战绩卡片）；summary = 回合比分
  const [rows, summary] = await Promise.all([readJson(scoreboard, 'final'), readJson(scoreboard, 'summary')]);

  if (!meta.mapName && summary?.mapName) {
    meta = { mapName: summary.mapName, maxTick: summary.maxTick, fileSize: meta.fileSize, durationSec: summary.maxTick / 64 };
  }
  return { meta, rows, summary };
}
