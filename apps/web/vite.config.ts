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
      // Only the pure package is aliased. @foxschema/db is deliberately absent:
      // if frontend code ever imports the driver layer, the build fails here
      // instead of silently resolving to something the browser cannot run.
      // This alias and apps/web/tsconfig.json must agree — they used to point
      // '@foxschema/core' at different entry points, so tsc and the bundler
      // disagreed about what the name meant.
      { find: '@foxschema/sql', replacement: pkg('../../packages/sql/src/index.ts') },
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
    // Bind IPv4 + IPv6. Default Node listen can end up on [::1] only, which
    // makes http://127.0.0.1:5173 fail with ERR_CONNECTION_REFUSED.
    host: true,
    port: 5173,
    // Don't silently hop to 5174+ — Cursor / agent previews pin :5173.
    strictPort: true,
    // Cursor / cloud port-forwards send a non-localhost Host header; Vite 8
    // rejects those with 403 ("Blocked request…") → blank page in the browser.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
