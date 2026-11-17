import { defineConfig } from 'vite';

// 开发期把素材请求转发给本地镜像服务器（web/serve.mjs，默认 :8123）。
// 生产运行时素材由宿主或静态服务器提供，不依赖这个代理。
// 注意：vite.config.js 优先于 .mjs 被加载，两个文件保持一致（mjs 是备份）。
export default defineConfig({
  server: {
    host: '127.0.0.1', // CEF 宿主与工具链都用 127.0.0.1 访问（默认 ::1 会导致 IPv4 连不上）
    proxy: {
      '/maphost': 'http://127.0.0.1:8123',
      '/cs2': 'http://127.0.0.1:8123',
      '/maps': 'http://127.0.0.1:8123',
    },
  },
});
