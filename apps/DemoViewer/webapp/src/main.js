import './style.css';
import { initIObjectBridge, invokeWindow, subscribeHostEvents } from './iobject.js';
import { loadDemoSession } from './demo-session.js';

// M1 验证入口（仅 dev）：控制台 __playerDev.open() 打开 3D 空场景。
// 生产构建不会打进来；M2 接入正式播放流程后删除。
if (import.meta.env.DEV) {
  const { installPlayerDev } = await import('./player/dev.js');
  installPlayerDev();
}

/**
 * DemoViewer 前端壳：initializing → empty state。
 *
 * initializing 不加载任何真实资源，只显示一句固定文案 "Initializing"，
 * 停留 STEP_MS 后切到 empty state（拖放 .dem 文件）。
 *
 * 调试：加 ?screen=empty 直接落在空状态，跳过假初始化。
 */

// 初始化界面（单步骤）：只显示固定文案 "Initializing"，等待该时长后确认 iobject 桥并切屏。
const STEP_MS = 500;

// 加载 .dem 时的阶段文案（进度来自 native Loader 的 progress 通道）。
// 索引对应底部进度点，stage 顺序与 LoadStage 一致。
const LOADING_STEPS = [
  'Loading demo',
  'Parsing match data',
  'Building scoreboard',
  'Preparing replay',
];
const LOADING_MS = 2000;
const STAGE_INDEX = { idle: 0, parsing: 1, filling: 2, done: 3, error: 1 };
const STAGE_TEXT = {
  idle: 'Loading demo',
  parsing: 'Parsing match data',
  filling: 'Building scoreboard',
  done: 'Preparing replay',
  error: 'Parse failed',
};

const initializingScreen = document.querySelector('#screen-initializing');
const emptyScreen = document.querySelector('#screen-empty');
const loadedScreen = document.querySelector('#screen-loaded');
const watchScreen = document.querySelector('#screen-watch');
const blockedScreen = document.querySelector('#screen-blocked');
const versionEl = document.querySelector('.version');

// 空状态 / 加载中的 DOM 引用（提前声明，供 playLoading 与调试分支使用）。
const dropzone = document.querySelector('.dropzone');
const dropzoneError = document.querySelector('#dropzone-error');
const loadedFileName = document.querySelector('#loaded-file-name');
const dropzoneLoading = document.querySelector('#dropzone-loading');
const dropzoneLoadingText = document.querySelector('#dropzone-loading-text');
const dropzoneLoadingSteps = document.querySelector('#dropzone-loading .steps');

/** 按数量（重）建进度点，返回当前 dot 列表——点数跟随 LOADING_STEPS.length，增减阶段不用动 HTML */
function renderLoadingDots(count) {
  if (!dropzoneLoadingSteps) return [];
  const n = Math.max(1, count);
  if (dropzoneLoadingSteps.children.length !== n) {
    dropzoneLoadingSteps.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dropzoneLoadingSteps.appendChild(dot);
    }
  }
  return Array.from(dropzoneLoadingSteps.children);
}
renderLoadingDots(LOADING_STEPS.length);  // 初始渲染，与 LOADING_STEPS 对齐

const SCREENS = {
  initializing: initializingScreen,
  empty: emptyScreen,
  loaded: loadedScreen,
  watch: watchScreen,
  blocked: blockedScreen,
};

// 各屏 mark 的「视觉宽度」：initializing 用大 mark（780）；empty 用小 mark 但整屏 scale(1.2)
// 故视觉 480×1.2=576；loaded 用小 mark 1:1 视觉 480。用它算出屏间切换的 LOGO 缩放比例。
const MARK_VISUAL_WIDTH = {
  initializing: 780,
  empty: 576,
  loaded: 480,
};
let currentScreenName = null;
let loadingTimer = null;

