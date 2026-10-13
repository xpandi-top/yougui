/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

function gitShort(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'local'
  }
}

// React / MUI / Emotion 必须在同一个 vendor chunk（拆开会有初始化竞态）。
const VENDOR = /[\\/]node_modules[\\/](react|react-dom|scheduler|react-is|@mui|@emotion|@babel[\\/]runtime|stylis|hoist-non-react-statics|prop-types|clsx|@popperjs|react-transition-group)[\\/]/

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE || '/'
  return {
    base,
    define: {
      __BUILD_ID__: JSON.stringify(gitShort()),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['favicon.ico', 'favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'app-icon.svg'],
        manifest: {
          name: '有归 · 家庭收纳',
          short_name: '有归',
          description: '家庭收纳登记：物有归处，一查便知。',
          lang: 'zh-CN',
          start_url: '.',
          scope: '.',
          display: 'standalone',
          background_color: '#F4EFE5',
          theme_color: '#F4EFE5',
          // App 图标定稿：宣纸底、朱砂菱形框、「归」字（源文件在 app-icons/）
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
      }),
    ],
    build: {
      // vendor（React+MUI）与 ZXing 约 500 KB 未压缩；真实预算由 scripts/bundle-budget.mjs 按 gzip 检查
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (VENDOR.test(id)) return 'vendor'
            if (/[\\/]node_modules[\\/]@zxing[\\/]/.test(id)) return 'zxing'
          },
        },
      },
    },
    server: { port: 5180 },
    preview: { port: 4180 },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/__tests__/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      env: { VITE_API_URL: 'off' },
    },
  }
})
