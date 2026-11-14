// 视图层：只做「state → DOM」和「DOM → 动作回调」，不持有业务逻辑。
//
// 回调由 main.js 注入（mount(actions)）—— 这样 view 不认识 session / invoke / fetch，
// 换一套交互（比如做成命令行）时这一层可以整个替掉。

import { channelText, hasToken, on, state } from './store.js';
import { bytesToText } from '@shin/webui/bridge/bytes.js';
import { doorsTable } from './mirror.js';
import { DOORS } from './api/constants.js';
import { load as loadStoredToken, mask } from './token.js';

const $ = (id) => document.getElementById(id);

/** 事件条只渲染最近这么多条。总线里的环形缓冲是 2000 条，但没必要全画出来。 */
const FEED_LINES = 120;

const STATUS_TEXT = {
  idle: '未连接',
  connecting: '连接中…',
  open: '已连接',
  closed: '已断开，重连中…',
  error: '连接失败',
};

const STATUS_DOT = { open: 'on', connecting: 'warn', closed: 'warn', error: 'err' };

let actions = null;
let pendingTimer = null;
let feedScheduled = false;

/* ------------------------------------------------------------------ 挂载 */

export function mount(handlers) {
  actions = handlers;
  buildDoors();
  bind();
  on('connection', render);
  on('gate', render);
  on('event', scheduleFeed);
  // 输入框里放的是本地副本（§token.js）：宿主重启后可以直接一键重新注入。
  $('token-input').value = loadStoredToken();
  render();
  renderFeed();
}

function bind() {
  $('btn-connect').onclick = () => actions.connect();
  $('btn-disconnect').onclick = () => actions.disconnect();
  $('btn-set').onclick = () => actions.setSession($('token-input').value);
  $('btn-logout').onclick = () => {
    // 顺便清掉输入框：登出后留着旧 token 会让人以为还能用（通道已经空了）。
    $('token-input').value = '';
    actions.setSession('');
  };
  $('btn-sms').onclick = () => actions.requestSms($('mobile').value.trim());
  $('btn-login').onclick = () => actions.requestLogin($('mobile').value.trim(), $('code').value.trim());
  $('btn-open-custom').onclick = () => actions.requestOpen($('door-custom').value.trim());

  $('token-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-set').click();
  });
  $('code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-login').click();
  });
}

function buildDoors() {
  const host = $('door-list');
  host.textContent = '';
  for (const door of DOORS) {
    const row = document.createElement('div');
    row.className = 'door';

    const btn = document.createElement('button');
    btn.className = 'door-btn';
    btn.dataset.door = door.id;
    btn.textContent = door.label;
    btn.onclick = () => actions.requestOpen(door.id);

    const st = document.createElement('span');
    st.className = 'door-state';
    st.dataset.state = door.id;

    const at = document.createElement('span');
    at.className = 'door-at dim';
    at.dataset.at = door.id;

    row.append(btn, st, at);
    host.append(row);
  }
}

/* ------------------------------------------------------------ 等待态收尾 */

/**
 * 标记"某动作已发出、还没等到回写"。
 *
 * 为什么不看 `invoke()` 的 resolve：它只表示"命令已广播"（§4.4），不代表短信发了、门开了。
 * 所以按钮的收尾只能等**回写**（`Log` / `Doors` 通道变化），配一个超时兜底。
 */
export function markPending(label, ms = 25000) {
  state.pending = { label, at: Date.now() };
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    // 超时也要放开按钮，否则界面会卡在"发送中…"直到刷新。
    state.pending = null;
    render();
  }, ms);
  render();
}

export function clearPending() {
  if (!state.pending) return;
  clearTimeout(pendingTimer);
  state.pending = null;
  render();
}

/** 已发出的动作是否已经收到回写（时间戳比对，避免被 attach 时的初读误清）。 */
export function settled(channel) {
  if (!state.pending) return false;
  const seen = state.gate.seen[channel];
  return !!seen && seen.getTime() >= state.pending.at;
}

/* ------------------------------------------------------------------ 渲染 */