function show(name) {
  document.body.classList.toggle('is-initializing', name === 'initializing');
  // 标记当前是否在观看界面：标题栏白条样式挂在 body 上（titlebar 与各屏是
  // 兄弟节点，CSS 后代选择器够不到，只能由 JS 提供状态）。
  document.body.classList.toggle('is-watching', name === 'watch');
  // 版本号只在非观看界面显示；进入观看界面直接隐藏（无动画，直接消失）。
  if (versionEl) versionEl.style.display = name === 'watch' ? 'none' : '';

  const target = SCREENS[name] || emptyScreen;
  const current = document.querySelector('.screen.is-active');

  // 首次（无旧状态）直接显示，无过渡。
  if (!current) {
    target.classList.add('is-active');
    currentScreenName = name;
    return;
  }
  if (current === target) {
    currentScreenName = name;
    return;
  }

  // 交叉过渡：旧屏淡出 + 旧 LOGO 缩放；新屏淡入 + 新 LOGO 从缩放态回弹到正常。
  const oldMark = current.querySelector('.mark');
  const newMark = target.querySelector('.mark');

  // 新屏先激活，随后由 transition 把 opacity 从 0 拉到 1。
  target.classList.add('is-active');

  if (oldMark && newMark) {
    // 缩放比例 = 两屏 mark 视觉宽度之比（如 empty 576 → loaded 480，ratio=1.2）。
    const oldW = MARK_VISUAL_WIDTH[currentScreenName] || 1;
    const newW = MARK_VISUAL_WIDTH[name] || 1;
    const ratio = oldW / newW;

    // 新 LOGO 起点：从旧尺寸回弹到正常。
    newMark.style.transition = 'none';
    newMark.style.transform = `scale(${ratio})`;
    void newMark.offsetWidth; // 强制重排，确保起始态被渲染
    newMark.style.transition = '';
    newMark.style.transform = 'scale(1)';

    // 旧 LOGO 终点：缩向目标尺寸（方向相反）。
    oldMark.style.transform = `scale(${1 / ratio})`;
  }

  current.classList.remove('is-active');
  currentScreenName = name;
}

/* ----------------------------------------------------------------------
 * 运行环境门禁：只允许在 ShinPlayer WebView2 宿主内运行。
 *   第一层：window.chrome.webview 是 WebView2 宿主的标志，普通浏览器/静态服务器没有。
 *   第二层：iobject 桥握手成功（Connect + getChildItem('Webview')）才放行，
 *           挡住「其他 WebView2 宿主」（它们没有对应 domain / 对象树）。
 * -------------------------------------------------------------------- */
const params = new URLSearchParams(window.location.search);
const requestedScreen = params.get('screen');

if (typeof window.chrome?.webview === 'undefined') {
  // 非法环境：立即拦截，不跑假初始化，避免泄露 UI。
  show('blocked');
} else {
  startBoot(requestedScreen);
}

async function startBoot(requestedScreen) {
  // 订阅宿主事件（窗口关闭请求 / 文件选中 / 上传完成），替代 chrome.webview 文本监听。
  subscribeHostEvents({
    // 标题栏 X / 任务栏「关闭窗口」：不做二次确认，直接放行关闭。
    // 宿主收到 WM_CLOSE 时会先拦一次并回推 WindowCloseRequested，这里立刻回
    // confirm-exit（→ WebviewShell::ConfirmExit）即完成关闭。
    onWindowCloseRequested: () => postWindow('confirm-exit'),
    onFileSelected: ({ path, canceled }) => {
      if (path) loadDemo(path);
      else if (canceled) clearLoadError();
    },
    onFileUploaded: ({ name, size }) => {
      console.log('[DemoViewer] 上传完成:', name, size);
    },
  }).catch((err) => console.warn('[DemoViewer] 订阅宿主事件失败:', err));

  // 后台连接 iobject 桥（幂等，失败会内部重试）。
  const bridgeReady = initIObjectBridge();

  if (requestedScreen === 'empty' || requestedScreen === 'loaded' || requestedScreen === 'watch') {
    // 调试：?screen=empty / ?screen=loaded / ?screen=watch 直落对应状态，跳过假初始化。
    show(await isAuthorized(bridgeReady) ? requestedScreen : 'blocked');
    return;
  }
  if (requestedScreen === 'loading') {
    // 调试：?screen=loading 显示空状态，并在 dropzone 内播放加载中动画（2 秒后进 File Loaded）。
    if (!(await isAuthorized(bridgeReady))) { show('blocked'); return; }
    show('empty');
    playLoading(() => show('loaded'));
    return;
  }

  // 正常：单步初始化 → 展示 STEP_MS 后确认 iobject 桥 → empty 或 blocked。
  show('initializing');
  setTimeout(() => {
    isAuthorized(bridgeReady).then((ok) => show(ok ? 'empty' : 'blocked'));
  }, STEP_MS);
}

