import { createRequire } from 'node:module'
import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { verifyWorkspaceTaskLists } from './task-lists.mjs'
import { verifyWorkspaceDetails } from './details.mjs'
import { verifyAppSettings } from './app-settings.mjs'
import { verifyUiPages } from './ui-pages.mjs'
import { verifyRelatedDocuments } from './related-documents.mjs'
import { verifyAiAnnotations } from './ai-annotations.mjs'
import { verifyObjectAnnotations } from './object-annotations.mjs'
import { verifyDocumentMetadata } from './document-metadata.mjs'
import { verifyAppShell } from './app-shell.mjs'
import { verifyWorkbenchHome } from './workbench-home.mjs'
import { verifyWorkbenchLayout } from './workbench-layout.mjs'
import { verifyDocumentLayout } from './document-layout.mjs'
import { verifyOperationFeedback } from './operation-feedback.mjs'
import { verifyVersionMarkers } from './version-markers.mjs'
import { measureVersionMarkers } from './version-markers-performance.mjs'
import { verifyWorkspaceNodeVisuals } from './node-visuals.mjs'
import { verifyWorkspaceCallouts } from './callouts.mjs'
import { checkUiWorkspace } from '../../scripts/check-ui-workspace.mjs'
import { verifyWorkspaceCodeBlocks } from './code-blocks.mjs'
import { verifyWorkspaceChapterLinks } from './chapter-links.mjs'
import { verifyWorkspaceTableColumns } from './table-columns.mjs'
import { verifyConsumerAccounts } from './consumer-accounts.mjs'
import { verifyConsumer018 } from './consumer-018.mjs'
import { verifyLoginExperience } from './login-experience.mjs'
import { verifyAccountExperience } from './account-experience.mjs'
import { verifyClickFeedback } from './click-feedback.mjs'

