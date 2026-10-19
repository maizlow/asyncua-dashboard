import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import type { Plugin } from 'vite'
import { parse as parseYaml } from 'yaml'
import { displayViews, toDocument } from './src/layout/doc'

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
      // `…/file.yaml?doc`: the whole document for the demo editor (connection URLs replaced, the demo
      // never reaches a PLC). Only imported by the demo build (src/editor/backend.ts).
      if (/\.ya?ml\?doc$/.test(id)) {
        if (!isDemo) return { code: 'export default {};', map: null }
        type Conn = { url?: string; alarms?: unknown; tags?: Record<string, unknown> }
        type Disp = { screen?: { active?: string; requested?: string } }
        const doc = toDocument(parseYaml(code) ?? {}) as { connections?: Record<string, Conn>; displays?: Record<string, Disp> }
        for (const [did, d] of Object.entries(doc.displays ?? {})) {
          if (d?.screen?.active) d.screen.active = `ns=1;s=Demo.${did}.ActiveScreenNr`
          if (d?.screen?.requested) d.screen.requested = `ns=1;s=Demo.${did}.RequestedScreenNr`
        }
        for (const [cid, c] of Object.entries(doc.connections ?? {})) {
          if (!c || typeof c !== 'object') continue
          c.url = 'opc.tcp://demo.invalid:4840'
          if (c.alarms) c.alarms = `ns=1;s=Demo.${cid}.Alarms`
          // Fake node ids (the public demo shows no real PLC addresses); placeholders stay empty
          for (const [name, spec] of Object.entries(c.tags ?? {})) {
            const fake = `ns=1;s=Demo.${cid}.${name}`
            if (typeof spec === 'string') c.tags![name] = spec.trim() ? fake : spec
            else if (spec && typeof spec === 'object' && 'node' in spec) {
              const t = spec as { node?: string }
              if (t.node?.trim()) t.node = fake
            }
          }
        }
        return { code: `export default ${JSON.stringify(doc)};`, map: null }
      }
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
  // Two pages: the TV view (/) and the layout editor (/editor/)
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        editor: path.resolve(__dirname, 'editor/index.html'),
      },
    },
  },
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