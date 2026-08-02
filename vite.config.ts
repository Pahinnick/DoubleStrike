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
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
