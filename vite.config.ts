/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Electron loads the built index.html via file://, so asset URLs must be
  // relative — root-absolute paths (the default) resolve against the
  // filesystem root and 404 under file://.
  base: './',
  server: {
    // Archidekt's deck API has no permissive CORS headers, so the renderer can't fetch it
    // directly in browser dev. Proxy it server-side; the packaged app uses main-process IPC
    // instead (see src/api/archidekt.ts). changeOrigin so archidekt sees its own Host header.
    proxy: {
      '/archidekt': {
        target: 'https://archidekt.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/archidekt/, ''),
      },
    },
    watch: {
      // Without this, `npm run dev` left running while `npm run electron:pack`/`electron:build`
      // extracts a fresh Electron binary into release/win-unpacked.tmp causes a deterministic
      // (not flaky) `EPERM: rename win-unpacked.tmp -> win-unpacked` on Windows — Vite's watcher
      // holds open handles on the files as electron-builder writes them, and Windows (unlike
      // POSIX) refuses to rename a directory with a file inside it still open elsewhere.
      ignored: ['**/release/**'],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
