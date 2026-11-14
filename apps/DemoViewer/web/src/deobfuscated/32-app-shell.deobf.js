// ─────────────────────────────────────────────────────────────────────────────
// 32-app-shell.deobf.js — 托管 demo 下载 + AppShell 骨架 + 地图统计 + 目录菜单
//
// 来源：src/app/32-app-shell.js（Vite 生产构建，prettier 展开版）
// 原始压缩名：YI = HostedDemoLoadError，XI = loadHostedDemo，ML = createAppShell，
//             QL = createHostedDemoMenu，RL = fetchMapStatistics，等
//
// 本文件包含：
//   1. loadHostedDemo（XI）—— 下载托管 demo（fetch + 流式读取 + sha256 校验 + 解码 + map 校验）。
//   2. 团队身份识别（rL）—— 把录制 demo 里的 clanName 匹配到目录里的队伍身份。
//   3. IndexedDB 缓存层（uL/dL/fL/pL/mL/hL/gL）—— 本地解析结果的持久化。
//   4. parser worker 桥接（yL）—— 把 .dem 文件交给 web worker 解析。
//   5. 最近场次（recents）的 localStorage 管理。
//   6. AppShell（ML）—— 落地页/播放页的 DOM 骨架 + 拖拽上传 + 加载进度 UI。
//   7. 地图统计（RL/zL）—— 下载并严格校验地图统计 JSON。
//   8. 托管目录菜单（QL 及一系列渲染函数）—— 事件/比赛/地图/片段选择器。
//   9. 落地页背景 clip（CSBG 格式）解码器。
//
// 说明：标识符已重命名成语义化名字，局部单字母变量展开，关键逻辑补注释。
//       未改任何语义。
// ─────────────────────────────────────────────────────────────────────────────

// ── 托管 demo 加载 ─────────────────────────────────────────────────────────────

/** 托管 demo 加载失败（区别于本地解析失败） */
class HostedDemoLoadError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'HostedDemoLoadError';
  }
}

/**
 * 下载并解码一个托管 demo。
 *
 * @param {object} entry 目录条目（含 artifactUrl / artifactSha256 / mapName）
 * @param {{signal?: AbortSignal, onProgress?: Function}} options
 * @returns {Promise<{data, manifest, byteLength}>}
 */
async function loadHostedDemo(entry, options = {}) {
  const { signal, onProgress } = options;
  signal?.throwIfAborted();

  let response;
  try {
    response = await fetch(entry.artifactUrl, { signal });
  } catch (err) {
    throw isAbortError(err) ? err : new HostedDemoLoadError('The hosted demo could not be downloaded.', { cause: err });
  }
  if (!response.ok) {
    throw new HostedDemoLoadError(`The hosted demo is unavailable (${response.status} ${response.statusText || 'HTTP error'}).`);
  }

  const totalBytes = parseContentLength(response.headers.get('Content-Length'));
  const bytes = await readResponseBody(response, signal, totalBytes, onProgress);
  signal?.throwIfAborted();

  const digest = await hashBytesToHex(bytes);
  signal?.throwIfAborted();
  if (digest !== entry.artifactSha256) {
    throw new HostedDemoLoadError('The hosted demo does not match its catalogue checksum.');
  }

  let decoded;
  try {
    decoded = await decodeArtifact(bytes);
  } catch (err) {
    if (err instanceof DecodeError) {
      throw new HostedDemoLoadError(
        /DecompressionStream is unavailable/i.test(err.message)
          ? 'This browser cannot decompress hosted demos. Update your browser and try again.'
          : /unsupported|version/i.test(err.message)
            ? 'This hosted demo uses an unsupported artifact version.'
            : 'This hosted demo is corrupt or failed its integrity checks.',
        { cause: err },
      );
    }
    throw err;
  }

  signal?.throwIfAborted();
  // 校验 map 名一致（忽略 de_ 前缀、大小写、空格/下划线差异）
  if (
    !mapNamesEqual(decoded.manifest.identity.mapName, entry.mapName) ||
    !mapNamesEqual(decoded.data.meta.mapName, entry.mapName)
  ) {
    throw new HostedDemoLoadError('The hosted demo does not match its catalogue map.');
  }
  if (!hasPlayableContent(decoded.data)) {
    throw new HostedDemoLoadError('This hosted demo has no playable frames or recorded effects.');
  }

  return { data: decoded.data, manifest: decoded.manifest, byteLength: bytes.byteLength };
}

/** 读取 fetch 响应体（优先流式，逐块累计并回调进度） */
async function readResponseBody(response, signal, totalBytes, onProgress) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loadedBytes: bytes.byteLength, totalBytes });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loadedBytes: loaded, totalBytes });
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** 解析 Content-Length 头（非安全整数或负数返回 undefined） */
function parseContentLength(header) {
  if (header === null) return undefined;
  const value = Number(header);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** 判断 demo 是否有可播放内容 */
function hasPlayableContent(data) {
  return data.meta.numFrames > 0 || data.smokeVoxels.count > 0 || !!data.grenades.infernos?.length;
}

/** 判断两个 map 名是否相等（忽略前缀/大小写/分隔符） */
function mapNamesEqual(a, b) {
  return normalizeMapName(a) === normalizeMapName(b);
}

/** 归一化 map 名：去掉 de_/cs_/ar_ 等前缀，去掉空格/下划线/连字符，转小写 */
function normalizeMapName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(de|cs|ar|dz|gd|coop)_/i, '')
    .replace(/[\s_-]+/g, '');
}

/** 判断是否是 AbortError */
function isAbortError(err) {
  return err instanceof DOMException && err.name === 'AbortError';
}

// ── 团队身份识别 ──────────────────────────────────────────────────────────────

/**
 * 把录制 demo 里的团队（clanName）匹配到托管目录里的团队身份。
 * 匹配策略：
 *   1. 先按玩家名匹配（目录团队的 playerNames 与 demo 同 clanName 的玩家名集合求交集）。
 *   2. 若按玩家名无法唯一确定，则按团队名（归一化后）匹配。
 * 只有当结果唯一时才采用，否则保留原名并警告。
 *
 * @param {Array} catalogueTeams 目录里的团队列表（含 playerNames / name）
 * @param {Array} recordedPlayers 录制 demo 的玩家列表（含 clanName / name）
 * @returns {Map<string, object>} clanName -> 目录团队对象
 */
function resolveTeamIdentities(catalogueTeams, recordedPlayers) {
  const result = new Map();
  if (catalogueTeams.length === 0) return result;

  // 先按 clanName 分组收集录制玩家的名字（小写）
  const playersByClan = new Map();
  for (const player of recordedPlayers) {
    if (!player.clanName) continue;
    const names = playersByClan.get(player.clanName) ?? [];
    names.push(player.name.trim().toLowerCase());
    playersByClan.set(player.clanName, names);
  }

  for (const [clanName, clanPlayerNames] of playersByClan) {
    // 策略 1：按玩家名
    const byPlayers = catalogueTeams.filter((team) =>
      team.playerNames?.some((name) => clanPlayerNames.includes(name.trim().toLowerCase())),
    );
    const normalizedClan = normalizeTeamName(clanName);
    // 策略 2：按团队名（归一化后）
    const byName =
      byPlayers.length > 0
        ? byPlayers
        : catalogueTeams.filter((team) => normalizedClan !== '' && normalizeTeamName(team.name) === normalizedClan);

    if (byName.length === 1) {
      result.set(clanName, byName[0]);
    } else {
      console.warn(`[csplayer] no unambiguous hosted identity for recorded team "${clanName}"; keeping its name.`);
    }
  }
  return result;
}

/** 从系列赛格式（如 bo1/bo3/bo5）推导每张地图的胜负方块 */
function computeMapWinSquares(series, currentMap) {
  const bestOf = /^bo([13579])$/i.exec(series.format)?.[1];
  if (!bestOf) {
    console.warn(`[csplayer] unsupported series format "${series.format}"; map-win squares are unavailable.`);
    return undefined;
  }
  const previousMaps = series.maps.filter((m) => m.order < currentMap.order);
  if (previousMaps.length !== currentMap.order - 1) {
    console.warn('[csplayer] previous map results are incomplete; map-win squares are unavailable.');
    return undefined;
  }
  const mapsWon = [0, 0];
  for (const map of previousMaps) {
    const score = map.score;
    if (!score || score.team1 === score.team2) {
      console.warn('[csplayer] previous map results are incomplete; map-win squares are unavailable.');
      return undefined;
    }
    mapsWon[score.team1 > score.team2 ? 0 : 1]++;
  }
  return { mapsToWin: (Number(bestOf) + 1) / 2, mapsWon };
}

