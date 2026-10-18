import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import type { Plugin } from 'vite'
import { parse as parseYaml } from 'yaml'

const isDemo = process.env.VITE_DEMO === 'true'

// Public files that must never ship in the demo build (public GitHub Pages preview)
const DEMO_EXCLUDED_PUBLIC_FILES = ['customerLogo.png']
// Files only needed by the demo build
const NON_DEMO_EXCLUDED_PUBLIC_FILES = ['demoLogo.svg']

function excludePublicFiles(files: string[]): Plugin {
  let outDir = 'dist'
  return {
    name: 'exclude-public-files',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      for (const file of files) fs.rmSync(path.join(outDir, file), { force: true })
    },
  }
}

/**
 * `import layout from "../../dashboard.yaml"` -> plain JSON at build time (used by the demo build,
 * which has no backend). OPC settings and node ids are dropped: the browser only needs screens + tag types.
 */
function dashboardYaml(): Plugin {
  return {
    name: 'dashboard-yaml',
    transform(code, id) {
      if (!id.endsWith('.yaml') && !id.endsWith('.yml')) return null
      const raw = parseYaml(code) ?? {}
      const tags = Object.fromEntries(
        Object.entries(raw.tags ?? {}).map(([name, spec]) => {
          if (spec === null || typeof spec !== 'object') return [name, { placeholder: !String(spec ?? '').trim() }]
          const { node, ...rest } = spec as Record<string, unknown>
          return [name, { ...rest, placeholder: !String(node ?? '').trim() }]
        }),
      )
      return { code: `export default ${JSON.stringify({ screens: raw.screens ?? {}, tags })};`, map: null }
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  // Public base path. "/" for the real deployment; the GitHub Pages workflow sets
  // VITE_BASE=/asyncua-dashboard/ for the demo build.
  base: process.env.VITE_BASE || "/",
  plugins: [
    react(),
    tailwindcss(),
    dashboardYaml(),
    excludePublicFiles(isDemo ? DEMO_EXCLUDED_PUBLIC_FILES : NON_DEMO_EXCLUDED_PUBLIC_FILES),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // dashboard.yaml lives in the project root (one level up)
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://localhost:8000',
        ws: true,
        changeOrigin: true,
      }
    }
  }
})