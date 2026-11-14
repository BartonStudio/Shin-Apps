import { defineConfig } from 'vite';

// WebView2 宿主（DemoViewer.exe）按固定地址访问，端口锁死 5173、host 用 127.0.0.1
// 避免 localhost 解析到 IPv6 导致 WebView2 连不上。
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