/** 归一化团队名（去掉 team/gaming/esports 等通用词，去掉非字母数字，NFKC 归一化） */
function normalizeTeamName(name) {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b(team|gaming|esports|e-sports)\b/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// ── IndexedDB 缓存层 ───────────────────────────────────────────────────────────

const DB_NAME = 'csplayer';
const DB_STORE = 'demos';
const DB_VERSION = 1;
const CACHE_VERSION = 47;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 根据文件字节 + 采样率生成缓存 key（sha256:sr<rate>:v<version>） */
async function computeCacheKey(bytes, sampleRate) {
  try {
    if (!('crypto' in globalThis) || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex}:sr${sampleRate}:v${CACHE_VERSION}`;
  } catch {
    return null;
  }
}

/** 从 IndexedDB 读取缓存的解析结果 */
async function readCache(key) {
  if (!key || !key.endsWith(`:v${CACHE_VERSION}`) || !('indexedDB' in globalThis)) return undefined;
  try {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

/** 写入 IndexedDB 缓存 */
async function writeCache(key, value) {
  if (!key || !('indexedDB' in globalThis)) return;
  try {
    const db = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    /* 缓存写入失败静默忽略 */
  }
}

/** 删除 IndexedDB 中的一条缓存 */
async function deleteCache(key) {
  if ('indexedDB' in globalThis) {
    try {
      const db = await openDatabase();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    } catch {
      /* 忽略 */
    }
  }
}

/** 清空 IndexedDB 全部缓存 */
async function clearCache() {
  if ('indexedDB' in globalThis) {
    try {
      const db = await openDatabase();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    } catch {
      /* 忽略 */
    }
  }
}

/** 删除不在保留集合里的过期缓存项 */
async function pruneCache(keepKeys) {
  if (!('indexedDB' in globalThis)) return;
  const keep = new Set(keepKeys);
  try {
    const db = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const cursorRequest = tx.objectStore(DB_STORE).openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const key = cursor.primaryKey;
          if (typeof key !== 'string' || !key.endsWith(`:v${CACHE_VERSION}`) || !keep.has(key)) {
            cursor.delete();
          }
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    /* 忽略 */
  }
}

/**
 * 解析一个本地 .dem 文件：先查缓存，未命中则交给 parser worker。
 * @returns {Promise<{data, key, fromCache: boolean}>}
 */
async function parseLocalFile(file, options = {}) {
  const { signal, onProgress, onManifest, onReady, onRound, ...rest } = options;
  const sampleRate = rest.sampleRate ?? 32;

  signal?.throwIfAborted();
  onProgress?.('Reading file…', -1);
  const bytes = await file.arrayBuffer();
  signal?.throwIfAborted();

  const key = await computeCacheKey(bytes, sampleRate);
  signal?.throwIfAborted();

  const cached = await readCache(key);
  signal?.throwIfAborted();
  if (cached) {
    onProgress?.('Loaded from cache', 1);
    return { data: cached, key, fromCache: true };
  }

  const data = await runParserWorker(bytes, rest, signal, onProgress, onManifest, onReady, onRound);
  writeCache(key, data);
  return { data, key, fromCache: false };
}

/** 仅读取缓存（不解析） */
function readCachedData(key) {
  return readCache(key);
}

/**
 * 启动 parser worker 并解析 .dem 文件。
 * worker 通过 postMessage 回报 progress / manifest / ready / round / done / error。
 */
function runParserWorker(bytes, options, signal, onProgress, onManifest, onReady, onRound) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('/assets/parser.worker-Cvx4vjXK.js', '' + import.meta.url), { type: 'module' });

    const abort = () => {
      worker.terminate();
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Parsing cancelled', 'AbortError'));
    };

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });

    const finish = (fn) => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      fn();
    };

    worker.onmessage = (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'progress':
          onProgress?.(msg.phase, msg.value);
          break;
        case 'manifest':
          onManifest?.(msg.manifest);
          break;
        case 'ready':
          onReady?.(msg.data, msg.manifest, msg.loadedRounds);
          break;
        case 'round':
          onRound?.(msg.data, msg.loadedRounds);
          break;
        case 'done':
          finish(() => resolve(msg.data));
          break;
        case 'error':
          finish(() => reject(Error(msg.message)));
          break;
      }
    };
    worker.onerror = (event) => {
      finish(() => reject(Error(event.message || 'Parser worker crashed')));
    };

    worker.postMessage({ type: 'parse', bytes, options }, [bytes]);
  });
}

// ── 最近场次（localStorage） ────────────────────────────────────────────────────

const RECENTS_KEY = 'csplayer:recents';
const MAX_RECENTS = 12;

/** 校验一个 recents 条目形状 */
function isValidRecentEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return typeof entry.key === 'string' && typeof entry.name === 'string' && typeof entry.map === 'string';
}

/** 读取 recents 列表 */
function readRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidRecentEntry) : [];
  } catch {
    return [];
  }
}

/** 添加（或更新）一个 recent 条目，去重后置顶，截断到 MAX_RECENTS */
function addRecent(entry) {
  try {
    const list = readRecents().filter((e) => e.key !== entry.key);
    list.unshift(entry);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    /* 忽略 */
  }
}

/** 按 key 删除一个 recent 条目 */
function removeRecent(key) {
  try {
    const list = readRecents().filter((e) => e.key !== key);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* 忽略 */
  }
}

/** 清空 recents */
function clearRecents() {
  try {
    localStorage.removeItem(RECENTS_KEY);
  } catch {
    /* 忽略 */
  }
}

// ── 手机端分步导航（phone wizard） ──────────────────────────────────────────────

const PHONE_STEP_KEY = 'csdemoPhoneStep';
const PHONE_STEPS = { matches: undefined, match: 'matches' };

function isPhoneStep(value) {
  return typeof value === 'string' && Object.hasOwn(PHONE_STEPS, value);
}

function getPhoneStep(state) {
  return state && typeof state === 'object' ? state[PHONE_STEP_KEY] : undefined;
}

/**
 * 创建手机端分步导航控制器。
 * 用 history.state 记录当前 step，支持前进/后退。
 */
function createPhoneWizard(screenRefs, canUseHistory) {
  let currentStep = 'matches';
  const history = window.history;

  const applyStep = (step) => {
    currentStep = step;
    screenRefs.screen.dataset.phoneStep = step;
    screenRefs.back.hidden = PHONE_STEPS[step] === undefined;
  };

  // 若初始 history.state 里有 step 则清掉（避免 stale）
  if (history && isPhoneStep(getPhoneStep(history.state))) {
    history.replaceState(null, '');
  }

  window.addEventListener('popstate', (event) => {
    const step = getPhoneStep(event.state);
    applyStep(isPhoneStep(step) ? step : 'matches');
  });

  screenRefs.back.addEventListener('click', () => wizard.back());

  applyStep(currentStep);

  const wizard = {
    get step() {
      return currentStep;
    },
    go(step) {
      if (step !== currentStep) {
        applyStep(step);
        if (canUseHistory.matches && history) history.pushState({ [PHONE_STEP_KEY]: step }, '');
      }
    },
    back() {
      const parent = PHONE_STEPS[currentStep];
      if (parent) {
        if (canUseHistory.matches && history && getPhoneStep(history.state) === currentStep) {
          history.back();
        } else {
          applyStep(parent);
        }
      }
    },
  };
  return wizard;
}

// ── AppShell 骨架 ──────────────────────────────────────────────────────────────

/**
 * 创建落地页/播放页的 DOM 骨架，并返回一组 UI 控制方法。
 * 这是整个应用的根 UI 容器。
 *
 * @param {Element} root #app 根元素
 */
function createAppShell(root) {
  root.innerHTML = `
    <div id="viewport"></div>

    <div class="drop-screen" id="dropScreen">
      <div class="drop-content">
        <header class="landing-header">
          <div class="brand">
            <h1 class="brand-title">CS<span class="brand-accent">DEMO</span></h1>
          </div>
        </header>

        <button class="phone-wizard-back" id="phoneWizardBack" type="button" hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>All matches</span>
        </button>

        <nav class="landing-mode-switch" aria-label="Choose a demo source">
          <button class="landing-mode active" id="proGamesTab" type="button" role="tab"
            aria-selected="true" aria-controls="proGamesPanel">
            <span class="landing-mode-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M8 4h8v4a4 4 0 0 1-8 0V4Zm0 2H5v1a4 4 0 0 0 4 4m7-5h3v1a4 4 0 0 1-4 4M12 12v4m-4 4h8m-6-4h4"
                  fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span>
              <strong>Pro matches</strong>
            </span>
          </button>
          <button class="landing-mode" id="ownDemosTab" type="button" role="tab"
            aria-selected="false" aria-controls="ownDemosPanel" tabindex="-1">
            <span class="landing-mode-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 15V3m0 0 4 4m-4-4-4 4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                  fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span>
              <strong>Your demos</strong>
              <small>Upload a .dem file</small>
            </span>
          </button>
        </nav>

        <main>
          <section class="landing-view" id="proGamesPanel" role="tabpanel" aria-labelledby="proGamesTab">
            <div class="hosted-panel" aria-labelledby="hostedTitle">
              <div class="panel-heading hosted-heading">
                <div>
                  <h2 id="hostedTitle">Watch professional matches</h2>
                </div>
              </div>
              <div class="hosted-demos" id="hostedDemos"></div>
            </div>
          </section>

          <section class="landing-view hidden" id="ownDemosPanel" role="tabpanel" aria-labelledby="ownDemosTab">
            <div class="landing-workspace">
              <section class="import-panel" aria-labelledby="importTitle">
                <div class="panel-heading">
                  <div>
                    <h2 id="importTitle">Upload your demo</h2>
                    <p>Locally processed</p>
                  </div>
                </div>

                <div class="drop-zone" id="dropZone" role="button" tabindex="0" aria-label="Choose or drop a .dem file">
                  <span class="drop-zone-icon-wrap">
                    <svg class="drop-zone-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 15V3m0 0 4 4m-4-4-4 4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                        fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </span>
                  <span class="drop-zone-copy">
                    <span class="drop-zone-main">Drop your <strong>.dem</strong> here</span>
                    <span class="drop-hint">or click to choose a file</span>
                  </span>
                  <span class="drop-browse">Browse files</span>
                </div>

                <div class="quality" id="quality"></div>
              </section>

              <section class="history-panel" aria-labelledby="historyTitle">
                <div class="panel-heading">
                  <div>
                    <h2 id="historyTitle">On this device</h2>
                  </div>
                </div>
                <div class="recents" id="recents"></div>
              </section>
            </div>
          </section>
        </main>

        <footer class="landing-disclaimer">
          CSDEMO is not affiliated with or endorsed by Valve Corporation.
        </footer>
      </div>

      <input type="file" id="fileInput" accept=".dem" class="hidden" />
    </div>

    <div class="loading hidden" id="loading">
      <div class="landing-backdrop" aria-hidden="true"></div>
      <section class="loading-card" id="loadingCard" aria-labelledby="loadingTitle">
        <div class="loading-hero" id="loadingHero" aria-hidden="true"></div>
        <h2 class="loading-title" id="loadingTitle">Opening demo</h2>
        <div class="loading-progress" id="loadingProgress">
          <div class="loading-bar indeterminate" id="loadingBar" role="progressbar" aria-labelledby="loadingLabel" aria-valuemin="0" aria-valuemax="100">
            <div class="loading-bar-fill" id="loadingBarFill"></div>
          </div>
          <div class="loading-status">
            <span class="loading-label" id="loadingLabel" aria-live="polite">Loading…</span>
            <span class="loading-timer" id="loadingTimer">0.0s</span>
          </div>
        </div>
        <p class="error-text hidden" id="errorText" role="alert"></p>
        <button class="loading-action hidden" id="loadingAction" type="button"></button>
      </section>
    </div>

    <div class="drop-overlay hidden" id="dropOverlay" aria-hidden="true">
      <div class="drop-overlay-inner">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15V3m0 0 4 4m-4-4-4 4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
            fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <p>Release to load demo</p>
      </div>
    </div>

    <div class="leave-confirm hidden" id="leaveConfirm" role="dialog" aria-modal="true" aria-labelledby="leaveConfirmTitle">
      <div class="leave-confirm-panel">
        <h2 id="leaveConfirmTitle">Leave demo?</h2>
        <p>This demo is still processing. If you leave now, it won’t be saved on this device.</p>
        <div class="leave-confirm-progress" id="leaveConfirmProgress" role="progressbar" aria-label="Demo processing progress" aria-valuemin="0" aria-valuemax="100">
          <div class="leave-confirm-progress-fill" id="leaveConfirmProgressFill"></div>
        </div>
        <div class="leave-confirm-actions">
          <button type="button" class="leave-confirm-stay" id="leaveConfirmStay">Keep watching</button>
          <button type="button" class="leave-confirm-leave" id="leaveConfirmLeave">Leave demo</button>
        </div>
      </div>
    </div>
  `;

  const getById = (id) => {
    const el = root.querySelector(`#${id}`);
    if (!el) throw Error(`AppShell: missing #${id}`);
    return el;
  };

  const viewport = getById('viewport');
  const dropScreen = getById('dropScreen');

  // 阻止在 drop screen 显示时复制/剪切/拖拽（避免干扰拖拽上传）
  const blockCopyCut = (event) => {
    if (dropScreen.classList.contains('hidden')) return;
    if (event.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
  };
  const doc = root.ownerDocument;
  doc?.addEventListener('copy', blockCopyCut);
  doc?.addEventListener('cut', blockCopyCut);
  viewport.addEventListener('dragstart', blockCopyCut);

  const dropZone = getById('dropZone');
  const fileInput = getById('fileInput');
  const recentsSlot = getById('recents');
  const hostedDemosSlot = getById('hostedDemos');
  const qualitySlot = getById('quality');
  const dropOverlay = getById('dropOverlay');
  const proGamesTab = getById('proGamesTab');
  const ownDemosTab = getById('ownDemosTab');
  const proGamesPanel = getById('proGamesPanel');
  const ownDemosPanel = getById('ownDemosPanel');
  const loading = getById('loading');
  const loadingLabel = getById('loadingLabel');
  const loadingCard = getById('loadingCard');
  const loadingHero = getById('loadingHero');
  const loadingTitle = getById('loadingTitle');
  const loadingProgress = getById('loadingProgress');
  const loadingBar = getById('loadingBar');
  const loadingBarFill = getById('loadingBarFill');
  const loadingTimer = getById('loadingTimer');
  const errorText = getById('errorText');
  const loadingAction = getById('loadingAction');
  const leaveConfirm = getById('leaveConfirm');
  const leaveConfirmProgress = getById('leaveConfirmProgress');
  const leaveConfirmProgressFill = getById('leaveConfirmProgressFill');
  const leaveConfirmStay = getById('leaveConfirmStay');
  const leaveConfirmLeave = getById('leaveConfirmLeave');

  let cancelAction; // 取消按钮回调
  let leaveAction; // 「Leave demo」回调
  let loadingExitTimer; // loading 退出动画定时器
  let leaveConfirmTimer; // leave confirm 过渡定时器

  // 隐藏离开确认框（可选立即或走过渡动画）
  const hideLeaveConfirm = (immediate = false) => {
    leaveAction = undefined;
    if (leaveConfirmTimer !== undefined) {
      clearTimeout(leaveConfirmTimer);
      leaveConfirmTimer = undefined;
    }
    if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      leaveConfirm.classList.add('hidden');
      leaveConfirm.classList.remove('leave-confirm-transitioning');
      return;
    }
    if (leaveConfirm.classList.contains('hidden')) return;
    leaveConfirm.classList.add('leave-confirm-transitioning');
    leaveConfirmTimer = window.setTimeout(() => {
      leaveConfirm.classList.add('hidden');
      leaveConfirm.classList.remove('leave-confirm-transitioning');
      leaveConfirmTimer = undefined;
    }, 220);
  };

  loadingAction.addEventListener('click', () => cancelAction?.());
  leaveConfirmStay.addEventListener('click', () => hideLeaveConfirm());
  leaveConfirmLeave.addEventListener('click', () => leaveAction?.());

  // 响应式：手机端（无 hover 指针）强制 pro 模式
  const isCoarsePointer = window.matchMedia('(pointer: coarse)');

  const setMode = (mode) => {
    const showPro = isCoarsePointer.matches || mode === 'pro';
    proGamesTab.classList.toggle('active', showPro);
    proGamesTab.setAttribute('aria-selected', String(showPro));
    proGamesTab.tabIndex = showPro ? 0 : -1;
    ownDemosTab.classList.toggle('active', !showPro);
    ownDemosTab.setAttribute('aria-selected', String(!showPro));
    ownDemosTab.tabIndex = showPro ? -1 : 0;
    proGamesPanel.classList.toggle('hidden', !showPro);
    ownDemosPanel.classList.toggle('hidden', showPro);
  };

  proGamesTab.addEventListener('click', () => setMode('pro'));
  ownDemosTab.addEventListener('click', () => setMode('own'));

  // 桌面端用左右方向键在 tab 间切换
  const tabs = [proGamesTab, ownDemosTab];
  for (const tab of tabs) {
    tab.addEventListener('keydown', (event) => {
      if (isCoarsePointer.matches || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      const isOwn = tab === ownDemosTab;
      setMode(isOwn ? 'pro' : 'own');
      tabs[+!isOwn].focus();
    });
  }

  const applyResponsive = () => {
    fileInput.disabled = isCoarsePointer.matches;
    ownDemosTab.disabled = isCoarsePointer.matches;
    proGamesPanel.setAttribute('role', isCoarsePointer.matches ? 'region' : 'tabpanel');
    proGamesPanel.setAttribute('aria-labelledby', isCoarsePointer.matches ? 'hostedTitle' : 'proGamesTab');
    if (isCoarsePointer.matches) {
      setMode('pro');
      dropOverlay.classList.add('hidden');
    }
  };
  isCoarsePointer.addEventListener('change', applyResponsive);
  applyResponsive();

  const phoneWizard = createPhoneWizard(
    { screen: dropScreen, back: getById('phoneWizardBack') },
    window.matchMedia('(hover: hover) and (pointer: fine)'),
  );

  // 计时器
  let timerHandle;
  const stopTimer = () => {
    if (timerHandle !== undefined) {
      clearInterval(timerHandle);
      timerHandle = undefined;
    }
  };
  const startTimer = () => {
    stopTimer();
    const start = performance.now();
    loadingTimer.textContent = formatSeconds(0);
    loadingTimer.classList.remove('hidden');
    timerHandle = window.setInterval(() => {
      loadingTimer.textContent = formatSeconds(performance.now() - start);
    }, 100);
  };
  const cancelLoadingExit = () => {
    if (loadingExitTimer !== undefined) {
      clearTimeout(loadingExitTimer);
      loadingExitTimer = undefined;
    }
    loading.classList.remove('loading-exiting');
  };

  // 进度条
  let progress = null;
  const setProgress = (value) => {
    progress = value === null ? null : Math.max(progress ?? 0, Math.min(1, Math.max(0, value)));
    loadingBar.classList.toggle('indeterminate', progress === null);
    if (progress === null) {
      loadingBar.removeAttribute('aria-valuenow');
      loadingBarFill.style.removeProperty('width');
      return;
    }
    loadingBar.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    loadingBarFill.style.width = `${progress * 100}%`;
  };

  // 设置 loading 卡片的 hero 区（团队 logo 或错误/文件图标）
  const setLoadingHero = (info, state = 'loading') => {
    const teams = info.teams;
    const teamPair = teams?.length === 2 && teams.every((t) => t.name) ? teams : undefined;

    loadingTitle.textContent = info.title ?? '';
    loadingTitle.classList.toggle('hidden', !info.title);
    if (info.title) {
      loadingCard.setAttribute('aria-labelledby', 'loadingTitle');
      loadingCard.removeAttribute('aria-label');
    } else {
      loadingCard.removeAttribute('aria-labelledby');
      loadingCard.setAttribute('aria-label', teamPair ? `${teamPair[0].name} vs ${teamPair[1].name}` : 'Opening demo');
    }
    loadingCard.dataset.state = state;
    loadingHero.replaceChildren();

    if (state === 'error') {
      loadingHero.append(createLoadingGlyph('error'));
      return;
    }
    if (teamPair) {
      const versus = document.createElement('span');
      versus.className = 'loading-versus';
      loadingHero.append(
        createTeamLogo(teamPair[0].logoUrl, teamPair[0].name, 'hosted-team-logo loading-team-logo', { invertWhite: true }),
        versus,
        createTeamLogo(teamPair[1].logoUrl, teamPair[1].name, 'hosted-team-logo loading-team-logo', { invertWhite: true }),
      );
      return;
    }
    loadingHero.append(createLoadingGlyph('demo'));
  };

  return {
    viewport,
    dropScreen,
    phoneWizard,
    dropZone,
    fileInput,
    recentsSlot,
    hostedDemosSlot,
    qualitySlot,
    dropOverlay,

    showDropScreen() {
      dropScreen.classList.remove('hidden');
    },
    hideDropScreen() {
      dropScreen.classList.add('hidden');
    },

    showLoading(label, onCancel, heroInfo) {
      cancelLoadingExit();
      errorText.classList.add('hidden');
      setLoadingHero(heroInfo ?? { title: 'Opening demo' });
      loadingProgress.classList.remove('hidden');
      loadingLabel.textContent = label;
      progress = null;
      setProgress(null);
      cancelAction = onCancel;
      loadingAction.textContent = 'Cancel';
      loadingAction.classList.remove('loading-action-primary');
      loadingAction.classList.toggle('hidden', !onCancel);
      startTimer();

      const wasHidden = loading.classList.contains('hidden');
      loading.classList.remove('hidden');
      if (wasHidden) {
        loadingCard.classList.remove('loading-card-enter');
        // 强制 reflow 以触发进入动画
        void loadingCard.offsetWidth;
        loadingCard.classList.add('loading-card-enter');
      }
    },

    setLoadingLabel(label) {
      loadingLabel.textContent = label;
    },
    setLoadingProgress(value) {
      setProgress(value);
    },
    advanceLoadingProgress(target) {
      if (progress === null || progress >= target) return;
      setProgress(progress + (target - progress) * 0.35);
    },

    hideLoading(immediate = false) {
      stopTimer();
      cancelAction = undefined;
      if (progress !== null) setProgress(1);
      if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        cancelLoadingExit();
        loading.classList.add('hidden');
        return;
      }
      loading.classList.add('loading-exiting');
      loadingExitTimer = window.setTimeout(() => {
        loading.classList.add('hidden');
        loading.classList.remove('loading-exiting');
        loadingExitTimer = undefined;
      }, 350);
    },

    showError(message, onAction) {
      stopTimer();
      cancelLoadingExit();
      setLoadingHero({ title: 'This demo couldn’t be opened' }, 'error');
      loadingProgress.classList.add('hidden');
      errorText.textContent = message;
      errorText.classList.remove('hidden');
      cancelAction = onAction;
      loadingAction.textContent = 'Choose another demo';
      loadingAction.classList.add('loading-action-primary');
      loadingAction.classList.toggle('hidden', !onAction);
      loading.classList.remove('hidden');
    },

    showParsingLeaveConfirmation(progressValue, onLeave) {
      if (leaveConfirmTimer !== undefined) {
        clearTimeout(leaveConfirmTimer);
        leaveConfirmTimer = undefined;
      }
      leaveAction = onLeave;
      setLeaveProgress(leaveConfirmProgress, leaveConfirmProgressFill, progressValue);
      const entering = leaveConfirm.classList.contains('hidden') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      leaveConfirm.classList.toggle('leave-confirm-transitioning', entering);
      leaveConfirm.classList.remove('hidden');
      if (entering) {
        void leaveConfirm.offsetWidth;
        leaveConfirm.classList.remove('leave-confirm-transitioning');
      }
      leaveConfirmStay.focus();
    },
    setParsingLeaveProgress(value) {
      setLeaveProgress(leaveConfirmProgress, leaveConfirmProgressFill, value);
    },
    hideParsingLeaveConfirmation(immediate = false) {
      hideLeaveConfirm(immediate);
    },
  };
}

// ── UI 辅助函数 ─────────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 创建 loading hero 里的图标（error 或 demo 文件图标） */
function createLoadingGlyph(kind) {
  const wrapper = document.createElement('span');
  wrapper.className = `loading-glyph loading-glyph-${kind}`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    kind === 'error'
      ? 'M12 8.5v4.5m0 3.4v.1M10.3 3.9 2.6 17.3a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'
      : 'M7 3.5h6.5L18 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Zm6 0V8.5h5M10.5 12.5v5l4-2.5-4-2.5Z',
  );
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  wrapper.append(svg);
  return wrapper;
}