// 在超时内等 iobject 桥握手成功；成功 true，失败/超时 false。
async function isAuthorized(bridgePromise, timeoutMs = 6000) {
  try {
    await Promise.race([
      bridgePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('host verify timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------------------
 * 自定义标题栏：最小化 / 最大化 / 关闭 / 拖拽移动
 * 通过 iobject 桥（WebviewHost::Invoke）驱动 native 侧窗口操作。
 * 窗口命令 fire-and-forget；begin-drag 的 native 侧是同步模态循环，必须不等待响应。
 * -------------------------------------------------------------------- */

// 窗口命令 → WebviewHost::Invoke 方法名映射。
const WINDOW_METHOD = {
  minimize: 'Minimize',
  'toggle-maximize': 'ToggleMaximize',
  close: 'Close',
  'begin-drag': 'BeginDrag',
  'confirm-exit': 'ConfirmExit',
};

async function postWindow(action) {
  try {
    const method = WINDOW_METHOD[action];
    if (!method) {
      console.warn('[DemoViewer] 未知窗口命令:', action);
      return;
    }
    await invokeWindow(method, {});
  } catch (err) {
    console.warn('[DemoViewer] 窗口命令走 iobject 失败:', action, err);
  }
}

const btnMinimize = document.querySelector('#btn-minimize');
const btnMaximize = document.querySelector('#btn-maximize');
const btnClose = document.querySelector('#btn-close');
const titlebar = document.querySelector('#titlebar');

let maximized = false;
const ICON_MAX = '\u25a1';  // □
const ICON_RESTORE = '\u2750';  // ❐

btnMinimize?.addEventListener('click', () => postWindow('minimize'));

btnClose?.addEventListener('click', () => postWindow('close'));

function toggleMaximize() {
  postWindow('toggle-maximize');
  // 本地镜像最大化状态，切换图标（□ / ❐）。
  maximized = !maximized;
  btnMaximize.textContent = maximized ? ICON_RESTORE : ICON_MAX;
}

btnMaximize?.addEventListener('click', toggleMaximize);

// 标题栏空白区域按下 → 等鼠标真正移动后再触发 native 的系统级拖拽。
// 不能在 mousedown 立即 begin-drag：native 的拖拽是同步模态循环（SendMessage
// WM_NCLBUTTONDOWN），会吞掉第二次点击，页面 dblclick 永远收不到 → 双击最大化失效。
const DRAG_THRESHOLD = 4;  // px 死区
let dragPending = false;
let dragStartX = 0;
let dragStartY = 0;

function startPendingDrag(event) {
  if (event.button !== 0) return;                        // 仅响应左键
  if (event.target.closest('.win-btn')) return;          // 按钮不触发拖拽
  dragPending = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
}

titlebar?.addEventListener('mousedown', startPendingDrag);
// 比分面板与标题条视觉一体且无互动元素，整块作为可拖拽区域
// （面板 z-index 高于 titlebar，mousedown 不会冒泡到 titlebar，须单独绑定）。
document.querySelector('.scorebar')?.addEventListener('mousedown', startPendingDrag);

window.addEventListener('mousemove', (event) => {
  if (!dragPending) return;
  const dx = event.clientX - dragStartX;
  const dy = event.clientY - dragStartY;
  if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
  dragPending = false;
  postWindow('begin-drag');
});

window.addEventListener('mouseup', () => {
  dragPending = false;
});

// 标题栏空白区域双击 → 最大化 / 还原（与原生标题栏行为一致）。
titlebar?.addEventListener('dblclick', (event) => {
  if (event.target.closest('.win-btn')) return;   // 按钮上双击不触发
  if (watchScreen?.classList.contains('is-cinema')) return;  // 电影模式下禁止双击最大化/还原
  toggleMaximize();
});
// 比分面板双击同上（与标题条一体的行为）。
document.querySelector('.scorebar')?.addEventListener('dblclick', (event) => {
  if (watchScreen?.classList.contains('is-cinema')) return;
  toggleMaximize();
});

/* ----------------------------------------------------------------------
 * 空状态：
 *   · 点击 dropzone → 弹原生「打开 .dem」对话框（native IFileOpenDialog）。
 *   · 拖放 .dem 到 dropzone → 用 postMessageWithAdditionalObjects 把 File 对象
 *     原样传给 native（不读内容），native 经 ICoreWebView2File.Path 拿绝对路径自己读文件。
 * -------------------------------------------------------------------- */
dropzone?.addEventListener('click', async () => {
  try {
    // 走 iobject 的 OpenFileDialog：native 弹框后把 path/canceled 直接回填，无需再等 fileSelected 事件。
    const res = await invokeWindow('OpenFileDialog', {});
    if (res?.path) {
      loadDemo(res.path);
    } else {
      clearLoadError();  // 用户取消对话框：清掉错误红字，恢复默认状态
    }
  } catch (err) {
    console.warn('[DemoViewer] 打开文件对话框失败:', err);
  }
});

// 拖放：前端只做视觉反馈 + 把 File 对象交给 native，绝不读文件内容。

// 全局兜底：文件拖到非 dropzone 区域时，阻止 WebView2 的默认行为
// （默认会导航/用系统程序打开该文件，弹出文件窗口）。只拦截，不做任何处理。
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

let dragDepth = 0;
dropzone?.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  dropzone.classList.add('dragover');
});
dropzone?.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';   // 光标变「可复制」，提示可松手
});
dropzone?.addEventListener('dragleave', () => {
  dragDepth -= 1;
  if (dragDepth <= 0) {
    dragDepth = 0;
    dropzone.classList.remove('dragover');
  }
});
dropzone?.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('dragover');

  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  if (!/\.dem$/i.test(file.name)) return;   // 只认 .dem

  const wv = window.chrome?.webview;
  if (typeof wv?.postMessageWithAdditionalObjects === 'function') {
    wv.postMessageWithAdditionalObjects({ type: 'window', action: 'drop-file' }, [file]);
  } else {
    console.warn('[DemoViewer] 当前 WebView2 Runtime 不支持 postMessageWithAdditionalObjects');
  }
});

