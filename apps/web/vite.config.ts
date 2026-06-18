import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  resolve: {
    // Resolve the workspace packages from source (no separate build step in dev).
    // The frontend only ever pulls @foxschema/shared (browser-safe, no drivers);
    // @foxschema/core is aliased too so any shared-via-core type still resolves.
    alias: [
      { find: '@foxschema/shared', replacement: pkg('../../packages/shared/src/index.ts') },
      { find: '@foxschema/core', replacement: pkg('../../packages/core/src/index.ts') },
    ],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