/** 设置一个进度条（fill 宽度 + aria） */
function setLeaveProgress(bar, fill, value) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  bar.setAttribute('aria-valuenow', String(pct));
  fill.style.width = `${pct}%`;
}

/** 把毫秒格式化成 s 或 m:ss */
function formatSeconds(ms) {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}

/** 绑定拖拽/点击上传交互 */
function bindDropZone(shell, onFile) {
  const { dropZone, fileInput, dropOverlay } = shell;

  const acceptFile = (file) => {
    if (file && !fileInput.disabled) onFile(file);
  };

  dropZone.addEventListener('click', () => {
    if (!fileInput.disabled) fileInput.click();
  });
  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!fileInput.disabled) fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    acceptFile(fileInput.files?.[0]);
    fileInput.value = '';
  });

  const hasFiles = (event) => !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
  let dragDepth = 0;
  const hideOverlay = () => {
    dragDepth = 0;
    dropOverlay.classList.add('hidden');
  };

  window.addEventListener('dragenter', (event) => {
    if (hasFiles(event)) {
      event.preventDefault();
      if (fileInput.disabled) {
        hideOverlay();
        return;
      }
      dragDepth++;
      dropOverlay.classList.remove('hidden');
    }
  });
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener('dragleave', (event) => {
    if (hasFiles(event)) {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideOverlay();
    }
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    hideOverlay();
    acceptFile(event.dataTransfer?.files?.[0]);
  });
}

