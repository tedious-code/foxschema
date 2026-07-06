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
    alias: [
      { find: '@foxschema/core', replacement: pkg('../../packages/core/src/browser.ts') },
    ],
    // Force a single copy of React resolved from this app's node_modules. The
    // monorepo also contains the Ink-based CLI, which pins react@18; npm hoists
    // that copy to the repo-root node_modules while nesting web's react@19 under
    // apps/web. Without deduping, react-dom (hoisted to the root) binds to the
    // root react@18 and crashes at runtime ("Cannot read properties of undefined
    // (reading 'S')" — a react/react-dom major mismatch), leaving a blank page.
    dedupe: ['react', 'react-dom'],
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
