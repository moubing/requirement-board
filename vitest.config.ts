import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'
import { checkUiWorkspace } from './scripts/check-ui-workspace.mjs'

const nuxtRequire = createRequire(createRequire(import.meta.url).resolve('nuxt/package.json'))

export default defineConfig(async () => {
  const candidate = process.env.BROWSER_TEST_UI_CANDIDATE === '1' ? await checkUiWorkspace() : null
  const vueRequire = createRequire(nuxtRequire.resolve('@nuxt/vite-builder'))
  const { default: vue } = await import(pathToFileURL(vueRequire.resolve('@vitejs/plugin-vue')).href)
  return {
    plugins: [vue()],
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
    resolve: {
      dedupe: ['vue', 'gsap'],
      alias: {
        '~~': fileURLToPath(new URL('./', import.meta.url)),
        '~': fileURLToPath(new URL('./app', import.meta.url)),
        '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
        h3: nuxtRequire.resolve('h3'),
        ...(candidate ? { '@moubing/bing-ui': `${candidate.bingUi}/dist/index.js` } : {}),
      },
    },
  }
})
