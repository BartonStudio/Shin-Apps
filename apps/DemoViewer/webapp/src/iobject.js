import { IObjectClient, utf8Encode, utf8Decode } from 'iobject-js';

const DOMAIN = 'demoviewer';

let client = null;
let webview = null;
let bridgePromise = null;

async function connect(retries = 10) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      client = await IObjectClient.connectWebview({ domain: DOMAIN, openTimeoutMs: 3000 });
      webview = await client.root.getChildItem('Webview');

      // 默认热键：Ctrl+Shift+I → 打开 DevTools。
      // 注意：WebviewHost 的 Invoke 参数/结果都是 JSON 文本（nlohmann::json 解析），
      // 与 ReadData/WriteData 的 MessagePack 编码不同。
      const args = utf8Encode(JSON.stringify({
        modifiers: 'Ctrl+Shift',
        key: 'I',
        action: 'OpenDevTools',
      }));
      const res = JSON.parse(utf8Decode(await webview.invoke('BindHotkey', args)));
      console.log('[DemoViewer] IObject 已连接，默认热键 Ctrl+Shift+I 绑定结果:', res);
      return { client, webview };
    } catch (err) {
      console.warn(`[DemoViewer] IObject 连接失败（第 ${attempt}/${retries} 次）:`, err);
      if (attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error('[DemoViewer] IObject 连接失败');
}

/**
 * 连接 IObject 域（经 WebView2 内进程共享内存通道，无端口），拿到 Webview 节点，
 * 并绑定默认全局热键。
 *
 * native 侧 WebviewBridge 的建立时序可能晚于页面加载（DemoApp 在 Create 之后才
 * Start 建桥、再 Run 跑循环），因此这里带重试：每次失败退避后重连。
 *
 * 幂等：多次调用共享同一次连接尝试，避免重复建桥。
 */
export function initIObjectBridge(retries = 10) {
  if (!bridgePromise) bridgePromise = connect(retries);
  return bridgePromise;
}

/**
 * 等待桥接就绪并返回 Webview 节点（供需要节点对象的调用方使用）。
 * 连接失败 / 超时会抛错，由调用方兜底。
 */
export async function whenWebview() {
  if (webview) return webview;
  await initIObjectBridge();
  return webview;
}

/**
 * 调用 WebviewHost::Invoke 上的一个方法（请求-响应）。
 * args 为普通对象，会被 JSON 序列化；返回宿主回填的 JSON 对象。
 */
export async function invokeWindow(method, args = {}) {
  const wv = await whenWebview();
  const payload = utf8Encode(JSON.stringify(args));
  const res = JSON.parse(utf8Decode(await wv.invoke(method, payload)));
  return res;
}

export function getClient() {
  return client;
}

export function getWebview() {
  return webview;
}

/**
 * 订阅 native 侧发布的宿主事件（一次性业务事件，替代 SendJson 文本通道）。
 *
 * - onWindowCloseRequested()：无载荷（标题栏 X / 任务栏关闭）。
 * - onFileSelected({ path, canceled })：DataChannelChanged + selectedFile 通道。
 * - onFileUploaded({ name, size })：DataChannelChanged + uploadedFile 通道。
 *
 * 事件载荷走 DataChannel 的字节快照（UTF-8 JSON 文本），此处 utf8Decode + JSON.parse。
 * 返回取消函数（幂等）。
 */
export async function subscribeHostEvents(handlers) {
  const wv = await whenWebview();
  const subs = [];

  if (handlers.onWindowCloseRequested) {
    subs.push(await wv.subscribe('WindowCloseRequested', () => {
      handlers.onWindowCloseRequested();
    }));
  }

  // 事件类型语义化：native 发布 fileSelected / fileUploaded 自定义事件类型，
  // 载荷借 DataChannelChangedEventData 携带 channel，跨桥层读通道快照 → event.data。
  if (handlers.onFileSelected) {
    subs.push(await wv.subscribe('fileSelected', (event) => {
      if (!event.data) return;
      handlers.onFileSelected(JSON.parse(utf8Decode(event.data)));
    }));
  }

  if (handlers.onFileUploaded) {
    subs.push(await wv.subscribe('fileUploaded', (event) => {
      if (!event.data) return;
      handlers.onFileUploaded(JSON.parse(utf8Decode(event.data)));
    }));
  }

  return () => { subs.forEach((s) => s.cancel()); };
}