const require = createRequire(import.meta.url)
const viteRequire = createRequire(require.resolve('vitest'))
const nuxtRequire = createRequire(import.meta.resolve('nuxt'))
const vueRequire = createRequire(nuxtRequire.resolve('@nuxt/vite-builder'))
const { createServer } = await import(pathToFileURL(viteRequire.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(vueRequire.resolve('@vitejs/plugin-vue')).href)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const uiCandidate = process.env.BROWSER_TEST_UI_CANDIDATE === '1' ? await checkUiWorkspace() : null
const cacheDir = await mkdtemp(join(tmpdir(), 'requirement-workspace-browser-'))
const runtime = '/tests/browser/workspace-runtime.mjs'
let server, browser
try {
  server = await createServer({ configFile: false, root, cacheDir, define: { 'import.meta.client': 'true' },
    plugins: [{ name: 'workspace-fixture-runtime', enforce: 'pre', transform(code, id) {
      const additions = {
        '/AppHeader.vue': ["", "useAccountAccessState, useRoute"],
        '/AppShell.vue': ["", "useAccountAccessState, useRoute"],
        '/AppSidebar.vue': ["", "useAccountAccessState, useRoute"],
        '/AppUserMenu.vue': ["computed, ref", "useAccountAccessState, useAuthSessionState, navigateTo"],
        '/RequirementQuickSwitcher.vue': ["ref, computed, watch, nextTick, onMounted, onBeforeUnmount", "useRoute, useRouter, useRequestFetch, useRecentRequirements, useRequirementWorkspace"],
        '/pages/requirements/[id].vue': ["", "definePageMeta, useRoute, useFetch"],
        '/ChangePasswordDialog.vue': ["ref, reactive, watch, useId", ""],
        '/AgentTokensPanel.vue': ["ref, reactive, computed, watch, useId, onMounted, onBeforeUnmount", "useRequestURL, $fetch"],
        '/AgentSetupGuide.vue': ["", "useRequestURL"],
        '/AccountApprovalCard.vue': ["", "useRoute, navigateTo, $fetch"],
        '/pages/account.vue': ["", "useAccountAccessState, useHead, $fetch"],
        '/InvitationsPanel.vue': ["ref, reactive, computed, watch, useId, nextTick", "useRequestFetch, useAsyncData, $fetch"],
        '/pages/login.vue': ["", "useRoute, useHead, navigateTo"],
        '/RequestsPanel.vue': ["ref, reactive, computed, watch, useId", "useRequestFetch, useAsyncData, $fetch"],
        '/UsersPanel.vue': ["ref, reactive, computed, useId", "useRequestFetch, useAsyncData, useAccountAccessState, navigateTo, $fetch"],
        '/CreateRequirementDialog.vue': ["ref, reactive, computed, watch, useId", "navigateTo, $fetch"],
        '/pages/index.vue': ["", "useHead, useRequestFetch, useAccountAccessState"],
        '/workbench/WorkflowBoard.vue': ["", "navigateTo"],
        '/workbench/ProjectActivity.vue': ["", "$fetch"],
        '/pages/requirements/index.vue': ["", "useHead, useRoute"],
        '/pages/templates.vue': ["ref, reactive, computed, watch, useId, onMounted, onBeforeUnmount", "useHead, useFetch, onBeforeRouteLeave, $fetch"],
        '/pages/members.vue': ["ref, computed, watch, useId", "useHead, useAccountAccessState, useRequestFetch, useAsyncData, $fetch"],
      }
      for (const [suffix, [vueImports, runtimeImports]] of Object.entries(additions)) {
        if (id.endsWith(suffix)) return code.replace('<script setup lang="ts">', `<script setup lang="ts">\n${vueImports ? `import { ${vueImports} } from 'vue'` : ''}\n${runtimeImports ? `import { ${runtimeImports} } from '${runtime}'` : ''}`)
      }
      if (id.endsWith('/RequirementDetailWorkspace.vue')) return code
        .replace('<script setup lang="ts">', `<script setup lang="ts">\nimport { onMounted, onBeforeUnmount, useId } from 'vue'\nimport { useFetch, useRequestFetch, useHead, useState, navigateTo, useRecentRequirements, useRequirementWorkspace, useAccountAccessState, requirement as fixtureRequirement, $fetch } from '${runtime}'`)
        .replace("from '../../composables/use-requirement-collaboration'", `from '${runtime}'`)
        // 沿用夹具可控的详情 Ref；真实初始加载/返回生命周期由 Nuxt 集成场景验证。
        .replace('const requirement = shallowRef(props.initialRequirement)', 'const requirement = fixtureRequirement')
      if (id.endsWith('/pages/selection-history/[id].vue')) return code
        .replace('<script setup lang="ts">', `<script setup lang="ts">\nimport { useFetch, useHead } from '${runtime}'`)
      if (id.endsWith('/RichRequirementEditor.vue')) return code.replace('<script setup lang="ts">', `<script setup lang="ts">\nimport { inject } from 'vue'\nimport { useRequirementReadingPosition } from '${runtime}'`)
      if (id.endsWith('/use-diff-layout.ts')) return `import { ref, computed, onMounted, onBeforeUnmount } from 'vue'\n${code}`
      if (id.endsWith('/use-agent-token-page.ts')) return `import { $fetch } from '${runtime}'\n${code}`
      if (id.endsWith('/use-app-preferences.ts')) return `import { useCookie, useState } from '${runtime}'\n${code}`
      if (id.endsWith('/use-app-shell.ts')) return `import { useCookie } from '${runtime}'\n${code}`
      if (id.endsWith('/use-board-meta.ts')) return `import { useNuxtApp, useAccountAccessState, useRequestFetch, useState } from '${runtime}'\n${code}`
      if (id.endsWith('/use-workbench-flow.ts')) return `import { useRequestFetch, $fetch } from '${runtime}'\n${code}`
      if (id.endsWith('/use-requirement-cache.ts')) return `import { useAccountAccessState, useState } from '${runtime}'\n${code}`
      if (id.endsWith('/use-recent-requirements.ts')) return `import { useRequestFetch, useState } from '${runtime}'\n${code}`
      if (id.endsWith('/use-paged-requirements.ts') || id.endsWith('/use-requirement-groups.ts')) return `import { useRequestFetch } from '${runtime}'\n${code}`
      if (id.endsWith('/use-app-theme.ts')) return `import { readonly } from 'vue'\nimport { useCookie, useState } from '${runtime}'\n${code}`
      if (id.endsWith('/SaveDocumentTemplateDialog.vue')) return code.replace('<script setup lang="ts">', `<script setup lang="ts">\nimport { $fetch } from '${runtime}'`)
    } }, vue()],
    resolve: { dedupe: ['vue', 'gsap'], alias: { '~~': root, '~': join(root, 'app'), '#shared': join(root, 'shared'), '#app': join(root, runtime.slice(1)), ofetch: join(dirname(nuxtRequire.resolve('ofetch/package.json')), 'dist/index.mjs'),
      ...(uiCandidate ? { '@moubing/bing-ui/style.css': join(uiCandidate.bingUi, 'dist/bing-ui.css'), '@moubing/bing-ui': join(uiCandidate.bingUi, 'dist/index.js') } : {}),
    } },
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_TEST_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 2312, height: 1200 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(15_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const url = `${server.resolvedUrls.local[0]}tests/browser/workspace-fixture.html`
  await page.goto(url)
  await expect(page.locator('.tiptap')).toBeVisible()
  expect(await page.evaluate(() => window.workspaceFixture.revisionRequests)).toEqual([])
  await page.evaluate(() => document.fonts.ready)
  if (process.env.BROWSER_TEST_SCENARIO === 'click-feedback') {
    await verifyClickFeedback(page, url)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'account') {
    await verifyAccountExperience(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'login') {
    await verifyLoginExperience(browser, page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'consumer-018') {
    await verifyConsumer018(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'consumer-accounts') {
    await verifyConsumerAccounts(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'details') {
    await verifyWorkspaceDetails(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'task-lists') {
    await verifyWorkspaceTaskLists(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'table-columns') {
    await verifyWorkspaceTableColumns(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'chapter-links') {
    await verifyWorkspaceChapterLinks(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'code-blocks') {
    await verifyWorkspaceCodeBlocks(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'callouts') {
    await verifyWorkspaceCallouts(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'node-visuals') {
    await verifyWorkspaceNodeVisuals(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'version-markers-performance') {
    await measureVersionMarkers(page, url)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'version-markers') {
    await verifyVersionMarkers(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'object-annotations') {
    await verifyObjectAnnotations(browser, url)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'annotations') {
    await verifyAiAnnotations(browser, url)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'operations') {
    await verifyOperationFeedback(page, url)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'shell') {
    await verifyAppShell(page, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'detail') {
    await verifyDocumentLayout(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'settings') {
    await verifyAppSettings(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'workbench-layout') {
    await verifyWorkbenchLayout(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'workbench') {
    await verifyWorkbenchHome(page, url, screenshot)
    expect(errors).toEqual([])
  } else if (process.env.BROWSER_TEST_SCENARIO === 'pages') {
    await verifyUiPages(page, url, screenshot)
    await verifyWorkbenchHome(page, url, screenshot)
    expect(errors).toEqual([])
  } else {
  await verifyAppShell(page, screenshot)
  await verifyDocumentMetadata(page)
  const original = await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))
  const body = page.getByRole('region', { name: '文档正文', exact: true })
  const outline = page.locator('.requirement-outline')
  await page.getByRole('tab', { name: '目录', exact: true }).click()
  expect((await outline.boundingBox()).width).toBeGreaterThanOrEqual(250)
  expect((await page.locator('.requirement-editor').boundingBox()).x).toBeGreaterThanOrEqual(224)
  await page.evaluate(() => { window.originalEditorElement = document.querySelector('.tiptap') })
  await expect(page.getByRole('button', { name: '历史版本', exact: true })).toHaveCount(0)
  const longHeading = outline.locator('[data-outline-id="heading_8"]')
  expect((await longHeading.locator('.requirement-outline__item-label').boundingBox()).height).toBeGreaterThan(35)
  await longHeading.click()
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(1000)
  await expect(longHeading).toHaveClass(/--active/)
  await expect(page.getByLabel('输入格式状态', { exact: true })).toHaveCount(0)
  const bodyBox = await body.boundingBox()
  expect(bodyBox.y + bodyBox.height).toBeGreaterThan(1170)
  expect(bodyBox.y + bodyBox.height).toBeLessThanOrEqual(1190)

  await page.getByRole('tab', { name: '文档信息', exact: true }).click()
  await expect(outline).toHaveCount(0)
  expect(await page.evaluate(() => window.originalEditorElement === document.querySelector('.tiptap'))).toBe(true)
  const beforeError = await body.boundingBox()
  await page.evaluate(() => window.workspaceFixture.setError('备份失败，当前页面已保留，请重试切换。'))
  await expect(page.locator('.requirement-side .workspace-notice')).toBeVisible()
  expect(await body.boundingBox()).toEqual(beforeError)
  await page.evaluate(() => window.workspaceFixture.setError(''))
  await page.evaluate(() => { window.workspaceFixture.draft.readOnly.value = true })
  await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'false')
  expect(await body.boundingBox()).toEqual(beforeError)
  await page.evaluate(() => { window.workspaceFixture.draft.readOnly.value = false })
  await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'true')

  await screenshot('workspace-wide')
  await verifyRelatedDocuments(page, screenshot)
  if (process.env.BROWSER_TEST_SCENARIO !== 'layout') {
    await verifyAiAnnotations(browser, url)
    await verifyAppSettings(page, url, screenshot)
  }
  await expect(page.getByRole('button', { name: /专注模式|切换文档属性栏/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '文档属性', exact: true })).toHaveCount(0)
  await expect(page.locator('.requirement-side')).toBeVisible()
  await page.getByRole('tab', { name: '文档信息', exact: true }).click()
  await expect(outline).toHaveCount(0)
  await page.getByRole('tab', { name: '文档信息', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: '目录', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(outline).toBeVisible()
  await page.getByRole('button', { name: '收起文档辅助面板', exact: true }).last().click()
  await expect(page.locator('.requirement-side')).toBeHidden()
  await expect(page.getByRole('button', { name: '打开文档信息和目录', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '打开文档信息和目录', exact: true }).click()
  await expect(outline).toBeVisible()
  await page.getByRole('tab', { name: '文档信息', exact: true }).click()
  expect(await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))).toBe(original)

  await page.getByRole('tab', { name: '版本比较', exact: true }).click()
  const diffPanel = page.locator('.rich-diff')
  await expect(diffPanel).toBeVisible()
  expect(await page.evaluate(() => window.workspaceFixture.revisionRequests)).toEqual([])
  async function expectDiffHeight() {
    await expect.poll(async () => {
      const panel = await diffPanel.boundingBox()
      const viewport = await page.getByRole('region', { name: '页面内容', exact: true }).boundingBox()
      return Math.abs(viewport.y + viewport.height - panel.y - panel.height)
    }).toBeLessThanOrEqual(1)
  }
  async function expectDiffHeaderAlignment() {
    const header = await diffPanel.locator('.rich-diff__header').boundingBox()
    const choices = await page.getByRole('region', { name: '版本选择', exact: true }).boundingBox()
    const actions = await diffPanel.locator('.rich-diff__header-actions').boundingBox()
    for (const box of [choices, actions]) {
      expect(box.x).toBeGreaterThanOrEqual(header.x)
      expect(box.x + box.width).toBeLessThanOrEqual(header.x + header.width)
      expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height)
    }
    if (header.width >= 1100) expect(Math.abs(choices.y + choices.height / 2 - actions.y - actions.height / 2)).toBeLessThanOrEqual(1)
  }
  await expectDiffHeight()
  await expectDiffHeaderAlignment()
  for (const viewport of [{ width: 1440, height: 600 }, { width: 1024, height: 760 }, { width: 2312, height: 1200 }]) {
    await page.setViewportSize(viewport)
    await expectDiffHeight()
    await expectDiffHeaderAlignment()
    const panel = await diffPanel.boundingBox()
    const choices = await page.getByRole('region', { name: '版本选择', exact: true }).boundingBox()
    expect(choices.y).toBeGreaterThanOrEqual(panel.y)
  }
  const comparisonPanel = page.getByRole('region', { name: '版本选择', exact: true })
  await expect(comparisonPanel.getByRole('checkbox', { name: '只比较相邻版本', exact: true })).toBeChecked()
  await expect(comparisonPanel.getByRole('button', { name: '旧版本', exact: true })).toBeVisible()
  await expect(comparisonPanel.getByRole('button', { name: '比较目标', exact: true })).toBeVisible()
  await expect(diffPanel.getByRole('button', { name: '旧版本', exact: true })).toHaveCount(1)
  expect((await comparisonPanel.boundingBox()).y).toBeGreaterThanOrEqual((await diffPanel.boundingBox()).y)
  await page.getByRole('button', { name: '旧版本', exact: true }).click()
  const optionDetail = page.locator('.bing-select__option-detail-panel')
  const newestOption = page.getByRole('option', { name: /^v3 / })
  await expect(newestOption).toHaveAccessibleName(/保存人：测试成员/)
  await newestOption.hover()
  await expect(optionDetail).toContainText('版本说明（Commit）：调整目录宽度')
  await expect(optionDetail).toContainText('完善相邻版本比较与版本选项详情。')
  await expect(optionDetail).toContainText('保存人测试成员')
  await expect(optionDetail).toContainText('本版编辑人编辑成员甲、编辑成员乙')
  await screenshot('workspace-version-details')
  await page.keyboard.press('ArrowDown')
  await expect(optionDetail).toContainText('未填写版本说明')
  await expect(optionDetail).toContainText('部分编辑人未记录')
  await page.keyboard.press('End')
  await expect(optionDetail).toContainText('本版编辑人未记录')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '比较目标', exact: true }).click()
  await page.getByRole('option', { name: /^当前草稿/ }).hover()
  await expect(optionDetail).toContainText('尚未保存为正式版本，暂无提交信息。')
  await page.keyboard.press('Escape')
  async function choose(name, option) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('option', { name: option }).click()
  }
  await page.evaluate(() => window.workspaceFixture.failRevision('rev-2'))
  await choose('旧版本', /^v2 /)
  await expect(page.getByRole('status', { name: '版本加载状态', exact: true })).toContainText('版本正文加载失败')
  await page.getByRole('button', { name: '重试加载版本', exact: true }).click()
  await expect(diffPanel).toBeVisible()
  expect(await page.evaluate(() => window.workspaceFixture.revisionRequests)).toEqual(['rev-2', 'rev-2'])
  await expect(page.getByRole('button', { name: '比较目标', exact: true })).toContainText('v3')
  await choose('比较目标', /^v2 /)
  await expect(page.getByRole('button', { name: '旧版本', exact: true })).toContainText('v1')
  await expect(diffPanel).toBeVisible()
  expect(await page.evaluate(() => window.workspaceFixture.revisionRequests)).toEqual(['rev-2', 'rev-2', 'rev-1'])
  await page.getByRole('button', { name: '比较目标', exact: true }).click()
  await expect(page.getByRole('option', { name: /^v1 / })).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByText('只比较相邻版本', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '只比较相邻版本', exact: true })).not.toBeChecked()
  await choose('比较目标', /^v3 /)
  await expect(page.getByRole('button', { name: '旧版本', exact: true })).toContainText('v1')
  expect(await page.evaluate(() => window.workspaceFixture.revisionRequests)).toEqual(['rev-2', 'rev-2', 'rev-1'])
  await page.getByText('只比较相邻版本', { exact: true }).click()
  await expect(page.getByRole('button', { name: '比较目标', exact: true })).toContainText('v2')
  const map = page.locator('.rich-diff__map')
  const marks = map.locator('button')
  await expect(marks).toHaveCount(3)
  const mapBox = await map.boundingBox()
  const markBoxes = await marks.evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom } }))
  expect(markBoxes.every(box => box.top >= mapBox.y && box.bottom <= mapBox.y + mapBox.height + 1)).toBe(true)
  await marks.last().click()
  await expect(page.locator('.rich-diff__nav-count')).toHaveText('3 / 3')
  await expect.poll(() => page.getByRole('region', { name: '版本差异内容', exact: true }).evaluate(element => element.scrollTop)).toBeGreaterThan(1000)
  expect(await map.boundingBox()).toEqual(mapBox)
  expect(await page.getByRole('region', { name: '页面内容', exact: true }).evaluate(element => element.scrollTop)).toBe(0)
  await screenshot('workspace-diff')
  await page.getByRole('tab', { name: '统一', exact: true }).click()
  await marks.first().click()
  await expect(page.locator('.rich-diff__nav-count')).toHaveText('1 / 3')
  await page.getByText('仅变化', { exact: true }).click()
  await expect(page.locator('.rich-diff__row')).toHaveCount(3)
  await expectDiffHeight()

  await page.getByRole('tab', { name: '正文', exact: true }).click()
  expect(await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))).toBe(original)
  await page.evaluate(() => { window.workspaceFixture.operations.failures['POST:/api/requirements/fixture/revisions'] = 1 })
  await page.getByRole('button', { name: '保存版本', exact: true }).click()
  await page.getByRole('button', { name: '确认保存版本', exact: true }).click()
  // 等保存弹窗完成退场，避免它的模态焦点管理与后续抽屉操作重叠。
  await expect(page.getByRole('dialog', { name: '保存正式版本', exact: true })).toHaveCount(0)
  await expect(page.locator('.requirement-side .workspace-notice')).toContainText('模拟请求失败')
  await page.getByRole('button', { name: '关闭操作提示', exact: true }).click()
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.bingTheme = theme, theme)
    for (const width of [1440, 1240, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      if (width <= 960) {
        await expect(page.locator('.requirement-side')).toHaveCount(0)
        await expect.poll(async () => { const box = await body.boundingBox(); return Math.round(box.y + box.height) }).toBe(988)
        const before = await body.boundingBox()
        await page.getByRole('button', { name: '打开文档信息和目录', exact: true }).click()
        await expect(page.getByRole('dialog', { name: '文档辅助面板', exact: true })).toBeVisible()
        expect(await body.boundingBox()).toEqual(before)
        await screenshot(`workspace-drawer-${theme}-${width}`)
        await page.getByRole('tab', { name: '目录', exact: true }).click()
        await expect(outline).toBeVisible()
        await outline.locator('[data-outline-id="heading_4"]').click()
        await expect(page.getByRole('dialog', { name: '文档辅助面板', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: '打开文档信息和目录', exact: true })).toBeFocused()
      }
      await screenshot(`workspace-${theme}-${width}`)
    }
  }
  const beforeRecovery = await body.boundingBox()
  await page.evaluate(() => window.workspaceFixture.setRecovery(true))
  expect(await body.boundingBox()).toEqual(beforeRecovery)
  await page.getByRole('button', { name: '更多文档操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '打开工作区提示', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '工作区提示', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '导出本机副本并载入最新内容', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '工作区提示', exact: true })).toHaveCount(0)
  await page.goto(`${url}?view=history&revision=rev-2`)
  await expect(page.locator('.rich-diff')).toBeVisible()
  await expect(page.locator('.revision-history')).toHaveCount(0)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.bingTheme = theme, theme)
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(comparisonPanel).toBeVisible()
      await expectDiffHeight()
      if (width > 760) await expectDiffHeaderAlignment()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await page.getByRole('button', { name: '旧版本', exact: true }).click()
      await page.getByRole('option', { name: /^v3 / }).hover()
      await expect(optionDetail).toContainText('本版编辑人编辑成员甲、编辑成员乙')
      const detailBox = await optionDetail.boundingBox()
      expect(detailBox.x).toBeGreaterThanOrEqual(0)
      expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(width)
      expect(detailBox.y + detailBox.height).toBeLessThanOrEqual(1000)
      await screenshot(`workspace-compare-${theme}-${width}`)
      await page.keyboard.press('Escape')
    }
  }
  await page.setViewportSize({ width: 390, height: 640 })
  await expectDiffHeight()
  expect((await diffPanel.boundingBox()).height).toBeGreaterThan(0)
  expect((await page.getByRole('region', { name: '版本差异内容', exact: true }).boundingBox()).height).toBeGreaterThan(120)
  await page.getByRole('region', { name: '页面内容', exact: true }).evaluate(element => { element.scrollTop = element.scrollHeight })
  await expectDiffHeight()

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.route('**/uploads/current-change-preview.svg', route => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="220"><rect width="640" height="220" rx="12" fill="#f4f4f5"/><rect x="20" y="20" width="140" height="180" rx="8" fill="#e4e4e7"/><rect x="180" y="20" width="440" height="38" rx="8" fill="#d4d4d8"/><rect x="180" y="76" width="440" height="124" rx="8" fill="#fff"/><path d="M200 100h240m-240 24h330m-330 24h290m-290 24h180" stroke="#cbd5e1" stroke-width="9" stroke-linecap="round"/></svg>' }))
  await page.goto(`${url}?view=diff`)
  await expect(diffPanel).toBeVisible()
  await page.evaluate(() => {
    const paragraph = (id, text) => ({ type: 'paragraph', attrs: { diffId: id }, content: [{ type: 'text', text }] })
    const title = { type: 'heading', attrs: { diffId: 'preview-title', level: 2 }, content: [{ type: 'text', text: '当前变更定位效果' }] }
    const divider = paragraph('preview-divider', '新增内容与布局参考')
    const tail = paragraph('preview-tail', '继续检查下一处变更。')
    window.workspaceFixture.setComparison(
      { type: 'doc', content: [title, paragraph('preview-modified', '版本选择器放在比较区域顶部。'), paragraph('preview-deleted-a', '这里是已经移除的旧提示。'), paragraph('preview-deleted-b', '这条重复说明也不再需要展示。'), divider, tail] },
      { type: 'doc', content: [title, paragraph('preview-modified', '版本选择器与比较操作集中放在顶部工具栏。'), divider, paragraph('preview-inserted', '新增说明：当前变更用左侧蓝线和中间标记定位。'),
        { type: 'image', attrs: { diffId: 'preview-image', src: '/uploads/current-change-preview.svg', width: 640, height: 220, align: 'center' }, content: [{ type: 'imageCaption', content: [{ type: 'text', text: '布局参考' }] }] }, tail] },
    )
  })
  await expect(marks).toHaveCount(3)
  await expect(diffPanel.locator('.diff-block__image img')).toBeVisible()
  await expect.poll(() => diffPanel.locator('.diff-block__image img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  const rows = diffPanel.locator('.rich-diff__row')
  const rowSizes = await rows.evaluateAll(elements => elements.map(element => [element.offsetWidth, element.offsetHeight]))
  const current = diffPanel.locator('.rich-diff__row[aria-current="true"]')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.bingTheme = theme, theme)
    for (const [index, status] of ['modified', 'deleted', 'inserted'].entries()) {
      await marks.nth(index).click()
      await expect(current).toHaveCount(1)
      await expect(current).toHaveClass(new RegExp(`rich-diff__row--${status}`))
      expect(await rows.evaluateAll(elements => elements.map(element => [element.offsetWidth, element.offsetHeight]))).toEqual(rowSizes)
      const styles = await current.evaluate(element => {
        const frame = getComputedStyle(element, '::after')
        const mark = getComputedStyle(element.querySelector('.rich-diff__status'))
        return { borders: [frame.borderTopWidth, frame.borderRightWidth, frame.borderBottomWidth, frame.borderLeftWidth], pointerEvents: frame.pointerEvents, background: mark.backgroundColor, animation: getComputedStyle(element, '::before').animationName }
      })
      expect(styles.borders).toEqual(['0px', '0px', '0px', '3px'])
      expect(styles.pointerEvents).toBe('none')
      expect(styles.background).toBe('rgba(0, 0, 0, 0)')
      expect(styles.animation).toBe('none')
      await screenshot(`workspace-current-${theme}-${status}`)
    }
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: '上一处变更', exact: true }).click()
  expect(await current.evaluate(element => getComputedStyle(element, '::before').animationName)).toBe('diff-current-emphasis')
  await expect.poll(() => current.evaluate(element => Number(getComputedStyle(element, '::before').opacity))).toBe(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('tab', { name: '统一', exact: true }).click()
  await marks.last().click()
  await screenshot('workspace-current-unified')
  await current.getByRole('button', { name: '回退此更改', exact: true }).click()
  await expect(diffPanel.locator('.rich-diff__row--inserted')).toHaveCount(0)

  await page.goto(`${url}?selection=1`)
  await expect(page.getByText('缺少选区上下文，请返回文档页重新选择内容。', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.workspaceFixture.revisionHistoryRequests)).toEqual([])
  const historyContext = await page.evaluate(() => window.workspaceFixture.createSelectionContext())
  await page.goto(`${url}?selection=1&context=${historyContext}`)
  await expect(page.locator('.selection-history-workspace')).toBeVisible()
  await expect(page.getByRole('region', { name: '选区历史版本', exact: true })).toContainText('v1')
  expect(await page.evaluate(() => window.workspaceFixture.revisionHistoryRequests)).toEqual(['/api/requirements/fixture/revisions'])
  await page.reload()
  await expect(page.locator('.selection-history-workspace')).toBeVisible()
  expect(await page.evaluate(() => window.workspaceFixture.revisionHistoryRequests)).toHaveLength(1)

  await page.goto(`${url}?fill=1`)
  await expect(page.locator('.rich-diff--fill')).toBeVisible()
  await expect(page.locator('.rich-diff__map button')).toHaveCount(3)
  expect((await page.locator('.rich-diff__map').boundingBox()).height).toBeLessThan(600)
  await verifyUiPages(page, url, screenshot)
  await verifyWorkbenchHome(page, url, screenshot)
  expect(errors).toEqual([])
  await verifyWorkspaceNodeVisuals(page, url, screenshot)
  expect(errors).toEqual([])
  await verifyWorkspaceTaskLists(page, url, screenshot)
  await verifyWorkspaceDetails(page, url, screenshot)
  expect(errors).toEqual([])
  console.log('工作区无头验证通过：布局、目录、按需加载与重试、版本详情与编辑人、相邻版本、选区历史与刷新、当前变更描边、减少动态效果、全文小地图、提示、明暗主题、窄屏及旧链接。')
  }
  async function screenshot(name) {
    if (!process.env.BROWSER_TEST_ARTIFACT_DIR) return
    await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
    await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `${name}.png`) })
  }
} finally {
  await browser?.close()
  await server?.close()
  const tempRoot = await realpath(tmpdir())
  const actual = await realpath(cacheDir)
  if (!actual.startsWith(`${tempRoot}${sep}`) || !actual.includes('requirement-workspace-browser-')) throw new Error('临时缓存路径校验失败')
  await rm(actual, { recursive: true })
}