// ── 地图统计 ───────────────────────────────────────────────────────────────────

/** 地图统计加载失败错误（jP） */
class MapStatsError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'MapStatsError';
  }
}

/**
 * 下载并校验一张地图的统计 JSON。
 * @param {object} match 比赛对象
 * @param {object} map 地图对象（含 summary: {url, bytes, sha256}）
 * @param {AbortSignal} signal
 */
async function fetchMapStatistics(match, map, signal) {
  const summary = map.summary;
  if (!summary) throw new MapStatsError('Statistics have not been published for this map.');

  const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  let response;
  try {
    response = await fetch(summary.url, { signal: combinedSignal });
  } catch (err) {
    throw signal.aborted ? err : new MapStatsError('Map statistics could not be downloaded.', { cause: err });
  }
  if (!response.ok) throw new MapStatsError(`Map statistics are unavailable (HTTP ${response.status}).`);
  if (!response.body) throw new MapStatsError('Map statistics response has no body.');

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  try {
    for (;;) {
      combinedSignal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > summary.bytes || loaded > 256 * 1024) {
        await reader.cancel();
        throw new MapStatsError('Map statistics exceed their published size.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (loaded !== summary.bytes) throw new MapStatsError('Map statistics do not match their published size.');

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if ((await hashBytesToHex(bytes)) !== summary.sha256) {
    throw new MapStatsError('Map statistics failed their checksum verification.');
  }
  combinedSignal.throwIfAborted();

  let json;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (err) {
    throw new MapStatsError('Map statistics are not valid JSON.', { cause: err });
  }
  return validateMapStats(json, match, map);
}

/** 严格校验地图统计 JSON 的结构与一致性 */
function validateMapStats(raw, match, map) {
  const summary = requireStatsObject(raw, 'Map summary');
  if (summary.version !== 1 || summary.coverage !== 'complete') {
    throwStats('Unsupported or incomplete map summary.');
  }
  if (summary.matchId !== match.id || summary.mapId !== map.id || normalizeMapNameStats(summary.mapName) !== normalizeMapNameStats(map.name)) {
    throwStats('Map statistics belong to a different match or map.');
  }

  const producer = requireStatsObject(summary.producer, 'Summary producer');
  const score = requireStatsScore(summary.score);
  if (!map.score || score.team1 !== map.score.team1 || score.team2 !== map.score.team2) {
    throwStats('Map statistics do not match the catalogue score.');
  }

  const seenPlayerIds = new Set();
  const teams = requireStatsArray(summary.teams, 'Summary teams').map((teamRaw, teamIndex) => {
    const team = requireStatsObject(teamRaw, 'Summary team');
    const id = requireStatsString(team.id, 'Team ID');
    if (id !== [match.team1Id, match.team2Id][teamIndex]) {
      throwStats('Summary teams do not match catalogue order.');
    }
    const players = requireStatsArray(team.players, 'Team players').map((playerRaw) => {
      const player = requireStatsObject(playerRaw, 'Summary player');
      const pid = requireStatsString(player.id, 'Player ID');
      if (seenPlayerIds.has(pid)) throwStats('Duplicate player in map statistics.');
      seenPlayerIds.add(pid);
      if (typeof player.adr !== 'number' || !Number.isFinite(player.adr) || player.adr < 0) {
        throwStats('Player ADR is invalid.');
      }
      return {
        id: pid,
        name: requireStatsString(player.name, 'Player name'),
        kills: requireStatsCount(player.kills),
        deaths: requireStatsCount(player.deaths),
        assists: requireStatsCount(player.assists),
        adr: player.adr,
      };
    });
    if (players.length === 0) throwStats('Summary team has no players.');
    return { id, name: requireStatsString(team.name, 'Team name'), players };
  });
  if (teams.length !== 2) throwStats('Map statistics need exactly two teams.');

  const runningScore = { team1: 0, team2: 0 };
  const rounds = requireStatsArray(summary.rounds, 'Summary rounds').map((roundRaw, roundIndex) => {
    const round = requireStatsObject(roundRaw, 'Summary round');
    const number = requireStatsCount(round.number);
    const winnerTeamId = requireStatsString(round.winnerTeamId, 'Round winner');
    if (number !== roundIndex + 1 || ![match.team1Id, match.team2Id].includes(winnerTeamId)) {
      throwStats('Round order or winner is invalid.');
    }
    if (round.side !== 'ct' && round.side !== 't') throwStats('Round side is invalid.');
    if (
      round.reason !== 'elimination' &&
      round.reason !== 'bomb' &&
      round.reason !== 'defuse' &&
      round.reason !== 'time' &&
      round.reason !== 'unknown'
    ) {
      throwStats('Round win reason is invalid.');
    }
    if (
      (round.reason === 'bomb' && round.side !== 't') ||
      (['defuse', 'time'].includes(round.reason) && round.side !== 'ct')
    ) {
      throwStats('Round win reason conflicts with its side.');
    }
    winnerTeamId === match.team1Id ? runningScore.team1++ : runningScore.team2++;

    const roundScore = requireStatsScore(round.score);
    if (roundScore.team1 !== runningScore.team1 || roundScore.team2 !== runningScore.team2) {
      throwStats('Round history has an inconsistent running score.');
    }
    return {
      number,
      winnerTeamId,
      side: round.side,
      reason: round.reason,
      score: roundScore,
      ...(round.phase === undefined ? {} : { phase: requireStatsString(round.phase, 'Round phase') }),
    };
  });

  if (runningScore.team1 !== score.team1 || runningScore.team2 !== score.team2) {
    throwStats('Round history does not match the final score.');
  }

  return {
    version: 1,
    matchId: match.id,
    mapId: map.id,
    mapName: map.name,
    coverage: 'complete',
    producer: {
      parserVersion: requireStatsString(producer.parserVersion, 'Parser version'),
      ...(producer.parserRevision === undefined ? {} : { parserRevision: requireStatsString(producer.parserRevision, 'Parser revision') }),
    },
    score,
    teams: [teams[0], teams[1]],
    rounds,
  };
}

function throwStats(message) {
  throw new MapStatsError(message);
}
function requireStatsObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throwStats(`${label} must be an object.`);
  return value;
}
function requireStatsArray(value, label) {
  if (!Array.isArray(value)) throwStats(`${label} must be an array.`);
  return value;
}
function requireStatsString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throwStats(`${label} must be a nonempty string.`);
  return value.trim();
}
function requireStatsCount(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throwStats('Summary counts must be nonnegative integers.');
  }
  return value;
}
function requireStatsScore(value) {
  const score = requireStatsObject(value, 'Score');
  return { team1: requireStatsCount(score.team1), team2: requireStatsCount(score.team2) };
}
function normalizeMapNameStats(value) {
  return requireStatsString(value, 'Map name')
    .toLowerCase()
    .replace(/^de_/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** 把地图统计 JSON 组装成便于渲染的结构 */
function buildMapPreview(match, map, teamMap, summary) {
  const teamInfo = (teamId, teamIndex, score) => ({
    name: teamMap.get(teamId)?.name ?? teamId,
    logoUrl: teamMap.get(teamId)?.logoUrl,
    score,
    players: summary?.teams[teamIndex].players.map((p) => ({ ...p })) ?? [],
  });

  const teams = [
    teamInfo(match.team1Id, 0, map.score?.team1),
    teamInfo(match.team2Id, 1, map.score?.team2),
  ];

  return {
    teams,
    pickedBy: map.pick?.type === 'pick' ? teams[map.pick.teamId === match.team1Id ? 0 : 1] : undefined,
    rounds: summary?.rounds.map((round) => ({
      number: round.number,
      winner: round.winnerTeamId === match.team1Id ? 0 : 1,
      side: round.side,
      reason: round.reason,
      score: [round.score.team1, round.score.team2],
      ...(round.phase === undefined ? {} : { phase: round.phase }),
    })),
  };
}

/** 根据 K/D 比值相对阈值返回 positive/negative/neutral */
function classifyRatio(value, low, high) {
  if (value === undefined) return 'neutral';
  if (value > high) return 'positive';
  if (value < low) return 'negative';
  return 'neutral';
}
function classifyScore(value) {
  if (value === undefined) return 'neutral';
  return classifyRatio(value, value, value);
}

// 自然排序 collator（名字按数字感知排序）
const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 对计分板行排序（支持 name/kills/deaths/assists/kdRatio/adr 列） */
function sortScoreboardRows(rows, sort) {
  const direction = sort.direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.column === 'name') return direction * naturalCollator.compare(a.name, b.name);
    const aVal = sort.column === 'kdRatio' ? (a.deaths === 0 ? undefined : a.kills / a.deaths) : a[sort.column];
    const bVal = sort.column === 'kdRatio' ? (b.deaths === 0 ? undefined : b.kills / b.deaths) : b[sort.column];
    if (aVal === undefined && bVal !== undefined) return 1;
    if (bVal === undefined && aVal !== undefined) return -1;
    if (aVal !== undefined && bVal !== undefined) {
      const diff = direction * (aVal - bVal);
      if (diff !== 0) return diff;
    }
    return naturalCollator.compare(a.name, b.name);
  });
}

