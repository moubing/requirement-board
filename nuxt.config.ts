import { fileURLToPath } from 'node:url'
import { localDevAuthEnvironment } from './scripts/local-dev-auth'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['@moubing/bing-ui/style.css', '~/assets/css/main.css', '~/assets/css/shell.css', '~/assets/css/workspace.css', '~/assets/css/workbench.css', '~/assets/css/accounts.css', '~/assets/css/editor-workspace.css', '~/assets/css/preferences.css'],
  modules: [],
  hooks: {
    listen(_server, listener) {
      // 此时 Nuxt 已选定实际端口，Nitro 开发服务尚未启动；三处认证校验共用这份进程配置。
      const auth = localDevAuthEnvironment(listener.url, fileURLToPath(new URL('.', import.meta.url)))
      if (!auth) return
      Object.assign(process.env, auth)
      console.info(`[dev-auth] ${auth.BETTER_AUTH_URL}（Cookie：${auth.BETTER_AUTH_COOKIE_PREFIX}）`)
    },
  },
  // shared 由 Nitro 继续打包；保留 Vite 已解析的源路径，避免相对导入被改写到 dist/server/shared。
  vite: { build: { rollupOptions: { makeAbsoluteExternalsRelative: false } } },
  app: {
    head: {
      title: '文档看板',
      link: [
        {
          rel: 'icon',
          type: 'image/x-icon',
          href: '/requirement-board-favicon.ico',
        },
      ],
    },
  },
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://requirement:requirement@localhost:5438/requirement_board',
    public: {
      appName: '文档看板',
      demoSourceUrl: 'https://github.com/moubing/requirement-board',
    },
  },
  nitro: {
    // 网页与 Skill 共用的标注模块须随服务端打包，避免开发模式将相对重导出解析到项目外。
    externals: { inline: [/[/\\]skills[/\\]requirement-board[/\\]scripts[/\\]annotation[^/\\]*\.mjs$/] },
    serverAssets: [{ baseName: 'agent-skill', dir: fileURLToPath(new URL('./skills/requirement-board', import.meta.url)) }],
    experimental: {
      openAPI: true,
      websocket: true,
    },
  },
})