/* ----------------------------------------------------------------------
 * 拖放 .dem 加载入口：native 回推 fileSelected，汇聚到这里。
 * （文件对话框已改走 iobject OpenFileDialog 直接拿返回值，不再走此事件。）
 * -------------------------------------------------------------------- */
function showLoadError(reason) {
  if (!dropzoneError) return;
  dropzoneError.textContent = reason;
  dropzoneError.classList.remove('is-visible');
  void dropzoneError.offsetWidth;   // 强制重排，确保动画每次都能重新触发
  dropzoneError.classList.add('is-visible');
}

function clearLoadError() {
  if (!dropzoneError) return;
  dropzoneError.classList.remove('is-visible');
  dropzoneError.textContent = '';
}

// 加载中动画：在 dropzone 内播放 subtitle + 进度点（样式搬自 initializing 的 caption/steps），
// 固定 LOADING_MS 走完，全程停留在空状态屏。
// progress 是 200ms 轮询驱动的，内容没变时必须跳过，否则 fade 动画会一直重播（闪烁）。
let lastLoadingText = null;
let lastLoadingDot = -1;
function setLoadingText(text, index) {
  if (!dropzoneLoadingText) return;
  if (text === lastLoadingText && index === lastLoadingDot) return;
  lastLoadingText = text;
  lastLoadingDot = index;
  dropzoneLoadingText.classList.remove('is-changing');
  void dropzoneLoadingText.offsetWidth;  // 强制重排，让 fade 动画每次都能重新触发
  dropzoneLoadingText.textContent = text;
  dropzoneLoadingText.classList.add('is-changing');
  renderLoadingDots(LOADING_STEPS.length)
    .forEach((dot, i) => dot.classList.toggle('is-on', i === index));
}