// ── 托管目录菜单 ────────────────────────────────────────────────────────────────

/**
 * 创建托管 demo 菜单（事件 → 比赛 → 地图片段三级选择器）。
 * @param {Element} container 容器元素
 * @param {Function} onWatch 用户点击 Watch 时的回调
 * @param {Function} onRetry 重试加载目录的回调
 * @param {Function} onMatchSelect 选择比赛时的回调（手机端）
 */
function createHostedDemoMenu(container, onWatch, onRetry, onMatchSelect) {
  let catalogue;
  let menu;
  let selectedEventId;
  let selectedMatchId;
  let selectedSegmentId;

  const render = () => {
    if (!catalogue) {
      menu = undefined;
      container.replaceChildren(createHostedStatus('No featured matches are available yet.'));
      return;
    }

    const teamsById = new Map(catalogue.teams.map((t) => [t.id, t]));
    const teamNamesById = new Map(catalogue.teams.map((t) => [t.id, t.name]));
    const matchesByEvent = new Map();
    const segmentsByMatch = new Map();
    const eventHasEnabled = new Map();
    const now = Date.now();

    for (const event of catalogue.events) eventHasEnabled.set(event.id, false);
    for (const match of catalogue.matches) {
      const segments = buildMatchSegments(match, teamNamesById, catalogue.events, now);
      segmentsByMatch.set(match.id, segments);
      const enabled = matchIsPlayable(match, catalogue.events, now) && segments.length > 0;
      const list = matchesByEvent.get(match.eventId) ?? [];
      list.push({ id: match.id, match, disabled: !enabled });
      matchesByEvent.set(match.eventId, list);
      if (enabled) eventHasEnabled.set(match.eventId, true);
    }

    if (catalogue.events.length === 0) {
      menu = undefined;
      container.replaceChildren(createHostedStatus('No featured matches are available yet.'));
      return;
    }

    // 按开始时间排序事件
    const events = [...catalogue.events]
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .map((event) => ({
        id: event.id,
        event,
        disabled: event.status === 'upcoming' || !eventHasEnabled.get(event.id),
      }));

    selectedEventId = keepOrFirst(events, selectedEventId);
    const matches = selectedEventId ? matchesByEvent.get(selectedEventId) ?? [] : [];
    selectedMatchId = keepOrFirst(matches, selectedMatchId);
    const segments = selectedMatchId ? segmentsByMatch.get(selectedMatchId) ?? [] : [];
    selectedSegmentId = keepOrFirst(
      segments.map((s) => ({ id: s.id, disabled: false })),
      selectedSegmentId,
    );

    const selectedMatch = catalogue.matches.find((m) => m.id === selectedMatchId);
    const selectedSegment = segments.find((s) => s.id === selectedSegmentId);

    if (!selectedSegment || !selectedMatch) {
      menu = undefined;
      const wrapper = document.createElement('div');
      wrapper.className = 'hosted-menu';
      wrapper.append(
        createHostedStatus(
          events.some((e) => !e.disabled)
            ? 'No published map segments are available for this event yet.'
            : 'Published match segments will appear here once events begin.',
        ),
      );
      container.replaceChildren(wrapper);
      return;
    }

    // 展开所有 map 选项（按 map order 排序）
    const mapOptions = [...selectedMatch.maps]
      .sort((a, b) => a.order - b.order)
      .flatMap((map) => {
        const preview = buildMapPreview(selectedMatch, map, teamsById);
        return segments
          .filter((s) => s.mapId === map.id)
          .map((segment) => ({ id: segment.id, selection: segment, map, preview }));
      });
    const selectedOption = mapOptions.find((o) => o.id === selectedSegment.id);
    if (!selectedOption) throw Error(`HostedDemoMenu: missing map option for ${selectedSegment.id}`);

    if (!menu) {
      const eventPicker = createEventPicker((id) => {
        if (selectedEventId !== id) {
          selectedEventId = id;
          selectedMatchId = undefined;
          selectedSegmentId = undefined;
          render();
        }
      });
      const matchPicker = createMatchPicker(teamNamesById, (id) => {
        if (selectedMatchId !== id) {
          selectedMatchId = id;
          selectedSegmentId = undefined;
          render();
        }
        onMatchSelect?.();
      });
      const mapPicker = createMapPicker((id) => {
        if (selectedSegmentId !== id) {
          selectedSegmentId = id;
          render();
        }
      });
      menu = { events: eventPicker, matches: matchPicker, segments: mapPicker };
      const wrapper = document.createElement('div');
      wrapper.className = 'hosted-menu';
      wrapper.append(eventPicker.element, matchPicker.element, mapPicker.element);
      container.replaceChildren(wrapper);
    }

    const loadingSelected = menu !== undefined;
    menu.events.update(events, selectedEventId, loadingSelected);
    menu.matches.update(matches, selectedMatchId, loadingSelected);
    menu.segments.update(mapOptions, selectedSegmentId, loadingSelected);
    menu.segments.showMatch(
      selectedMatch,
      catalogue.events.find((e) => e.id === selectedMatch.eventId),
      teamsById,
    );
    menu.segments.showDetails(selectedOption, selectedMatch, teamsById);
    menu.segments.watch.disabled = loadingSelected;
    menu.segments.watch.textContent = selectedEventId === selectedSegment.id ? 'Loading…' : 'Watch';
    menu.segments.watch.setAttribute('aria-label', `Watch ${selectedSegment.displayTitle}`);
    menu.segments.watch.onclick = () => {
      const preview = buildMapPreview(selectedMatch, selectedOption.map, teamsById, menu?.segments.getSummary());
      const mapWin = computeMapWinSquares(selectedMatch, selectedOption.map);
      onWatch({
        ...selectedSegment,
        teams: preview.teams.map((team, index) => ({
          name: team.name,
          logoUrl: team.logoUrl,
          playerNames: team.players.map((p) => p.name),
          mapsWon: mapWin?.mapsWon[index],
          mapsToWin: mapWin?.mapsToWin,
        })),
      });
    };
  };

  return {
    showLoading() {
      menu?.segments.dispose();
      catalogue = undefined;
      menu = undefined;
      container.replaceChildren(createHostedStatus('Loading featured matches…', true));
    },
    showCatalogue(value) {
      menu?.segments.dispose();
      catalogue = value;
      menu = undefined;
      selectedEventId = undefined;
      selectedMatchId = undefined;
      selectedSegmentId = undefined;
      render();
    },
    showError(message) {
      menu?.segments.dispose();
      catalogue = undefined;
      menu = undefined;
      const status = createHostedStatus(message);
      const retry = document.createElement('button');
      retry.className = 'hosted-retry';
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', onRetry);
      status.appendChild(retry);
      container.replaceChildren(status);
    },
    setSelected(id) {
      selectedSegmentId = id;
      render();
    },
  };
}

/** 创建事件选择器 */
function createEventPicker(onSelect) {
  const section = createPickerSection('Event');
  section.classList.add('hosted-event-picker');
  const grid = document.createElement('div');
  grid.className = 'hosted-event-grid';
  const update = createReusableList(
    grid,
    ({ event }) => {
      const card = document.createElement('button');
      card.className = 'hosted-event-card';
      card.appendChild(createTeamLogo(event.logoUrl, event.name, 'hosted-event-logo', { invertWhite: true }));
      const copy = document.createElement('span');
      copy.className = 'hosted-event-copy';
      const name = document.createElement('strong');
      name.textContent = event.name;
      const meta = document.createElement('span');
      meta.textContent = [capitalize(event.status), formatDateRange(event)].join(' · ');
      copy.append(name, meta);
      card.appendChild(copy);
      return card;
    },
    onSelect,
  );
  section.appendChild(grid);
  return { element: section, update };
}

