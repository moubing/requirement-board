import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium, expect, type Page } from '@playwright/test'
import { createTest } from '@nuxt/test-utils/e2e'
import { verifyRelatedDocumentPersistence } from './related-documents-integration'

const database = process.env.BROWSER_TEST_DATABASE_URL ?? 'postgres://requirement:requirement@localhost:5438/requirement_board_documents_browser_test'
const databaseUrl = new URL(database)
if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname) || !databaseUrl.pathname.endsWith('_browser_test')) throw new Error('文档浏览器测试只允许本机独立的 *_browser_test 数据库')
const origin = 'http://127.0.0.1:3139'
const uploads = await mkdtemp(join(tmpdir(), 'document-types-browser-'))
const env = { TEST_DATABASE_URL: database, DATABASE_URL: database, NUXT_DATABASE_URL: database, BETTER_AUTH_SECRET: 'document-types-browser-fixture-secret-12345', BETTER_AUTH_URL: origin, ASSET_STORAGE_DRIVER: 'local', ASSET_UPLOAD_DIR: uploads }
Object.assign(process.env, env)
const { prepareTestDatabase, resetTestDatabase, TEST_USER_PASSWORD } = await import('../setup/db')
const fixture = createTest({ rootDir: process.cwd(), browser: false, port: 3139, env, nuxtConfig: { devtools: { enabled: false } } })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let page: Page | undefined
try {
  await prepareTestDatabase(); await resetTestDatabase(); await fixture.setup()
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_TEST_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  expect((await context.request.post(`${origin}/api/auth/sign-in/email`, { data: { email: 'mobing@example.com', password: TEST_USER_PASSWORD } })).ok()).toBe(true)
  page = await context.newPage(); page.setDefaultTimeout(15_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', item => { if (/hydration|failed to resolve component/i.test(item.text())) errors.push(item.text()) })
  const goto = async (path: string) => {
    await page!.goto(`${origin}${path}`)
    await page!.waitForFunction(() => (document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: { $nuxt?: { isHydrating: boolean } } })?.__vue_app__?.$nuxt?.isHydrating === false)
  }
  const choose = async (label: string, option: string) => { await page!.getByRole('button', { name: label, exact: true }).and(page!.locator('[aria-haspopup="listbox"]')).click(); await page!.getByRole('option', { name: new RegExp(option) }).click() }
  const ids: Record<string, string> = {}
  for (const [type, label, template, heading] of [['requirement', '需求', '标准需求', '背景与目标'], ['defect', '缺陷', '缺陷报告', '复现步骤'], ['instruction', '说明', '通用说明', '概述'], ['todo', '待办', '事项待办', '行动清单']]) {
    await goto('/requirements')
    await page.getByRole('button', { name: '新建文档', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建文档', exact: true })
    await expect(dialog).toBeVisible()
    await choose('文档类型', label!)
    await expect(dialog.getByRole('button', { name: '正文模板', exact: true })).toContainText('空白模板')
    await expect(dialog).toContainText('从空白正文开始')
    await choose('正文模板', template!)
    await expect(dialog.getByRole('document', { name: '模板正文预览' })).toContainText(heading!)
    if (type === 'requirement') {
      const preview = dialog.getByRole('region', { name: '模板预览', exact: true })
      expect((await preview.boundingBox())!.width).toBeGreaterThan(400)
      if (process.env.BROWSER_TEST_ARTIFACT_DIR) await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, 'document-create-standard.png') })
      await choose('正文模板', '空白模板')
      await expect(dialog.getByRole('document', { name: '模板正文预览' })).toHaveCount(0)
      await choose('正文模板', template!)
    }
    await dialog.getByRole('button', { name: '创建并编辑', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: '文档标题', exact: true }).fill(`${label}浏览器验证`)
    await choose('负责人', 'Frontend')
    await page.getByRole('option', { name: 'Mo Bing', exact: true }).click()
    await page.keyboard.press('Escape')
    if (type === 'instruction') {
      await page.route('**/api/requirements', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { message: '创建暂时失败' } }) : route.continue(), { times: 1 })
      await dialog.getByRole('button', { name: '创建并编辑', exact: true }).click()
      await expect(dialog).toBeHidden()
      await page.getByRole('button', { name: '继续创建', exact: true }).click()
      await expect(dialog.getByRole('alert')).toContainText('创建暂时失败')
      await expect(dialog.getByRole('textbox', { name: '文档标题', exact: true })).toHaveValue(`${label}浏览器验证`)
    }
    await dialog.getByRole('button', { name: '创建并编辑', exact: true }).click()
    await expect(page).toHaveURL(/\/requirements\/req_/)
    await expect(page.locator('.tiptap[contenteditable="true"]')).toContainText(heading!)
    ids[type!] = page.url().split('/').at(-1)!
    const detail = await (await context.request.get(`${origin}/api/requirements/${ids[type!]}`)).json()
    expect(detail.documentType).toBe(type); expect(detail.status.code).toBe(type === 'instruction' ? 'draft' : 'queued')
    expect(detail.assigneeIds.length).toBe(2)
  }
  console.log('通过：四种模板创建、预览、表单校验、失败恢复，以及四类文档多人分配。')
  await verifyRelatedDocumentPersistence(page, ids, origin)

  await goto(`/requirements/${ids.defect}`)
  const assignmentSaved = page.waitForResponse(response => response.url().endsWith(`/api/requirements/${ids.defect}`) && response.request().method() === 'PATCH')
  await choose('负责人', 'Design')
  const assignmentResponse = await assignmentSaved
  expect(assignmentResponse.ok()).toBe(true)
  expect((await assignmentResponse.json()).assigneeIds).toHaveLength(3)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByRole('combobox', { name: '负责人', exact: true })).toContainText('Design')

  await goto('/requirements')
  await page.route('**/api/document-templates', route => route.fulfill({ status: 503, json: { message: '模板列表暂时不可用' } }))
  await page.getByRole('button', { name: '新建文档', exact: true }).click()
  const blankDialog = page.getByRole('dialog', { name: '新建文档', exact: true })
  await expect(blankDialog.getByRole('alert')).toContainText('模板列表暂时不可用')
  await page.unroute('**/api/document-templates')
  await expect(blankDialog.getByRole('button', { name: '正文模板', exact: true })).toContainText('空白模板')
  await blankDialog.getByRole('textbox', { name: '文档标题', exact: true }).fill('从空白正文创建')
  await blankDialog.getByRole('button', { name: '创建并编辑', exact: true }).click()
  await expect(page).toHaveURL(/\/requirements\/req_/)
  const blankDetail = await (await context.request.get(`${origin}/api/requirements/${page.url().split('/').at(-1)}`)).json()
  expect(blankDetail.currentRevision.contentText).toBe('')
  await expect(page.locator('.tiptap[contenteditable="true"]')).toBeVisible()

  await goto(`/requirements/${ids.requirement}`)
  await expect(page.locator('.tiptap[contenteditable="true"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '状态', exact: true })).toHaveCount(0)
  await page.route(`**/api/requirements/${ids.requirement}`, route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { message: '状态服务暂时不可用' } }) : route.continue(), { times: 1 })
  await page.getByRole('button', { name: '修改文档状态', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '进行中', exact: true }).click()
  await expect(page.locator('.requirement-meta-error')).toContainText('状态服务暂时不可用')
  await expect(page.getByRole('status', { name: '当前状态' })).toHaveText('待处理')
  const taskStates = ['待处理', '进行中', '测试中', '已完成', '已关闭']
  const transition = async (state: string, states: readonly string[] = taskStates) => {
    await page!.getByRole('button', { name: '修改文档状态', exact: true }).click()
    // 下拉列出该类型全部状态，当前状态单独标记且不可重复提交。
    await expect(page!.getByRole('menuitemradio')).toHaveText(states.map(name => new RegExp(name)))
    await expect(page!.getByRole('menuitemradio', { name: /（当前状态）$/ })).toHaveAttribute('aria-checked', 'true')
    await page!.getByRole('menuitemradio', { name: state, exact: true }).click()
    await expect(page!.getByRole('status', { name: '当前状态' })).toHaveText(state)
    await expect(page!.getByText(new RegExp(`的属性已更新，状态：${state}`)).last()).toBeVisible()
  }
  // 同类型内任意切换：直接完成、重新打开、关闭后再完成。
  for (const state of ['已完成', '待处理', '测试中', '进行中', '已关闭', '已完成']) {
    await transition(state)
    // 每轮状态修改保留独立结果；逐步关闭提示，避免长流程占满 Toast 的可见队列。
    const notices = page.getByRole('region', { name: '消息通知' }).getByRole('button', { name: '关闭消息' })
    for (let count = await notices.count(); count > 0; count--) {
      await notices.first().click()
      await expect(notices).toHaveCount(count - 1)
    }
  }
  await page.getByRole('button', { name: '更多文档操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '另存为模板', exact: true }).click()
  const saveDialog = page.getByRole('dialog', { name: '另存为模板', exact: true })
  await saveDialog.getByRole('textbox', { name: '模板名称', exact: true }).fill('从文档保存的模板')
  await page.route('**/api/document-templates', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { message: '保存模板暂时失败' } }) : route.continue(), { times: 1 })
  await saveDialog.getByRole('button', { name: '保存模板', exact: true }).click()
  await expect(saveDialog).toBeHidden()
  await page.getByRole('button', { name: '更多文档操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '另存为模板', exact: true }).click()
  await expect(saveDialog.getByRole('alert')).toContainText('保存模板暂时失败')
  await expect(saveDialog.getByRole('textbox', { name: '模板名称', exact: true })).toHaveValue('从文档保存的模板')
  await saveDialog.getByRole('button', { name: '保存模板', exact: true }).click()
  await expect(saveDialog).toBeHidden()
  await expect(page.getByText('模板「从文档保存的模板」已保存，可在模板管理中查看。', { exact: true })).toBeVisible()
  for (const [type, steps, states] of [
    ['defect', ['已关闭', '待处理', '测试中', '进行中'], taskStates],
    ['instruction', ['已发布', '已归档', '草稿', '已发布'], ['草稿', '已发布', '已归档']],
    ['todo', ['已完成', '进行中', '已完成'], taskStates],
  ] as const) {
    await goto(`/requirements/${ids[type]}`)
    for (const state of steps) await transition(state, states)
  }
  await goto('/requirements?assignee=me')
  await expect(page.locator('.requirement-table')).toContainText('需求浏览器验证')
  await choose('筛选文档类型', '缺陷')
  await expect(page.locator('.requirement-table')).not.toContainText('需求浏览器验证')

  await goto('/templates')
  await page.locator('.template-list-item').filter({ hasText: '标准需求' }).click()
  await page.getByRole('button', { name: '复制为新模板', exact: true }).click()
  await page.getByRole('textbox', { name: '模板名称', exact: true }).fill('团队自定义模板')
  const editor = page.locator('.tiptap[contenteditable="true"]')
  await editor.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText('团队约定的正文结构')
  await page.getByRole('button', { name: '保存模板', exact: true }).click()
  await expect(page.locator('.template-feedback')).toContainText('模板已保存')
  await page.reload()
  await page.locator('.template-list-item').filter({ hasText: '团队自定义模板' }).click()
  await expect(page.getByRole('document', { name: '模板正文预览' })).toContainText('团队约定的正文结构')
  await expect(editor).toHaveCount(0)
  await page.getByRole('button', { name: '编辑模板', exact: true }).click()
  await expect(editor).toContainText('团队约定的正文结构')
  await goto('/requirements')
  await page.getByRole('button', { name: '新建文档', exact: true }).click()
  await choose('正文模板', '团队自定义模板')
  await expect(page.getByRole('document', { name: '模板正文预览' })).toContainText('团队约定的正文结构')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.bingTheme = theme, theme)
      const box = await page.getByRole('dialog', { name: '新建文档', exact: true }).boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      if (process.env.BROWSER_TEST_ARTIFACT_DIR) await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `document-create-${width}-${theme}.png`) })
    }
  }
  expect(errors).toEqual([])
  console.log('通过：空白创建和模板服务失败回退、状态直接切换和成功/失败 toast、保存模板失败重试与成功自动关闭、模板编辑、筛选、明暗主题与窄屏。')
} catch (error) {
  if (page && !page.isClosed()) console.error(await page.evaluate(() => ({ path: location.pathname, alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent) })).catch(() => '页面不可读取'))
  if (page && !page.isClosed()) console.error((await page.locator('body').ariaSnapshot()).slice(-12000))
  throw error
} finally {
  await browser?.close(); await fixture.afterAll()
  const safe = resolve(uploads)
  if (safe.startsWith(resolve(tmpdir()) + sep) && safe.split(sep).at(-1)?.startsWith('document-types-browser-')) await rm(safe, { recursive: true })
}