function playLoading(onDone) {
  if (loadingTimer) {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }
  dropzone?.classList.add('is-loading');
  let index = 0;
  setLoadingText(LOADING_STEPS[index], index);
  loadingTimer = setInterval(() => {
    index += 1;
    if (index >= LOADING_STEPS.length) {
      clearInterval(loadingTimer);
      loadingTimer = null;
      dropzone?.classList.remove('is-loading');
      if (onDone) onDone();
      return;
    }
    setLoadingText(LOADING_STEPS[index], index);
  }, LOADING_MS / LOADING_STEPS.length);
}

/* ----------------------------------------------------------------------
 * demo 装载：native Loader 节点（真实解析）
 *   Load → progress 轮询 → meta / Scoreboard.rows / summary → 填 File Loaded 卡片
 * -------------------------------------------------------------------- */

/** 当前装载的 demo 会话（meta/rows/summary），OPEN DEMO 进图时用 mapName */
let currentSession = null;

function basename(path) {
  const sep = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return sep >= 0 ? path.slice(sep + 1) : path;
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 填 File Loaded 卡片（数据全部来自 native：meta + Scoreboard rows/summary） */
function fillLoadedCard(session, path) {
  const { meta = {}, rows = {}, summary = {} } = session ?? {};

  if (loadedFileName) loadedFileName.textContent = basename(path).toUpperCase();

  const sizeEl = document.querySelector('#loaded-file-size');
  if (sizeEl) sizeEl.textContent = formatBytes(meta.fileSize);

  const scoreEl = document.querySelector('#loaded-file-score');
  if (scoreEl) {
    scoreEl.textContent = summary.rounds > 0 ? `${summary.t} : ${summary.ct}` : '— : —';
  }

  const mapEl = document.querySelector('#loaded-file-map');
  if (mapEl) {
    const map = (meta.mapName || 'UNKNOWN').toUpperCase();
    mapEl.textContent = `${map} · ${formatDuration(meta.durationSec)}`;
  }

  const rosterEl = document.querySelector('#loaded-roster');
  if (!rosterEl) return;
  // 队内排序：击杀降序 → 助攻降序 → 死亡升序 → id 升序（末位保证完全确定）
  const byImpact = (a, b) =>
    (b.kills ?? 0) - (a.kills ?? 0) ||
    (b.assists ?? 0) - (a.assists ?? 0) ||
    (a.deaths ?? 0) - (b.deaths ?? 0) ||
    (a.id ?? 0) - (b.id ?? 0);
  const left = [...(rows.t ?? [])].sort(byImpact).slice(0, 5);
  const right = [...(rows.ct ?? [])].sort(byImpact).slice(0, 5);
  const stat = (p) => (p ? `${p.kills}/${p.deaths}/${p.assists}` : '');
  const name = (p) => (p?.name ? p.name.toUpperCase() : '');
  const lines = [];
  for (let i = 0; i < Math.max(left.length, right.length, 1); i++) {
    lines.push(`
      <div class="roster-row">
        <span class="roster__name roster__name--l">${name(left[i])}</span><span class="roster__stat roster__stat--l">${stat(left[i])}</span><span class="roster__gap" aria-hidden="true"></span><span class="roster__stat roster__stat--r">${stat(right[i])}</span><span class="roster__name roster__name--r">${name(right[i])}</span>
      </div>`);
  }
  rosterEl.innerHTML = lines.join('');
}

async function loadDemo(path) {
  console.log('[DemoViewer] 开始加载：', path);
  clearLoadError();
  if (loadedFileName) loadedFileName.textContent = basename(path).toUpperCase();

  // 空状态内的加载动画：文案/进度点跟着 native 解析阶段走。
  dropzone?.classList.add('is-loading');
  lastLoadingText = null;  // 新装载：重置去重缓存，开场文案动画必定重播
  lastLoadingDot = -1;
  setLoadingText(STAGE_TEXT.idle, 0);

  try {
    const session = await loadDemoSession(path, (p) => {
      const stage = p.stage || 'parsing';
      setLoadingText(STAGE_TEXT[stage] ?? 'Loading', STAGE_INDEX[stage] ?? 0);
    });
    currentSession = session;
    fillLoadedCard(session, path);
    dropzone?.classList.remove('is-loading');
    show('loaded');
  } catch (err) {
    console.error('[DemoViewer] demo 装载失败:', err);
    dropzone?.classList.remove('is-loading');
    showLoadError(`无法解析该 demo：${err.message}`);
    show('empty');
  }
}

// File Loaded 屏：CANCEL 回到空状态；OPEN DEMO 进入观看界面并按地图名预加载世界。
document.querySelector('#btn-cancel-loaded')?.addEventListener('click', () => show('empty'));

let world = null;         // player/world.js 实例（首次进图时懒加载）
let worldLoading = null;  // 进行中的加载 Promise（防重复进入）
let playbackFeedClose = null; // 回放数据流关闭句柄（重进观看页时重建）
let watchHud = null;      // watch-hud.js 控制器（控制条 + 动态 HUD + KillFeed）

/** 接通回放数据流：节拍 → 实体层位姿 + HUD（比分/计时/击杀流/进度条）。 */
async function startPlaybackFeed() {
  const { openPlaybackFeed } = await import('./playback-feed.js');
  const { createWatchHud } = await import('./watch-hud.js');
  const layer = world.attachEntities();
  if (!watchHud) {
    watchHud = createWatchHud();
    watchHud.bindControls();
  }
  watchHud.setMapName(currentSession?.meta?.mapName);
  if (playbackFeedClose) playbackFeedClose();
  playbackFeedClose = await openPlaybackFeed((snap, state) => {
    layer.update(snap);
    watchHud.update(snap, state);
  });
}

async function enterWatch() {
  show('watch');
  const statusEl = document.querySelector('#watch-status');
  const setStatus = (text, visible = true) => {
    if (!statusEl) return;
    statusEl.hidden = !visible;
    if (visible) statusEl.textContent = text;
  };

  const mapName = currentSession?.meta?.mapName;
  if (!mapName) {
    setStatus('NO MAP IN VIEW');
    return;
  }

  try {
    const mod = await import('./player/world.js');
    const viewport = document.querySelector('.watch-viewport');
    world = mod.openWorld(viewport);
    world.resume();
    if (world.map === mapName && !worldLoading) {
      setStatus('', false); // 同图已在内存：直接看
    } else {
      if (worldLoading) await worldLoading;
      setStatus(`LOADING ${mapName.toUpperCase()}`);
      worldLoading = world.load(mapName, {
        engine: 'auto',
        onProgress: (msg) => setStatus(String(msg).toUpperCase()),
      });
      await worldLoading;
      setStatus('', false);
    }
    // 地图就绪 → 启动播放数据流（节拍驱动实体层；暂停时无节拍、零开销）
    await startPlaybackFeed();
    // 进入观看界面即开始播放（而非暂停），进度条随之实时推进
    watchHud.play().catch((err) => console.warn('[DemoViewer] 自动播放失败:', err.message));
  } catch (err) {
    console.error('[DemoViewer] 地图世界加载失败:', err);
    setStatus(`MAP LOAD FAILED · ${err.message}`.toUpperCase());
  } finally {
    worldLoading = null;
  }
}

document.querySelector('#btn-open-demo')?.addEventListener('click', () => {
  console.log('[DemoViewer] OPEN DEMO → 进入观看界面');
  enterWatch();
});

// 退出二次确认已取消：标题栏 X / 任务栏「关闭窗口」直接关闭窗口（见 startBoot 里的
// onWindowCloseRequested）。ESC 菜单的 EXIT（退出观看）本来就不经过确认，逻辑未变。

/* ----------------------------------------------------------------------
 * 观看界面 · ESC 调试菜单 + 电影裁剪模式
 *   · ESC：开关调试菜单（仅 Watch View 下）。
 *   · CROP：切换电影裁剪模式（上下黑边 → 2.35:1 宽银幕）。
 *   · EXIT：退出观看，回到 File Loaded。
 * 菜单按钮横向排布，EXIT 位于 CROP 右侧（与 Figma 骨架约定一致）。
 * -------------------------------------------------------------------- */
const escMenu = document.querySelector('#esc-menu');
const btnCrop = document.querySelector('#btn-crop');
const btnExit = document.querySelector('#btn-exit');

function setEscMenu(open) {
  escMenu?.classList.toggle('is-open', open);
}

// 幕布收起/展开时长，需与 style.css 里 .cinema-bar 的 transition 保持一致。
const CINEMA_BAR_MS = 1200;
// 退出电影模式时 HUD 恢复的延迟：不必等幕布完全消失（1200ms），
// 幕布收到约一半就提前开始刷 UI，提升切换效率。
const HUD_RESTORE_DELAY_MS = 600;
let hudRestoreTimer = null;

function setCinema(on) {
  if (on) {
    // 进入电影模式：HUD 淡出（0.35s，快）+ 幕布展开（1.2s，慢）。
    watchScreen?.classList.add('is-hud-hidden');
    watchScreen?.classList.add('is-cinema');
    document.body.classList.add('is-hud-hidden');
  } else {
    // 退出电影模式：先收幕布，幕布收到约一半就提前恢复 HUD（提升效率）。
    watchScreen?.classList.remove('is-cinema');
    clearTimeout(hudRestoreTimer);
    hudRestoreTimer = setTimeout(() => {
      watchScreen?.classList.remove('is-hud-hidden');
      document.body.classList.remove('is-hud-hidden');
    }, HUD_RESTORE_DELAY_MS);
  }
  btnCrop?.classList.toggle('is-on', on);
  btnCrop?.setAttribute('aria-pressed', String(on));
  // 电影模式下禁用标题栏按钮（幕布遮蔽时避免误点/误触），退出时恢复；
  // 只禁用按钮本身，titlebar 空白区域的拖拽不受影响。
  if (btnMinimize) btnMinimize.disabled = on;
  if (btnMaximize) btnMaximize.disabled = on;
  if (btnClose) btnClose.disabled = on;
}

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  // 初始化屏/拦截屏里不放菜单；其余屏（empty/loaded/watch）都允许打开。
  if (currentScreenName === 'initializing' || currentScreenName === 'blocked') return;
  setEscMenu(!escMenu?.classList.contains('is-open'));
});

