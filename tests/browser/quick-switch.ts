import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium, expect, type Page } from '@playwright/test'
import { createTest } from '@nuxt/test-utils/e2e'
import { verifyDocumentMetadataPersistence } from './document-metadata-integration'
import { verifyRequirementPages } from './requirement-pages'
import { verifyWorkbenchIntegration } from './workbench-integration'
import { DOCUMENT_SCHEMA_VERSION } from '../../shared/agent/suggestions'
import { DOCUMENT_NODE_CAPABILITIES } from '../../shared/editor/capabilities'
import { verifyTaskListIntegration } from './task-list-integration'
import { verifyRequirementPerformance } from './requirement-performance'
import { verifyCachedRequirementSafety } from './cached-requirement-safety'
import { verifyRequirementSmoothScroll } from './requirement-smooth-scroll'
import { verifyChapterNavigation } from './chapter-navigation'
import { verifyOperationFeedbackIntegration } from './operation-feedback-integration'
import { checkUiWorkspace } from '../../scripts/check-ui-workspace.mjs'
import { createUiCandidateConfig } from './ui-candidate'
import { verifySearchNavigation } from './search-navigation'
import { verifyDemoIntegration } from './demo-integration'

// 单独的浏览器测试库，不与 API 测试的逐例清库并行冲突。
const database = process.env.BROWSER_TEST_DATABASE_URL ?? 'postgres://requirement:requirement@localhost:5438/requirement_board_browser_test'
const databaseUrl = new URL(database)
if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname) || !databaseUrl.pathname.endsWith('_browser_test')) {
  throw new Error('浏览器验证只允许本机、名称以 _browser_test 结尾的隔离数据库')
}
const port = Number(process.env.BROWSER_TEST_PORT ?? 3137)
const origin = `http://127.0.0.1:${port}`
const uploads = await mkdtemp(join(tmpdir(), 'requirement-quick-switch-'))
const environment = {
  TEST_DATABASE_URL: database, DATABASE_URL: database,
  BETTER_AUTH_SECRET: 'requirement-browser-fixture-secret-123456789', BETTER_AUTH_URL: origin,
  ASSET_STORAGE_DRIVER: 'local', ASSET_UPLOAD_DIR: uploads,
}
Object.assign(process.env, environment)
const { prepareTestDatabase, resetTestDatabase, TEST_USER_PASSWORD, TEST_ADMIN_PASSWORD } = await import('../setup/db')
// 仅供发布前联调；正式应用始终依赖 npm 包，不修改安装目录或机器专属配置。
const uiCandidate = process.env.BROWSER_TEST_UI_CANDIDATE === '1' ? await checkUiWorkspace() : null
const fixture = createTest({ rootDir: process.env.BROWSER_TEST_APP_ROOT ?? process.cwd(), browser: false, port, env: environment,
  nuxtConfig: { devtools: { enabled: false }, vite: { resolve: { dedupe: ['vue', 'gsap'] } },
    ...(uiCandidate ? createUiCandidateConfig(uiCandidate.bingUi) : {}) } })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let activePage: Page | undefined
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: { $nuxt?: { isHydrating: boolean } } }
    return root?.__vue_app__?.$nuxt?.isHydrating === false
  })
}
try {
  await prepareTestDatabase(); await resetTestDatabase(); await fixture.setup()
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_TEST_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const performanceRun = ['performance', 'cache-safety', 'smooth-scroll'].includes(process.env.BROWSER_TEST_SCENARIO ?? '')
  const login = await context.request.post(`${origin}/api/auth/sign-in/email`, { data: {
    email: performanceRun ? 'admin@requirement-board.local' : 'mobing@example.com',
    password: performanceRun ? TEST_ADMIN_PASSWORD : TEST_USER_PASSWORD, rememberMe: true,
  } })
  expect(login.ok(), '测试账号登录').toBe(true)
  if (process.env.BROWSER_TEST_SCENARIO === 'demo') {
    await verifyDemoIntegration(context, origin, database)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'search') {
    await verifySearchNavigation(context, origin)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'task-lists') {
    await verifyTaskListIntegration(context, origin)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'chapter-links') {
    await verifyChapterNavigation(context, origin)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'operations') {
    activePage = await context.newPage()
    await verifyOperationFeedbackIntegration(activePage, context, origin)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'smooth-scroll') {
    await verifyRequirementSmoothScroll(context, origin)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'cache-safety') {
    const created = await context.request.post(`${origin}/api/requirements`, { data: { title: '缓存恢复安全回归', templateId: null } })
    expect(created.ok()).toBe(true)
    const document = await created.json() as { id: string }
    const page = await context.newPage()
    activePage = page
    await page.goto(`${origin}/requirements/${document.id}`)
    await expect(page.locator('.tiptap[contenteditable="true"]')).toBeVisible()
    await verifyCachedRequirementSafety(page, context, origin, document.id)
  } else if (performanceRun) {
    const artifactRoot = process.env.BROWSER_TEST_ARTIFACT_DIR
    const rounds = Number(process.env.BROWSER_TEST_PERFORMANCE_ROUNDS ?? 1)
    const throttledRounds = Number(process.env.BROWSER_TEST_THROTTLED_ROUNDS ?? rounds)
    const rates = (process.env.BROWSER_TEST_CPU_RATES ?? '1').split(',').map(Number)
    for (const rate of rates) for (let round = 1; round <= (rate === 1 ? rounds : throttledRounds); round++) {
      process.env.BROWSER_TEST_CPU_RATE = String(rate)
      process.env.BROWSER_TEST_PERFORMANCE_SCROLL_RUNS = round === 1 ? '3' : '0'
      if (artifactRoot && (rounds > 1 || rates.length > 1)) process.env.BROWSER_TEST_ARTIFACT_DIR = join(artifactRoot, `cpu-${rate}-round-${round}`)
      // 缓存安全检查最后切换成普通账号；下一轮恢复同一管理账号条件。
      const roundLogin = await context.request.post(`${origin}/api/auth/sign-in/email`, { headers: { Origin: origin }, data: {
        email: 'admin@requirement-board.local', password: TEST_ADMIN_PASSWORD, rememberMe: true,
      } })
      expect(roundLogin.ok(), `每轮恢复管理账号：HTTP ${roundLogin.status()}`).toBe(true)
      await verifyRequirementPerformance(context, origin)
    }
  } else if (process.env.BROWSER_TEST_SCENARIO === 'workbench') {
    await verifyWorkbenchIntegration(context, origin)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'pages') {
    await verifyRequirementPages(context, origin)
  } else {
  async function create(title: string) {
    const response = await context.request.post(`${origin}/api/requirements`, { data: { title, priority: 'medium' } })
    expect(response.ok()).toBe(true)
    return await response.json() as { id: string; key: string }
  }
  const a = await create('付款分类甲')
  const b = await create('编辑器布局乙')
  const seeded = await context.request.post(`${origin}/api/requirements/${a.id}/revisions`, { data: {
    schemaVersion: DOCUMENT_SCHEMA_VERSION, schemaCapabilities: DOCUMENT_NODE_CAPABILITIES, title: '付款分类甲', changeNote: '', contentJson: { type: 'doc', content: Array.from({ length: 75 }, (_, i) => ({
      type: 'paragraph', attrs: { diffId: `browser_paragraph_${i}` }, content: [{ type: 'text', text: `第 ${i + 1} 段：用于检查切换后的阅读位置。` }],
    })) },
  } })
  expect(seeded.ok()).toBe(true)
  const page = await context.newPage()
  activePage = page
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (/hydration|failed to resolve component/i.test(message.text())) errors.push(message.text()) })
  const editor = page.locator('.tiptap[contenteditable="true"]')
  const search = page.getByRole('combobox', { name: '搜索文档号或名称', exact: true })
  async function openSearch() {
    if (!await search.isVisible()) await page.getByRole('button', { name: '搜索文档', exact: true }).click()
    await search.focus()
  }
  const title = page.getByRole('textbox', { name: '文档名称', exact: true })
  const viewport = page.locator('.requirement-editor__scroll > .bing-scrollbar__viewport')
  await page.goto(origin)
  await hydrated(page)
  await openSearch()
  await expect(search).toBeVisible()
  await expect(page.getByRole('button', { name: '最近浏览', exact: true })).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openSearch()
  await expect(search).toHaveAttribute('placeholder', /搜索文档（(?:Ctrl K|⌘ K)）/)
  await expect(search).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await search.press('ArrowDown')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await openSearch(); await search.fill(' ')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await openSearch(); await search.fill('付款')
  await expect(page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row').first()).toBeVisible()
  await openSearch(); await search.fill('')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await openSearch(); await search.fill('付款')
  await expect(page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row').first()).toBeVisible()
  const candidatesBeforeComposition = await page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row').allTextContents()
  const cdp = await context.newCDPSession(page)
  await search.selectText()
  for (const text of ['f', 'fu', 'fukuan']) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
    await expect(search).toHaveValue(text)
    await expect(search).toHaveAttribute('data-smooth-caret', '')
    await expect(page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row')).toHaveText(candidatesBeforeComposition)
  }
  await cdp.send('Input.insertText', { text: '付款' })
  await expect(search).toHaveValue('付款')
  await expect(page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row')).toHaveCount(1)
  await cdp.detach()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  console.log('通过：侧栏搜索原生中文组词保留平滑光标和候选，确认后才筛选。')
  await search.press('Enter')
  await expect(page).toHaveURL(`${origin}/requirements/${a.id}`)
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await verifyDocumentMetadataPersistence(page, context, origin, a.id)
  await title.fill('付款分类甲最后一个字')
  await page.getByRole('button', { name: '保存版本', exact: true }).click()
  await page.locator('#revision-note').fill('返回后继续保存的说明')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('textbox', { name: '版本说明', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('立即切换的中文末尾')
  await viewport.evaluate(node => { node.scrollTop = 800 })
  const position = await viewport.evaluate(node => node.scrollTop)
  await page.keyboard.press('Control+k')
  await expect(search).toBeFocused()
  await openSearch(); await search.fill('布局')
  await expect(page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row')).toHaveCount(1)
  await search.press('ArrowDown')
  await expect(page.locator('.bing-autocomplete__detail')).toContainText('负责人')
  await search.press('Enter')
  await expect(page).toHaveURL(`${origin}/requirements/${b.id}`)
  await expect(editor).toBeVisible()
  await page.getByRole('button', { name: '最近浏览', exact: true }).click()
  await page.getByRole('menuitem', { name: `${a.key}（付款分类甲最后一个字）`, exact: true }).click()
  await expect(page).toHaveURL(`${origin}/requirements/${a.id}`)
  await expect(title).toHaveValue('付款分类甲最后一个字')
  await expect(editor).toContainText('立即切换的中文末尾')
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeCloseTo(position, 0)
  await page.getByRole('button', { name: '保存版本', exact: true }).click()
  await expect(page.locator('#revision-note')).toHaveValue('返回后继续保存的说明')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  console.log('通过：A → B → A 恢复名称、末尾输入、说明和滚动位置。')

  await openSearch(); await search.fill('付款')
  await page.getByRole('button', { name: '最近浏览', exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await openSearch()
  await expect(search).toHaveValue('付款')
  await expect(page.locator('.recent-requirements-heading')).toHaveCount(0)
  await search.press('Escape')
  await page.goBack()
  await expect(page).toHaveURL(`${origin}/requirements/${b.id}`)
  await page.goForward()
  await expect(page).toHaveURL(`${origin}/requirements/${a.id}`)
  await expect(editor).toContainText('立即切换的中文末尾')

  // 目标已不可访问时由详情页处理；原文档的输入仍可恢复。
  await page.route(`**/api/requirements/${b.id}`, route => route.fulfill({ status: 404, json: { statusCode: 404 } }))
  await openSearch(); await search.fill(b.key)
  await expect(page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row').first()).toContainText(b.key)
  await search.press('Enter')
  await expect(page).toHaveURL(`${origin}/requirements`)
  await expect(page.locator('.requirements-list-page')).toBeVisible()
  await expect(search).toHaveValue(b.key)
  await page.unroute(`**/api/requirements/${b.id}`)
  await openSearch(); await search.fill(a.key)
  await expect(page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row').first()).toContainText(a.key)
  await search.press('Enter')
  await expect(editor).toContainText('立即切换的中文末尾')

  const key = 'rb:recent-requirements:v1:user_mobing:project_main'
  const beforeViews = await page.evaluate(key => localStorage.getItem(key), key)
  for (const view of ['版本比较', '正文']) {
    await page.getByRole('tab', { name: view, exact: true }).click()
    await page.keyboard.press('Control+k')
    await expect(search).toBeFocused()
    await openSearch(); await search.fill('付款')
    await expect(page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row')).toHaveCount(1)
    await search.press('Escape')
    await page.getByRole('button', { name: '最近浏览', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: `${b.key}（编辑器布局乙）`, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
  }
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(beforeViews)

  for (const width of [390, 780, 1440, 2560]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.bingTheme = theme }, theme)
      await openSearch()
      await openSearch(); await search.fill('付款')
      await expect(page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row')).toHaveCount(1)
      const panel = await page.locator('.bing-autocomplete__panel').boundingBox()
      expect(panel!.x).toBeGreaterThanOrEqual(0)
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(width)
      expect(panel!.y + panel!.height).toBeLessThanOrEqual(1000)
      if (process.env.BROWSER_TEST_ARTIFACT_DIR) await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `quick-switch-${width}-${theme}.png`) })
      await page.locator('.requirement-header-search .bing-input__clear').click()
      await expect(search).toBeFocused()
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await search.press('Escape')
      if (width <= 700) {
        await expect(search).toBeHidden()
        await page.getByRole('button', { name: '搜索文档', exact: true }).click()
        await expect(search).toBeFocused()
        await expect(page.getByRole('listbox')).toHaveCount(0)
        await search.dispatchEvent('compositionstart')
        await search.dispatchEvent('keydown', { key: 'Escape', isComposing: true })
        await expect(search).toBeFocused()
        await search.dispatchEvent('compositionend')
        await page.getByRole('button', { name: '关闭搜索', exact: true }).click()
        await expect(search).toBeHidden()
      }
      await page.getByRole('button', { name: '最近浏览', exact: true }).click()
      const menu = await page.locator('.bing-dropdown__panel').boundingBox()
      expect(menu!.x).toBeGreaterThanOrEqual(0)
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(width)
      await page.keyboard.press('Escape')
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openSearch(); await search.fill('布局')
  await page.getByRole('button', { name: '查看全部搜索结果', exact: true }).click()
  await expect(page).toHaveURL(/\/requirements\?q=/)
  await expect(page.getByRole('textbox', { name: '搜索标题或编号', exact: true })).toHaveValue('布局')
  await expect(search).toBeVisible()
  await expect(search).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('combobox', { name: '搜索文档号或名称', exact: true, includeHidden: true })).toHaveValue('布局')
  await openSearch()
  await page.getByRole('button', { name: '查看全部搜索结果', exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(page.locator('.requirement-search-error')).toHaveCount(0)
  await page.goBack(); await expect(editor).toBeVisible()
  await page.reload(); await expect(editor).toBeVisible()
  await page.getByRole('button', { name: '最近浏览', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: `${b.key}（编辑器布局乙）`, exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  await openSearch(); await search.fill('布局')
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '工作台', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/`)
  await expect(search).toBeVisible()
  await expect(search).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('combobox', { name: '搜索文档号或名称', exact: true, includeHidden: true })).toHaveValue('布局')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.getByRole('button', { name: '最近浏览', exact: true }).click()
  await page.getByRole('menuitem', { name: `${a.key}（付款分类甲最后一个字）`, exact: true }).click()
  await expect(editor).toBeVisible()
  // 其他业务页面的 id 参数不能被当成当前编辑中的文档。
  await page.goto(`${origin}/selection-history/${a.id}`)
  await hydrated(page)
  await openSearch(); await search.fill(a.key)
  await expect(page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row')).toHaveCount(1)
  await search.press('Enter')
  await expect(page).toHaveURL(`${origin}/requirements/${a.id}`)
  await expect(editor).toBeVisible()

  const other = await context.newPage()
  await other.goto(`${origin}/requirements/${b.id}`)
  await expect(other.locator('.tiptap[contenteditable="true"]')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '最近浏览', exact: true }).click()
  await page.getByRole('menuitem', { name: '清空最近浏览', exact: true }).click()
  await expect(page.getByText('暂无最近浏览', { exact: true })).toBeVisible()
  await other.getByRole('button', { name: '最近浏览', exact: true }).click()
  await expect(other.getByText('暂无最近浏览', { exact: true })).toBeVisible()
  const history = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)
  expect(history.entries).toEqual([])
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const adminLogin = await adminContext.request.post(`${origin}/api/auth/sign-in/email`, { data: { email: 'admin@requirement-board.local', password: TEST_ADMIN_PASSWORD } })
  expect(adminLogin.ok()).toBe(true)
  const members = await adminContext.newPage()
  await members.goto(`${origin}/members`)
  await hydrated(members)
  const memberSearch = members.getByRole('combobox', { name: '搜索文档号或名称', exact: true })
  await memberSearch.click()
  await expect(memberSearch).toBeVisible()
  await expect(members.getByRole('button', { name: '最近浏览', exact: true })).toBeVisible()
  await memberSearch.fill('布局')
  await expect(members.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row')).toHaveCount(1)
  await memberSearch.press('Enter')
  await expect(members).toHaveURL(`${origin}/requirements/${b.id}`)
  await adminContext.close()
  await verifyRequirementPages(context, origin)
  await verifyWorkbenchIntegration(context, origin)
  expect(errors).toEqual([])
  console.log('通过：工作台、文档列表、成员管理常驻入口，跨页面保留搜索词并收起浮层，选区历史可返回同一文档。')
  console.log('通过：面板互斥、前进后退、错误保留、正文/比较模式、宽度/主题、完整搜索入口、刷新保留、多标签清空。')
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    console.error('浏览器失败状态', await activePage.evaluate(() => ({
      path: location.pathname, active: document.activeElement?.outerHTML.slice(0, 500),
      modals: document.querySelectorAll('[aria-modal="true"]').length,
      alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent),
    })).catch(() => '页面不可读取'))
  }
  throw error
} finally {
  await browser?.close()
  await fixture.afterAll()
  const safeTemp = resolve(uploads)
  if (safeTemp.startsWith(resolve(tmpdir()) + sep) && safeTemp.split(sep).at(-1)?.startsWith('requirement-quick-switch-')) {
    await rm(safeTemp, { recursive: true, force: true })
  }
}
