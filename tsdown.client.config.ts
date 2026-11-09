import { defineConfig } from 'tsdown'

// Client bundle: CJS with host-provided modules kept external.
// scripts/wrap-client.mjs then wraps it for window.__ModuleLoader__.load().
export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: ['cjs'],
  platform: 'browser',
  dts: false,
  sourcemap: false,
  clean: false,
  outDir: '.client-build',
  outExtensions: () => ({ js: '.cjs' }),
  deps: {
    neverBundle: ['react', 'react-dom', 'react/jsx-runtime', /^@deepseek-ai\//],
    onlyBundle: false,
  },
})