export function render() {
  if (!actions) return;

  const conn = state.connection;
  $('conn-dot').className = 'dot ' + (STATUS_DOT[conn.status] || '');
  $('conn-text').textContent = STATUS_TEXT[conn.status] || conn.status;
  $('conn-target').textContent = conn.url ? conn.url + ' · ' + conn.domain : '';
  $('btn-connect').disabled = conn.status === 'connecting' || conn.status === 'open';
  $('btn-disconnect').disabled = conn.status === 'idle';

  renderSession();
  renderDoors();
}

function renderSession() {
  const token = channelText('SessionToken').trim();
  const view = $('token-view');
  // 只显示头尾：token 是可用凭据，别整串摆在屏幕上；需要全串时用输入框。
  view.textContent = token ? mask(token) : '(未设置)';
  view.title = token;
  view.classList.toggle('dim', !token);

  const info = channelText('SessionInfo');
  let text = '—';
  if (info) {
    try {
      const o = JSON.parse(info);
      text = (o.mobile || '?') + (o.loggedIn ? ' · 已登录' : ' · 未登录');
    } catch {
      text = info;
    }
  }
  $('session-info').textContent = text;

  const pending = state.pending && state.pending.label;
  $('btn-set').disabled = !state.connection.rootAddr;
  $('btn-logout').disabled = !token;
  $('btn-sms').disabled = !!pending || !state.connection.rootAddr;
  $('btn-login').disabled = !!pending || !state.connection.rootAddr;
  $('btn-sms').textContent = pending === 'sms' ? '发送中…' : '发短信';
  $('btn-login').textContent = pending === 'login' ? '登录中…' : '登录';
}

function renderDoors() {
  // 解析规则在 mirror 里（一处），这里只管画。
  const table = doorsTable();

  const waiting = !!state.pending || !hasToken();
  for (const door of DOORS) {
    const rec = table[door.id];
    const st = document.querySelector(`.door-state[data-state="${door.id}"]`);
    const at = document.querySelector(`.door-at[data-at="${door.id}"]`);
    const btn = document.querySelector(`.door-btn[data-door="${door.id}"]`);

    if (rec) {
      st.className = 'door-state ' + (rec.state === 'open' ? 'ok' : 'fail');
      st.textContent = (rec.state === 'open' ? '已开' : '失败')
        + (rec.lastResult != null ? ' · ' + rec.lastResult : '');
    } else {
      st.className = 'door-state';
      st.textContent = hasToken() ? '就绪' : '缺 token';
    }
    at.textContent = rec && rec.at ? hhmmss(new Date(rec.at)) : '';
    btn.disabled = waiting;
  }

  $('btn-open-custom').disabled = waiting;
  $('door-custom').placeholder = 'doorControlId';
}

/* ---------------------------------------------------------------- 事件条 */

function scheduleFeed() {
  if (feedScheduled) return;
  feedScheduled = true;
  requestAnimationFrame(() => {
    feedScheduled = false;
    renderFeed();
  });
}

function renderFeed() {
  const host = $('feed');
  const frag = document.createDocumentFragment();
  for (const rec of state.events.slice(-FEED_LINES)) frag.append(feedLine(rec));
  host.textContent = '';
  host.append(frag);
  const scroller = host.parentElement;
  scroller.scrollTop = scroller.scrollHeight;
}

const hhmmss = (d) => {
  const t = d instanceof Date ? d : new Date(d);
  return [t.getHours(), t.getMinutes(), t.getSeconds()]
    .map((n) => String(n).padStart(2, '0')).join(':');
};

function feedLine(rec) {
  const el = document.createElement('div');
  el.className = 'e ' + (rec.isLog ? (rec.type || 'info') : 'chan');

  const ts = document.createElement('span');
  ts.className = 'ts';
  ts.textContent = hhmmss(rec.ts);

  const tag = document.createElement('span');
  tag.className = 'tag';

  const body = document.createElement('span');
  body.className = 'body';

  if (rec.isLog) {
    tag.textContent = String(rec.type || 'sys').toUpperCase();
    body.textContent = rec.path;
  } else {
    tag.textContent = rec.channel || '?';
    body.textContent = preview(rec.channel, rec.data);
  }

  el.title = body.textContent;
  el.append(ts, tag, body);
  return el;
}

function preview(channel, bytes) {
  const text = bytesToText(bytes ?? undefined);
  if (channel === 'SessionToken') return text ? mask(text) : '(空)';
  return text || '(空)';
}