btnCrop?.addEventListener('click', () => {
  setCinema(!watchScreen?.classList.contains('is-cinema'));
  setEscMenu(false); // 点击后关闭菜单，便于观察裁剪效果
});

btnExit?.addEventListener('click', () => {
  setEscMenu(false);
  setCinema(false);
  // 退出观看：暂停渲染（地图世界留在内存，再次进图秒开）
  world?.pause();
  show('loaded');
});

// 3D 测试页已移除（M1 阶段性调试入口，正式播放流程不再需要）。

// dev 调试句柄（仅 dev 构建）：CDP/控制台驱动装载与进图，验证用。
if (import.meta.env.DEV) {
  window.__demoDev = {
    load: (path) => loadDemo(path),
    enterWatch: () => enterWatch(),
    get session() { return currentSession; },
    get world() { return world; },
  };
}

/* ----------------------------------------------------------------------
 * IObject 桥接：连接 native WebviewBridge，拿到 Webview 节点并绑定默认全局热键。
 * （Ctrl+Shift+I → DevTools；后续 title/size/zoom 通道、上传下载、业务对象树都走这里。）
 * 连接由上方 startBoot 的环境门禁负责发起；窗口命令（invokeWindow）按需等待桥就绪。
 * -------------------------------------------------------------------- */