/** 创建比赛选择器 */
function createMatchPicker(teamNamesById, onSelect) {
  const section = createPickerSection('Match');
  section.classList.add('hosted-match-picker');
  const grid = document.createElement('div');
  grid.className = 'hosted-match-grid';
  const update = createReusableList(
    grid,
    ({ match }) => {
      const team1 = teamNamesById.get(match.team1Id);
      const team2 = teamNamesById.get(match.team2Id);
      const card = document.createElement('button');
      card.className = 'hosted-match-card';
      const teams = document.createElement('span');
      teams.className = 'hosted-match-teams';
      teams.append(
        createMatchTeam(team1, match.team1Id),
        createMatchCenter(match),
        createMatchTeam(team2, match.team2Id),
      );
      card.appendChild(teams);
      return card;
    },
    onSelect,
  );
  section.appendChild(grid);
  return { element: section, update };
}

/** 创建单个比赛团队（logo + 名字） */
function createMatchTeam(team, teamId) {
  const name = team?.name ?? teamId;
  const wrapper = document.createElement('span');
  wrapper.className = 'hosted-match-team';
  wrapper.appendChild(createTeamLogo(team?.logoUrl, name, 'hosted-team-logo', { invertWhite: true }));
  const nameEl = document.createElement('span');
  nameEl.className = 'hosted-match-team-name';
  nameEl.textContent = name;
  wrapper.appendChild(nameEl);
  return wrapper;
}

/** 创建比赛中间区域（日期 + 比分 + 阶段） */
function createMatchCenter(match) {
  const center = document.createElement('span');
  center.className = 'hosted-match-center';
  const date = document.createElement('span');
  date.className = 'hosted-match-date';
  date.textContent = formatDate(match.playedAt) ?? '';
  const score = document.createElement('span');
  score.className = 'hosted-match-score';
  const score1 = document.createElement('strong');
  score1.textContent = String(match.score.team1);
  const versus = document.createElement('span');
  versus.className = 'hosted-versus';
  versus.textContent = ':';
  const score2 = document.createElement('strong');
  score2.textContent = String(match.score.team2);
  score.append(score1, versus, score2);
  const meta = document.createElement('span');
  meta.className = 'hosted-match-card-meta';
  meta.textContent = firstSentence(match.stage) ?? '';
  meta.title = meta.textContent;
  center.append(date, score, meta);
  return center;
}

/** 创建地图片段选择器（含详情面板） */
function createMapPicker(onSelect) {
  const section = createPickerSection('Map');
  section.classList.add('hosted-map-picker');
  const column = document.createElement('div');
  column.className = 'hosted-map-column';
  const segmentList = document.createElement('div');
  segmentList.className = 'hosted-segment-list';

  const update = createReusableList(
    segmentList,
    ({ selection, map, preview }) => {
      const segment = document.createElement('button');
      segment.className = 'hosted-segment';
      const label = document.createElement('span');
      label.className = 'hosted-segment-label';
      const title = document.createElement('strong');
      title.textContent = prettyMapName(selection.mapName);
      label.appendChild(title);
      if (map.pick?.type === 'decider') {
        const decider = document.createElement('span');
        decider.className = 'hosted-map-decider';
        decider.textContent = 'Decider';
        label.appendChild(decider);
      }
      const mapInfo = document.createElement('span');
      mapInfo.className = 'hosted-segment-map-info';
      mapInfo.append(createMapIcon(selection.mapName, selection.mapName), label);
      const teams = document.createElement('span');
      teams.className = 'hosted-segment-teams';
      for (const [index, team] of preview.teams.entries()) {
        const teamWrap = document.createElement('span');
        teamWrap.className = 'hosted-segment-team';
        teamWrap.title = team.name;
        const score = document.createElement('span');
        score.className = 'hosted-segment-score';
        score.textContent = team.score === undefined ? '—' : String(team.score);
        score.classList.add(`hosted-segment-${classifyScore(team.score, preview.teams[1 - index].score)}`);
        const logo = createTeamLogo(team.logoUrl, team.name, 'hosted-team-logo', { invertWhite: true });
        if (index === 0) teamWrap.append(logo, score);
        else teamWrap.append(score, logo);
        if (team === preview.pickedBy) {
          const marker = document.createElement('span');
          marker.className = 'hosted-map-pick-marker';
          marker.textContent = 'PICK';
          marker.title = `Picked by ${team.name}`;
          index === 0 ? teamWrap.prepend(marker) : teamWrap.appendChild(marker);
        }
        teams.appendChild(teamWrap);
      }
      segment.setAttribute(
        'aria-label',
        `${selection.optionLabel}${preview.pickedBy ? `; picked by ${preview.pickedBy.name}` : map.pick?.type === 'decider' ? '; decider' : '; map pick unavailable'}`,
      );
      segment.append(mapInfo, teams);
      if (preview.pickedBy) {
        const backdrop = document.createElement('span');
        backdrop.className = 'hosted-segment-pick-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        backdrop.appendChild(createTeamLogo(preview.pickedBy.logoUrl, preview.pickedBy.name, 'hosted-team-logo', { invertWhite: true }));
        segment.appendChild(backdrop);
      }
      return segment;
    },
    onSelect,
  );

  const details = document.createElement('section');
  details.className = 'hosted-map-details';
  details.setAttribute('aria-label', 'Selected map details');
  const detailsHeader = document.createElement('div');
  detailsHeader.className = 'hosted-map-details-header';
  const heading = document.createElement('div');
  heading.className = 'hosted-map-heading';
  const detailsBody = document.createElement('div');
  detailsBody.className = 'hosted-map-details-body';
  const watchButton = document.createElement('button');
  watchButton.className = 'hosted-watch';
  watchButton.type = 'button';
  detailsHeader.append(heading, watchButton);
  details.append(detailsHeader, detailsBody);
  section.appendChild(segmentList);
  const summary = document.createElement('div');
  summary.className = 'hosted-match-summary';
  column.append(summary, section, details);

  let currentMatchId;
  const showMatch = (match, event, teamsById) => {
    if (currentMatchId === match.id) return;
    currentMatchId = match.id;
    const eventEl = document.createElement('span');
    eventEl.className = 'hosted-match-summary-event';
    const eventName = document.createElement('span');
    eventName.textContent = event?.name ?? '';
    eventEl.title = eventName.textContent;
    if (event) eventEl.appendChild(createTeamLogo(event.logoUrl, event.name, 'hosted-event-logo', { invertWhite: true }));
    eventEl.appendChild(eventName);
    const teams = document.createElement('span');
    teams.className = 'hosted-match-teams';
    teams.append(
      createMatchTeam(teamsById.get(match.team1Id), match.team1Id),
      createMatchCenter(match),
      createMatchTeam(teamsById.get(match.team2Id), match.team2Id),
    );
    summary.replaceChildren(eventEl, teams);
  };

  let currentSegmentId;
  let abortController;
  let cachedSummary;
  const summaryCache = new Map();
  const sortState = { column: 'kills', direction: 'descending' };

  return {
    element: column,
    update: (options, selectedId, disabled) => {
      column.style.setProperty('--map-count', String(options.length));
      update(options, selectedId, disabled);
    },
    watch: watchButton,
    showMatch,
    showDetails: ({ selection, map }, match, teamsById) => {
      if (currentSegmentId === selection.id) return;
      abortController?.abort();
      currentSegmentId = selection.id;
      cachedSummary = undefined;

      const title = document.createElement('h4');
      title.className = 'hosted-map-details-title';
      title.textContent = prettyMapName(map.name);
      const headingCopy = document.createElement('div');
      headingCopy.className = 'hosted-map-heading-copy';
      headingCopy.appendChild(title);
      heading.replaceChildren(createMapIcon(map.name, prettyMapName(map.name)), headingCopy);

      detailsBody.scrollTop = 0;
      detailsBody.scrollLeft = 0;

      if (!map.summary) {
        detailsBody.replaceChildren(
          createHostedStatus(
            map.summaryUnavailableReason
              ? `Statistics unavailable: ${map.summaryUnavailableReason}`
              : 'Statistics have not been published for this map yet.',
          ),
        );
        return;
      }

      const summaryMeta = map.summary;
      const cacheKey = `${match.id}:${map.id}:${summaryMeta.url}:${summaryMeta.sha256}`;

      const applySummary = (data) => {
        cachedSummary = data;
        const preview = buildMapPreview(match, map, teamsById, data);
        detailsBody.replaceChildren(createMapScoreboard(preview, sortState), createRoundHistory(preview));
      };

      const loadSummary = () => {
        const cached = summaryCache.get(cacheKey);
        if (cached) {
          applySummary(cached);
          return;
        }
        abortController?.abort();
        const controller = new AbortController();
        abortController = controller;
        detailsBody.replaceChildren(createHostedStatus('Loading map statistics…', true));
        fetchMapStatistics(match, map, controller.signal)
          .then((data) => {
            if (controller.signal.aborted || currentSegmentId !== selection.id) return;
            summaryCache.set(cacheKey, data);
            applySummary(data);
          })
          .catch((err) => {
            if (controller.signal.aborted || currentSegmentId !== selection.id) return;
            console.error('[csplayer] map statistics failed:', err);
            const status = createHostedStatus(err instanceof Error ? err.message : 'Map statistics could not be loaded.');
            const retry = document.createElement('button');
            retry.className = 'hosted-retry';
            retry.type = 'button';
            retry.textContent = 'Retry statistics';
            retry.addEventListener('click', loadSummary);
            status.appendChild(retry);
            detailsBody.replaceChildren(status);
          });
      };
      loadSummary();
    },
    getSummary: () => cachedSummary,
    dispose: () => {
      abortController?.abort();
      summaryCache.clear();
      cachedSummary = undefined;
    },
  };
}

/** 创建「Mock」徽章 */
function createMockBadge() {
  const badge = document.createElement('span');
  badge.className = 'hosted-map-mock-badge';
  badge.textContent = 'Mock';
  badge.title =
    'Map picks, player statistics and round history are illustrative mock data; final scores are from the catalogue.';
  badge.setAttribute('aria-label', badge.title);
  return badge;
}

