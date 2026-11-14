// ShinGatekeeper 前端 Vite 配置。
// 与 apps/inspector/ui/vite.config.mjs 同构，只差端口 —— 这就是平台抽层的收益：
// 方案配置里没有任何 platform 的路径知识，两条 alias 是照抄的。
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// apps/<app>/ui -> 上溯三层才到仓库根（与 inspector 一致，别少写一层）。
const repoRoot = resolve(here, '..', '..', '..');
const sdkEntry = resolve(repoRoot, 'third_party', 'IObject', 'js', 'src', 'index.ts');
const webuiRoot = resolve(repoRoot, 'platform', 'webui');

export default defineConfig({
  resolve: {
    alias: [
      // 直接引用官方 iobject-js SDK 的 TypeScript 源码；Vite 用 esbuild 即时转译。
      { find: 'iobject-js', replacement: sdkEntry },
      // 平台前端基础设施。正则 find 让 `@shin/webui/state/bus.js` 这类子路径精确落地。
      { find: /^@shin\/webui\//, replacement: webuiRoot + '/' },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 8849,        // 与 apps/gatekeeper/app.json 的 entry.dev 一致（宿主启动 URL 来源于它）
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    rollupOptions: {
      input: resolve(here, 'index.html'),
    },
  },
  appType: 'spa',
});
