import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import type { Plugin } from 'vite'
import { parse as parseYaml } from 'yaml'
import { displayViews } from './src/layout/doc'

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
 * `import views from "../../dashboard.yaml"` -> { displayId: view } at build time (used by the demo
 * build, which has no backend). Same view JSON as GET /api/layout: node ids, URLs and OPC settings
 * are dropped, the browser only gets screens, header and tag types. Accepts dashboard.yaml (v1) and
 * layout documents (schema_version 2), see src/layout/doc.ts.
 */
function dashboardYaml(): Plugin {
  return {
    name: 'dashboard-yaml',
    transform(code, id) {
      if (!id.endsWith('.yaml') && !id.endsWith('.yml')) return null
      return { code: `export default ${JSON.stringify(displayViews(parseYaml(code) ?? {}))};`, map: null }
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