// 回合结束原因的显示文案与图标
const ROUND_REASON_LABELS = {
  elimination: 'elimination',
  bomb: 'bomb explosion',
  defuse: 'bomb defuse',
  time: 'time expiry',
  unknown: 'an unclassified win condition',
};
const ROUND_REASON_ICONS = { elimination: 'skull', bomb: 'planted_c4', defuse: 'defuser' };

/** 创建回合历史表格 */
function createRoundHistory(preview) {
  const section = document.createElement('section');
  section.className = 'hosted-round-history';
  section.setAttribute('aria-label', preview.mock ? 'Round history, mock data' : 'Round history');

  const heading = document.createElement('div');
  heading.className = 'hosted-round-history-heading';
  const title = document.createElement('h5');
  title.textContent = 'Round history';
  heading.appendChild(title);
  if (preview.mock) heading.appendChild(createMockBadge());
  section.appendChild(heading);

  const rounds = preview.rounds;
  if (!rounds?.length) {
    const empty = document.createElement('p');
    empty.className = 'hosted-round-history-empty';
    empty.textContent = rounds ? 'No scored rounds for this map.' : 'Round history needs a published map score.';
    section.appendChild(empty);
    return section;
  }

  const legend = document.createElement('span');
  legend.className = 'hosted-round-history-legend';
  for (const side of ['ct', 't']) {
    const item = document.createElement('span');
    item.className = `hosted-round-${side}`;
    item.textContent = side.toUpperCase();
    legend.appendChild(item);
  }
  heading.appendChild(legend);

  const scroll = document.createElement('div');
  scroll.className = 'hosted-round-history-scroll';
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute(
    'aria-label',
    `${preview.mock ? 'Mock round' : 'Round'} results; scroll horizontally to see every round`,
  );

  const table = document.createElement('table');
  table.className = 'hosted-round-history-table';
  table.setAttribute('aria-label', `${preview.mock ? 'Mock round' : 'Round'} winners and win reasons`);
  table.style.setProperty('--round-history-width', `${2.5 + rounds.length * 1.4}rem`);

  const headerRow = table.createTHead().insertRow();
  const teamColHeader = document.createElement('th');
  teamColHeader.scope = 'col';
  teamColHeader.setAttribute('aria-label', 'Team');
  headerRow.appendChild(teamColHeader);
  for (const round of rounds) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = String(round.number);
    th.title = `Round ${round.number}${round.phase ? ` · ${round.phase}${preview.mock ? ' (mock)' : ''}` : ''}`;
    th.classList.toggle('hosted-round-phase-start', round.number > 1 && round.phase !== undefined);
    headerRow.appendChild(th);
  }

  const body = table.createTBody();
  for (const [teamIndex, team] of preview.teams.entries()) {
    const row = body.insertRow();
    const teamHeader = document.createElement('th');
    teamHeader.scope = 'row';
    teamHeader.setAttribute('aria-label', team.name);
    teamHeader.title = team.name;
    teamHeader.appendChild(createTeamLogo(team.logoUrl, team.name, 'hosted-team-logo', { invertWhite: true }));
    row.appendChild(teamHeader);

    for (const round of rounds) {
      const cell = row.insertCell();
      cell.classList.toggle('hosted-round-phase-start', round.number > 1 && round.phase !== undefined);
      if (round.winner !== teamIndex) continue;
      const win = document.createElement('span');
      win.className = `hosted-round-win hosted-round-${round.side}`;
      win.setAttribute('role', 'img');
      win.setAttribute(
        'aria-label',
        `${preview.mock ? 'Mock · ' : ''}Round ${round.number} · ${team.name} (${round.side.toUpperCase()}) won by ${ROUND_REASON_LABELS[round.reason]} · Score ${round.score[0]}–${round.score[1]}`,
      );
      const icon = document.createElement('span');
      icon.className = 'hosted-round-icon';
      icon.setAttribute('aria-hidden', 'true');
      if (round.reason === 'unknown') {
        icon.classList.add('hosted-round-unknown');
        icon.textContent = '?';
      } else if (round.reason === 'time') {
        icon.classList.add('hosted-round-clock');
      } else {
        icon.style.setProperty('--round-icon', `url("${iconUrl(ROUND_REASON_ICONS[round.reason])}")`);
      }
      win.appendChild(icon);
      cell.appendChild(win);
    }
  }

  scroll.appendChild(table);
  section.appendChild(scroll);
  return section;
}

/** 创建地图计分板表格（可排序） */
function createMapScoreboard(preview, sortState) {
  const table = document.createElement('table');
  table.className = 'hosted-map-scoreboard';
  table.setAttribute('aria-label', preview.mock ? 'Selected map scoreboard, mock player statistics' : 'Selected map scoreboard');

  const colgroup = document.createElement('colgroup');
  for (const cls of ['hosted-scoreboard-player-column', ...[, , , , ,].fill('hosted-scoreboard-stat-column'), 'hosted-scoreboard-team-column']) {
    const col = document.createElement('col');
    col.className = cls;
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);

  const headerRow = table.createTHead().insertRow();
  const sortableColumns = [];
  const sortGroups = [];

  const applySort = () => {
    const parent = table.parentElement;
    const scrollTop = parent?.scrollTop;
    const scrollLeft = parent?.scrollLeft;
    for (const { column, cell, button, title } of sortableColumns) {
      const isCurrent = column === sortState.column;
      isCurrent ? cell.setAttribute('aria-sort', sortState.direction) : cell.removeAttribute('aria-sort');
      const nextDir = isCurrent && sortState.direction === 'descending' ? 'ascending' : isCurrent ? 'descending' : column === 'name' ? 'ascending' : 'descending';
      button.setAttribute('aria-label', `Sort ${title} ${nextDir} within each team`);
    }
    for (const { body, rows, identity } of sortGroups) {
      identity.remove();
      const order = sortScoreboardRows([...rows.keys()], sortState);
      for (const player of order) {
        const row = rows.get(player);
        if (!row) throw Error(`HostedDemoMenu: missing scoreboard row for ${player.name}`);
        body.appendChild(row);
      }
      body.rows[0]?.appendChild(identity);
    }
    if (parent && scrollTop !== undefined && scrollLeft !== undefined) {
      parent.scrollTop = scrollTop;
      parent.scrollLeft = scrollLeft;
    }
  };

  for (const [column, shortLabel, fullLabel] of [
    ['name', 'Player', 'Player name'],
    ['kills', 'K', 'Kills'],
    ['deaths', 'D', 'Deaths'],
    ['assists', 'A', 'Assists'],
    ['kdRatio', 'K/D', 'Kill/death ratio'],
    ['adr', 'ADR', 'Average damage per round'],
  ]) {
    const th = document.createElement('th');
    th.scope = 'col';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hosted-scoreboard-sort';
    button.textContent = shortLabel;
    button.title = fullLabel;
    button.addEventListener('click', () => {
      sortState.direction =
        column === sortState.column
          ? sortState.direction === 'ascending'
            ? 'descending'
            : 'ascending'
          : column === 'name'
            ? 'ascending'
            : 'descending';
      sortState.column = column;
      applySort();
    });
    th.appendChild(button);
    headerRow.appendChild(th);
    sortableColumns.push({ column, cell: th, button, title: fullLabel });
  }

  const teamCol = document.createElement('th');
  teamCol.scope = 'col';
  teamCol.setAttribute('aria-label', 'Team and map score');
  headerRow.appendChild(teamCol);

  for (const [teamIndex, team] of preview.teams.entries()) {
    const tbody = table.createTBody();
    tbody.setAttribute('aria-label', team.name);
    const rows = new Map();
    const identity = document.createElement('th');
    identity.className = 'hosted-scoreboard-identity';
    identity.scope = 'rowgroup';
    identity.rowSpan = team.players.length;
    const stack = document.createElement('div');
    stack.className = 'hosted-scoreboard-team-stack';
    const score = document.createElement('span');
    score.className = 'hosted-scoreboard-score';
    score.textContent = team.score === undefined ? '—' : String(team.score);
    const scoreClass = classifyScore(team.score, preview.teams[1 - teamIndex].score);
    score.classList.add(`hosted-scoreboard-${scoreClass}`);
    stack.append(createTeamLogo(team.logoUrl, team.name, 'hosted-team-logo', { invertWhite: true }), score);
    identity.appendChild(stack);
    identity.setAttribute('aria-label', `${team.name}: ${team.score === undefined ? 'score unavailable' : team.score}`);

    for (const [playerIndex, player] of team.players.entries()) {
      const row = tbody.insertRow();
      rows.set(player, row);
      const nameHeader = document.createElement('th');
      nameHeader.scope = 'row';
      const name = document.createElement('span');
      name.className = 'hosted-scoreboard-player-name';
      name.textContent = player.name;
      name.title = player.name;
      nameHeader.appendChild(name);
      row.appendChild(nameHeader);

      const kdRatio = player.deaths === 0 ? undefined : Number((player.kills / player.deaths).toFixed(2));
      const cells = [
        [String(player.kills)],
        [String(player.deaths)],
        [String(player.assists)],
        [kdRatio === undefined ? '—' : kdRatio.toFixed(2), classifyRatio(kdRatio, 0.95, 1.05)],
        [player.adr.toFixed(1)],
      ];
      for (const [text, cls] of cells) {
        const cell = row.insertCell();
        cell.textContent = text;
        if (cls) cell.classList.add(`hosted-scoreboard-${cls}`);
      }
      if (playerIndex === 0) row.appendChild(identity);
    }
    sortGroups.push({ body: tbody, rows, identity });
  }

  applySort();
  return table;
}

/**
 * 一个可复用的列表渲染器：根据新的 item 列表 diff 更新 DOM，
 * 复用已有节点、增删变化的节点、维护顺序与 active/disabled 状态。
 */
function createReusableList(container, createElement, onSelect) {
  const elements = new Map();
  return (items, selectedId, allDisabled) => {
    const scrollTop = container.scrollTop;
    const ids = new Set(items.map((item) => item.id));
    for (const [id, el] of elements) {
      if (!ids.has(id)) {
        el.remove();
        elements.delete(id);
      }
    }
    items.forEach((item, index) => {
      let el = elements.get(item.id);
      if (!el) {
        el = createElement(item);
        el.type = 'button';
        el.addEventListener('click', () => onSelect(item.id));
        elements.set(item.id, el);
      }
      el.disabled = allDisabled || item.disabled === true;
      el.classList.toggle('active', item.id === selectedId);
      el.setAttribute('aria-pressed', String(item.id === selectedId));
      const current = container.children.item(index);
      if (current !== el) container.insertBefore(el, current);
    });
    container.scrollTop = scrollTop;
  };
}

