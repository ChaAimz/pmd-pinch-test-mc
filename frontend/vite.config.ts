import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Shared by the dev server (server.proxy) AND the production preview server
// (preview.proxy). The kiosk now serves the production build via `vite preview`
// (start-pinch.bat) — without preview.proxy that server would not forward /api and
// /ws to the FastAPI backend on :8000, so the UI couldn't reach the machine.
const proxy = {
  '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
  '/ws': { target: 'ws://127.0.0.1:8000', ws: true, changeOrigin: true },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: '127.0.0.1',
    proxy,
  },
  // `vite preview` serves the built dist/ on the same host:port the kiosk already
  // points at, with the same proxy as dev.
  preview: {
    host: '127.0.0.1',
    port: 5173,
    proxy,
  },
  build: {
    // The echarts vendor chunk below is ~1.1 MB on its own — that's the full library
    // (all chart types/renderers) via echarts-for-react's default import. Trimming it
    // further means switching to echarts' modular imports, which touches chart init
    // code behind several hard-won touch/zoom/freeze fixes, so we don't chase it here.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // echarts alone accounts for most of the >500kB warning; splitting it (and
        // other rarely-changing vendor code) into its own chunk lets the browser cache
        // it independently of app code, and lets it load in parallel with the rest.
        manualChunks(id) {
          if (id.includes('node_modules/echarts') || id.includes('node_modules/echarts-for-react')) {
            return 'echarts'
          }
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react-router')
          ) {
            return 'react-vendor'
          }
        },
      },
    },
  },
})