/** 创建地图图标（占位文字 + 异步加载地图 logo 图片） */
function createMapIcon(mapName, displayName) {
  const wrapper = document.createElement('span');
  wrapper.className = 'hosted-map-icon';
  const placeholder = document.createElement('span');
  placeholder.textContent = initialLetter(displayName.replace(/^(de|cs|ar|dz|gd|coop)_/i, ''));
  wrapper.appendChild(placeholder);
  loadMapLogo(mapName)
    .then((url) => {
      if (!url || !wrapper.isConnected) return;
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.decoding = 'async';
      img.addEventListener('load', () => wrapper.classList.add('loaded'));
      img.addEventListener('error', () => img.remove());
      wrapper.appendChild(img);
    })
    .catch((err) => {
      console.warn(`[csplayer] map logo failed for ${mapName}:`, err);
    });
  return wrapper;
}

/** 创建选择器 section 的骨架（h3 标题） */
function createPickerSection(label) {
  const section = document.createElement('section');
  section.className = 'hosted-picker';
  const heading = document.createElement('h3');
  heading.className = 'hosted-picker-label';
  heading.textContent = label;
  section.appendChild(heading);
  return section;
}

/** 把一场比赛展开成片段（segment）列表 */
function buildMatchSegments(match, teamNamesById, events, now) {
  if (!matchIsPlayable(match, events, now)) return [];
  const matchLabel = `${teamNamesById.get(match.team1Id) ?? match.team1Id} vs ${teamNamesById.get(match.team2Id) ?? match.team2Id}`;
  return [...match.maps]
    .sort((a, b) => a.order - b.order)
    .flatMap((map) =>
      map.segments.map((segment) => {
        const optionLabel = buildOptionLabel(prettyMapName(map.name), segment.label, map.score?.team1, map.score?.team2);
        return {
          id: `${match.id}:${map.id}:${segment.id}`,
          eventId: match.eventId,
          eventName: events.find((e) => e.id === match.eventId)?.name ?? 'Unknown event',
          matchId: match.id,
          matchLabel,
          mapId: map.id,
          mapName: map.name,
          segmentId: segment.id,
          segmentLabel: segment.label,
          optionLabel,
          displayTitle: `${matchLabel} — ${optionLabel}`,
          artifactUrl: segment.artifactUrl,
          artifactSha256: segment.artifactSha256,
          artifactBytes: segment.artifactBytes,
          formatVersion: segment.formatVersion,
        };
      }),
    );
}

/** 构建片段选项标签（地图名 + 可选比分） */
function buildOptionLabel(mapName, segmentLabel, team1Score, team2Score) {
  const base = mapName.localeCompare(segmentLabel, undefined, { sensitivity: 'accent' }) === 0 ? mapName : `${mapName} — ${segmentLabel}`;
  const score = team1Score === undefined || team2Score === undefined ? undefined : `${team1Score}-${team2Score}`;
  return score ? `${base} (${score})` : base;
}

/** 判断比赛是否可播放（已开赛且已过 playedAt） */
function matchIsPlayable(match, events, now) {
  const event = events.find((e) => e.id === match.eventId);
  return !event || event.status === 'upcoming' ? false : Date.parse(match.playedAt) <= now;
}

/** 保留当前选中项（若仍存在且未禁用），否则取第一个可用项 */
function keepOrFirst(items, currentId) {
  if (currentId && items.some((item) => item.id === currentId && !item.disabled)) return currentId;
  return items.find((item) => !item.disabled)?.id ?? items[0]?.id;
}

/** 创建状态提示元素 */
function createHostedStatus(message, busy = false) {
  const el = document.createElement('div');
  el.className = 'hosted-status';
  el.textContent = message;
  el.setAttribute('role', 'status');
  if (busy) el.setAttribute('aria-busy', 'true');
  return el;
}

/** 把 de_xxx 之类的地图名转成「Xxx」形式的展示名 */
function prettyMapName(name) {
  return (
    name
      .replace(/^(de|cs|ar|dz|gd|coop)_/i, '')
      .split('_')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ') || name
  );
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function formatDate(value) {
  if (value) return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });
  return undefined;
}
function firstSentence(value) {
  return value?.split(/[.!?](?:\s|$)/, 1)[0]?.trim() || undefined;
}
/** 事件起止日期范围（同年同月则合并显示） */
function formatDateRange(event) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${formatDate(event.startsAt)}–${formatDate(event.endsAt)}`;
}
function initialLetter(value) {
  return value ? value.charAt(0).toUpperCase() : '';
}

// ── 落地页背景 clip（CSBG 格式）解码器 ─────────────────────────────────────────

const BACKDROP_HEADER_SIZE = 12;
const BACKDROP_FRAME_STRIDE = 8;

/**
 * 解码一个「backdrop clip」二进制文件（CSBG 格式）。
 * 这是落地页背景动画的数据源：一段简化的比赛回放，
 * 只含玩家位置/朝向/队伍，用于在 3D 场景里渲染小人在 Mirage 上走动。
 *
 * 格式：
 *   字节 0-3: 魔数 "CSBG"
 *   字节 4:   版本（必须为 1）
 *   字节 5:   玩家数量
 *   字节 6:   采样率（帧/秒）
 *   字节 7:   保留
 *   字节 8-9: 帧数（uint16 LE）
 *   字节 10+: 每玩家 1 字节的队伍标记
 *   然后每帧每玩家 8 字节：位置 xyz（int16*3）+ 朝向（uint8）+ 标志（uint8）
 */
function decodeBackdropClip(buffer, smoothing = 2.2) {
  const view = new DataView(buffer);
  if (buffer.byteLength < BACKDROP_HEADER_SIZE) throw Error('Backdrop clip is truncated');
  if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== 'CSBG') {
    throw Error('Not a backdrop clip');
  }
  if (view.getUint8(4) !== 1) throw Error(`Unsupported backdrop clip version ${view.getUint8(4)}`);

  const playerCount = view.getUint8(5);
  const sampleRate = view.getUint8(6);
  const frameCount = view.getUint16(8, true);
  if (playerCount === 0 || sampleRate === 0 || frameCount < 2) throw Error('Backdrop clip is empty');

  const dataStart = BACKDROP_HEADER_SIZE + playerCount;
  if (buffer.byteLength < dataStart + frameCount * playerCount * BACKDROP_FRAME_STRIDE) {
    throw Error('Backdrop clip is truncated');
  }

  const teams = new Uint8Array(buffer.slice(BACKDROP_HEADER_SIZE, dataStart));
  const totalSamples = frameCount * playerCount;
  const positions = new Float32Array(totalSamples * 3);
  const yaws = new Float32Array(totalSamples);
  const flags = new Uint8Array(totalSamples);

  for (let sample = 0; sample < totalSamples; sample++) {
    const offset = dataStart + sample * BACKDROP_FRAME_STRIDE;
    positions[sample * 3] = view.getInt16(offset, true);
    positions[sample * 3 + 1] = view.getInt16(offset + 2, true);
    positions[sample * 3 + 2] = view.getInt16(offset + 4, true);
    yaws[sample] = (view.getUint8(offset + 6) / 256) * Math.PI * 2;
    flags[sample] = view.getUint8(offset + 7);
  }

  const clip = {
    playerCount,
    sampleRate,
    frameCount,
    duration: (frameCount - 1) / sampleRate,
    teams,
    positions,
    yaws,
    flags,
    focus: new Float32Array(frameCount * 3), // 每帧的相机焦点
  };

  computeCameraFocus(clip, smoothing);
  return clip;
}

/**
 * 计算每帧的相机焦点（跟随存活玩家的质心，并做双向指数平滑）。
 * 只有 flag 最低位为 1（存活）的玩家计入；flag 第 2 位区分队伍。
 */
function computeCameraFocus(clip, smoothing) {
  const { playerCount, frameCount, teams, positions, flags, focus } = clip;
  let current = [0, 0, 0];
  let hasFocus = false;

  for (let frame = 0; frame < frameCount; frame++) {
    const centroid = centroidOfTeam(frame, true) ?? centroidOfTeam(frame, false);
    if (centroid) {
      current = [centroid[0], centroid[1], centroid[2]];
      if (!hasFocus) {
        for (let f = 0; f < frame; f++) focus.set(centroid, f * 3);
        hasFocus = true;
      }
    }
    focus[frame * 3] = current[0];
    focus[frame * 3 + 1] = current[1];
    focus[frame * 3 + 2] = current[2];
  }

  if (smoothing <= 0) return;
  // 双向指数平滑（1 - exp(-1/(sampleRate * smoothing))）
  const alpha = 1 - Math.exp(-1 / (clip.sampleRate * smoothing));
  for (let axis = 0; axis < 3; axis++) {
    for (let frame = 1; frame < frameCount; frame++) {
      const i = frame * 3 + axis;
      focus[i] = focus[i - 3] + (focus[i] - focus[i - 3]) * alpha;
    }
    for (let frame = frameCount - 2; frame >= 0; frame--) {
      const i = frame * 3 + axis;
      focus[i] = focus[i + 3] + (focus[i] - focus[i + 3]) * alpha;
    }
  }

  /** 计算某帧某个队伍存活玩家的质心 */
  function centroidOfTeam(frame, preferCT) {
    let x = 0;
    let y = 0;
    let z = 0;
    let count = 0;
    for (let player = 0; player < playerCount; player++) {
      const sample = frame * playerCount + player;
      if (flags[sample] & 1) {
        // 存活；preferCT 时优先 CT 队（team === 2），否则只算非 CT 队
        if (preferCT && teams[player] !== 2) continue;
        x += positions[sample * 3];
        y += positions[sample * 3 + 1];
        z += positions[sample * 3 + 2];
        count++;
      }
    }
    return count > 0 ? [x / count, y / count, z / count] : null;
  }
}

/** 计算某时刻（秒）对应的帧插值参数 */
function sampleBackdropFrame(clip, timeSeconds) {
  const rawFrame = Math.min(Math.max(timeSeconds * clip.sampleRate, 0), clip.frameCount - 1);
  const frame = Math.min(Math.floor(rawFrame), clip.frameCount - 2);
  return { frame, next: frame + 1, t: rawFrame - frame };
}
