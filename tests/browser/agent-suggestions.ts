import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { chromium, expect, type Page } from '@playwright/test'
import { createTest } from '@nuxt/test-utils/e2e'
import * as Y from 'yjs'
import { decodeCollaborationState, readCollaborationDocument } from '../../shared/collaboration/document'
import { eq } from 'drizzle-orm'
import { createDatabase } from '../../server/db/client'
import { requirementAgentLocks } from '../../server/db/schema'
import { verifyAgentTokenPages } from './agent-token-pages'
import { verifyAccountLayout } from './account-layout'

const database = process.env.BROWSER_TEST_DATABASE_URL ?? 'postgres://requirement:requirement@localhost:5438/requirement_board_agent_browser_test'
const databaseUrl = new URL(database)
if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname) || !databaseUrl.pathname.endsWith('_browser_test')) {
  throw new Error('浏览器验证只允许本机、名称以 _browser_test 结尾的隔离数据库')
}
const port = Number(process.env.BROWSER_TEST_PORT ?? 3138)
const origin = `http://127.0.0.1:${port}`
const longDigits = '1234567890'.repeat(36)
const longWord = 'RequirementBoard'.repeat(24)
const temporary = await mkdtemp(join(tmpdir(), 'requirement-agent-browser-'))
const environment = { TEST_DATABASE_URL: database, DATABASE_URL: database, NUXT_DATABASE_URL: database, BETTER_AUTH_SECRET: 'requirement-agent-browser-test-secret-123456789',
  BETTER_AUTH_URL: origin, ASSET_STORAGE_DRIVER: 'local', ASSET_UPLOAD_DIR: join(temporary, 'uploads') }
Object.assign(process.env, environment)
const { prepareTestDatabase, resetTestDatabase, TEST_USER_PASSWORD, seedIds } = await import('../setup/db')
const fixture = createTest({ rootDir: process.cwd(), browser: false, port, env: environment, nuxtConfig: { devtools: { enabled: false } } })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let active: Page | undefined
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: { $nuxt?: { isHydrating: boolean } } }
    return root?.__vue_app__?.$nuxt?.isHydrating === false
  })
}
async function expireLock(requirementId: string) {
  const connection = createDatabase(database)
  try { await connection.db.update(requirementAgentLocks).set({ expiresAt: new Date(0) }).where(eq(requirementAgentLocks.requirementId, requirementId)) }
  finally { await connection.client.end() }
}
try {
  await prepareTestDatabase(); await resetTestDatabase(); await fixture.setup()
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_TEST_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  expect((await context.request.post(`${origin}/api/auth/sign-in/email`, { data: { email: 'mobing@example.com', password: TEST_USER_PASSWORD } })).ok()).toBe(true)
  const created = await context.request.post(`${origin}/api/requirements`, { data: { title: 'Agent 验证文档', priority: 'medium' } })
  expect(created.ok()).toBe(true)
  const requirement = await created.json() as { id: string }
  const page = await context.newPage()
  active = page
  const errors: string[] = []
  for (const p of [page]) {
    p.on('pageerror', err => errors.push(`${p.url()}\n${err.stack ?? err.message}`))
    p.on('console', msg => { if (/hydration|failed to resolve component/i.test(msg.text())) errors.push(msg.text()) })
  }
  await page.goto(`${origin}/account`); await hydrated(page)
  await verifyAccountLayout(page, origin, TEST_USER_PASSWORD)
  await verifyAgentTokenPages(page, database, origin, seedIds.currentUserId)
  await expect(page.getByRole('textbox', { name: '凭证名称', exact: true })).toHaveCount(0)
  await page.locator('.agent-tokens').getByRole('button', { name: '创建凭证', exact: true }).click()
  const credentialDialog = page.getByRole('dialog', { name: '创建凭证', exact: true })
  const credentialBox = await credentialDialog.boundingBox()
  expect(Math.round(credentialBox!.width)).toBe(480)
  expect(Math.round(credentialBox!.height)).toBe(480)
  const credentialName = credentialDialog.getByRole('textbox', { name: '凭证名称', exact: true })
  await expect(credentialDialog.getByRole('tab', { name: '30 天', exact: true })).toHaveAttribute('aria-selected', 'true')
  await credentialDialog.getByRole('button', { name: '创建凭证', exact: true }).click()
  await expect(credentialDialog.getByText('请输入凭证名称', { exact: true })).toBeVisible()
  await credentialName.fill('浏览器验证')
  await credentialDialog.getByRole('tab', { name: '自定义', exact: true }).click()
  const credentialDays = credentialDialog.getByRole('spinbutton', { name: '自定义有效期（天）', exact: true })
  await credentialDays.fill('91')
  await credentialDays.press('Tab')
  await expect(credentialDays).toHaveValue('90')
  await credentialDays.fill('7')
  const credentialRequest = page.waitForRequest(request => request.url().endsWith('/api/account/agent-tokens') && request.method() === 'POST')
  await credentialName.press('Enter')
  expect((await credentialRequest).postDataJSON()).toEqual({ name: '浏览器验证', expiresInDays: 7 })
  await expect(credentialDialog).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '新建 AI 凭证', exact: true })).toBeVisible()
  const token = await page.getByRole('textbox', { name: '新建 AI 凭证', exact: true }).inputValue()
  const credentialResult = page.getByRole('dialog', { name: '凭证已创建', exact: true })
  expect(await credentialResult.boundingBox()).toEqual(credentialBox)
  await page.evaluate("Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('blocked clipboard')) })")
  await credentialResult.getByRole('button', { name: '复制凭证', exact: true }).click()
  await expect(credentialResult.getByRole('alert')).toContainText('手动复制')
  await expect(credentialResult.getByRole('textbox', { name: '新建 AI 凭证' })).toHaveValue(token)
  await page.evaluate(() => { delete (navigator.clipboard as unknown as Record<string, unknown>).writeText })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 500 })
    const box = await credentialResult.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width); expect(box!.y + box!.height).toBeLessThanOrEqual(500)
    await expect(credentialResult.getByRole('button', { name: '完成', exact: true })).toBeInViewport()
  }
  await credentialResult.getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '新建 AI 凭证' })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.agent-tokens').getByRole('button', { name: '创建凭证', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '新建 AI 凭证' })).toHaveCount(0)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await expect(page.locator('.agent-setup')).toBeVisible()
  await page.getByRole('button', { name: '复制安装说明', exact: true }).click()
  // 复制结果同时显示在面板内与顶部 Toast；这里只检查面板内的提示。
  const agentPanel = page.getByLabel('AI 协作', { exact: true })
  await expect(agentPanel.getByText('安装说明已复制，直接发给本机 Codex 即可', { exact: true })).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('请帮我在本机 Codex 安装并配置')
  expect(copied).toContain(`${origin}/api/agent/setup`)
  expect(copied).not.toContain(token)
  for (const [action, label] of [['update', '更新'], ['uninstall', '卸载']]) {
    await page.getByRole('button', { name: `复制${label}说明`, exact: true }).click()
    await expect(agentPanel.getByText(`${label}说明已复制，直接发给本机 Codex 即可`, { exact: true })).toBeVisible()
    const maintenance = await page.evaluate(() => navigator.clipboard.readText())
    expect(maintenance).toContain(`${origin}/api/agent/setup?action=${action}`)
    expect(maintenance).not.toContain(token)
    expect(maintenance).toContain(action === 'update' ? '无需先卸载' : '保留本机 URL、Token')
  }
  const guide = await (await context.request.get(`${origin}/api/agent/setup`)).text()
  expect(guide).toContain(`--base-url '${origin}'`)
  expect(guide).not.toContain(token)
  await expect(page.getByRole('link', { name: '安装说明', exact: true })).toHaveAttribute('href', `${origin}/api/agent/setup`)
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
      await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
      await page.locator('.agent-tokens').screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `agent-setup-${width}.png`) })
    }
  }
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: '下载 Skill', exact: true }).click()
  const downloaded = await download
  expect(downloaded.suggestedFilename()).toBe('requirement-board-skill.tar.gz')
  const archivePath = join(temporary, 'skill.tar.gz')
  await downloaded.saveAs(archivePath)
  // 用相对文件名解压：Git 自带的 GNU tar 会把“C:\...”这类盘符路径当成远程主机。
  await promisify(execFile)('tar', ['-xzf', basename(archivePath)], { cwd: temporary, windowsHide: true })
  // 下载包本身完成安装、自动更新、卸载和重装，配置隔离在本次临时目录。
  const codexRoot = join(temporary, 'codex'), settings = join(codexRoot, 'requirement-board')
  await mkdir(settings, { recursive: true })
  const savedConfig = JSON.stringify({ version: 1, RB_BASE_URL: origin, RB_TOKEN: token })
  await writeFile(join(settings, 'config.json'), savedConfig)
  const maintenanceEnv = { ...process.env, CODEX_HOME: codexRoot }; delete maintenanceEnv.RB_BASE_URL; delete maintenanceEnv.RB_TOKEN
  const maintain = (script: string, ...args: string[]) => promisify(execFile)(process.execPath, [script, ...args], { env: maintenanceEnv, windowsHide: true })
  const bundledInstaller = join(temporary, 'requirement-board/install.mjs'), installedInstaller = join(codexRoot, 'skills/requirement-board/install.mjs')
  await maintain(bundledInstaller, '--non-interactive', '--base-url', origin)
  await maintain(installedInstaller, 'update')
  await maintain(installedInstaller, 'uninstall')
  await maintain(bundledInstaller, '--non-interactive', '--base-url', origin)
  expect(await readFile(join(settings, 'config.json'), 'utf8')).toBe(savedConfig)
  console.log('通过：凭证弹窗、安装/更新/卸载链接、Skill 下载及实际更新卸载重装，完整复用配置。')

  await page.goto(`${origin}/requirements/${requirement.id}`)
  const editor = page.locator('.tiptap[contenteditable="true"]')
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致')
  await expect(page.getByRole('link', { name: /AI 建议/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '打开 AI 编辑状态', exact: true })).toHaveCount(0)
  await editor.click(); await page.keyboard.insertText(`已经同步的原始正文。${longDigits}`)
  await page.keyboard.press('Enter'); await page.keyboard.insertText('待调整的验收说明。')
  await page.keyboard.press('Enter'); await page.keyboard.insertText('正文末尾。')
  // Wait for this exact text to be visible to the external Agent, not only for an earlier saved indicator.
  await expect.poll(async () => {
    const loaded = await (await context.request.post(`${origin}/api/requirements/${requirement.id}/collaboration`, { data: {} })).json()
    const doc = new Y.Doc()
    try { Y.applyUpdate(doc, decodeCollaborationState(loaded.state)); return JSON.stringify(readCollaborationDocument(doc).contentJson) }
    finally { doc.destroy() }
  }).toContain('正文末尾。')
  const viewer = await context.newPage()
  viewer.on('pageerror', err => errors.push(`${viewer.url()}\n${err.stack ?? err.message}`))
  await viewer.goto(`${origin}/requirements/${requirement.id}`); await hydrated(viewer)
  await expect(viewer.locator('.tiptap')).toContainText('已经同步的原始正文。')
  await page.evaluate(() => document.fonts.ready)
  const editorBeforeLock = await page.getByRole('region', { name: '文档正文', exact: true }).boundingBox()

  // Run the actual distributed CLI using environment credentials, not a hand-written API imitation.
  const run = promisify(execFile)
  const cli = async (...args: string[]) => run(process.execPath, [join(temporary, 'requirement-board/scripts/rb.mjs'), ...args], {
    env: { ...process.env, RB_BASE_URL: origin, RB_TOKEN: token }, timeout: 30_000,
  })
  const schemaFile = join(temporary, 'schema.json'), snapshotFile = join(temporary, 'snapshot.json'), proposalFile = join(temporary, 'proposal.json')
  await cli('schema', '--out', schemaFile)
  expect(JSON.parse(await readFile(schemaFile, 'utf8')).schemaVersion).toBe(3)
  await cli('snapshot', `${origin}/requirements/${requirement.id}`, '--out', snapshotFile)
  for (const current of [page, viewer]) {
    await current.getByRole('tab', { name: '文档信息', exact: true }).click()
    await expect(current.locator('.agent-lock-notice')).toBeVisible()
    await expect(current.locator('.tiptap')).toHaveAttribute('contenteditable', 'false')
    await expect(current.getByRole('textbox', { name: '文档名称', exact: true })).toBeDisabled()
    await expect(current.getByRole('button', { name: 'AI 编辑中 · 只读', exact: true }).first()).toBeDisabled()
    await expect(current.getByRole('button', { name: '导出本机副本并载入最新内容', exact: true })).toHaveCount(0)
    await expect(current.locator('.requirement-workspace-status .agent-lock-notice')).toHaveCount(0)
    await expect(current.locator('.requirement-editor__toolbar').getByRole('link', { name: /AI 建议/ })).toHaveCount(0)
    await expect(current.locator('.requirement-side .agent-lock-notice')).toBeVisible()
  }
  const editorAfterLock = await page.getByRole('region', { name: '文档正文', exact: true }).boundingBox()
  expect(Math.abs(editorAfterLock!.y - editorBeforeLock!.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(editorAfterLock!.height - editorBeforeLock!.height)).toBeLessThanOrEqual(1)
  await viewer.reload(); await hydrated(viewer)
  await expect(viewer.locator('.tiptap')).toHaveAttribute('contenteditable', 'false')
  await viewer.getByRole('tab', { name: '版本比较', exact: true }).click()
  await viewer.getByRole('button', { name: '更多文档操作', exact: true }).click()
  await viewer.getByRole('menuitem', { name: '打开 AI 编辑状态', exact: true }).click()
  await expect(viewer.getByRole('dialog', { name: 'AI 编辑状态', exact: true }).locator('.agent-lock-notice')).toBeVisible()
  await viewer.keyboard.press('Escape')
  await viewer.getByRole('tab', { name: '正文', exact: true }).click()
  await expect(viewer.locator('.tiptap')).toHaveAttribute('contenteditable', 'false')
  for (const width of [1024, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    if (await page.getByRole('button', { name: '打开文档信息和目录', exact: true }).isVisible()) {
      const body = page.getByRole('region', { name: '文档正文', exact: true })
      const before = await body.boundingBox()
      await page.getByRole('button', { name: '更多文档操作', exact: true }).click()
      await page.getByRole('menuitem', { name: '打开 AI 编辑状态', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'AI 编辑状态', exact: true }).locator('.agent-lock-notice')).toBeVisible()
      expect((await body.boundingBox())!.y).toBe(before!.y)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByRole('button', { name: '打开文档信息和目录', exact: true }).click()
      await expect(page.getByRole('dialog', { name: '文档辅助面板', exact: true }).locator('.agent-lock-notice')).toBeVisible()
      expect((await body.boundingBox())!.y).toBe(before!.y)
      await page.getByRole('dialog', { name: '文档辅助面板', exact: true }).getByRole('button', { name: '收起文档辅助面板', exact: true }).click()
    }
    if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
      await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `agent-lock-${width}.png`), fullPage: true })
    }
  }
  await cli('renew', '--snapshot', snapshotFile)
  await cli('new', '--snapshot', snapshotFile, '--out', proposalFile)
  const proposal = JSON.parse(await readFile(proposalFile, 'utf8'))
  const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'))
  proposal.changeNote = '补充验收标准，检查连续数字、长英文、标题、列表和表格自动换行，代码块保留横向滚动。'.repeat(3)
  proposal.operations = [
    { op: 'set_title', title: `Agent 验证文档 ${'LongTitle'.repeat(16)}` },
    { op: 'replace_block', targetDiffId: snapshot.contentJson.content[1].attrs.diffId, node: {
      type: 'paragraph', attrs: { diffId: snapshot.contentJson.content[1].attrs.diffId }, content: [{ type: 'text', text: `调整后的验收说明：${longWord}` }],
    } },
    { op: 'insert_blocks', anchorDiffId: snapshot.contentJson.content[1].attrs.diffId, position: 'after', nodes: [
    { type: 'paragraph', content: [{ type: 'text', text: '新增验收标准：失败时保留用户输入。' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `标题${longWord}` }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: longDigits }] }] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: longWord }] }] },
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '表格说明' }] }] },
    ] }] },
    { type: 'codeBlock', content: [{ type: 'text', text: `const record = "${longWord}";` }] },
    ...Array.from({ length: 12 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `验收步骤 ${index + 1}：核对最新文档正文。` }] })),
  ] }]
  await writeFile(proposalFile, JSON.stringify(proposal), 'utf8')
  expect(JSON.parse((await cli('validate', '--file', proposalFile)).stdout).valid).toBe(true)

  const executed = JSON.parse((await cli('submit', '--file', proposalFile)).stdout)
  expect(executed).toMatchObject({ status: 'applied', requirementId: requirement.id, revision: null })
  expect(executed.reviewUrl).toBeUndefined()
  expect(JSON.parse((await cli('submit', '--file', proposalFile)).stdout)).toEqual(executed)
  expect(JSON.parse((await cli('status', executed.id)).stdout)).toEqual(executed)
  for (const current of [page, viewer]) {
    await expect(current.locator('.tiptap')).toHaveAttribute('contenteditable', 'true')
    await expect(current.locator('.tiptap')).toContainText('新增验收标准：失败时保留用户输入。')
    await expect(current.locator('.agent-lock-notice')).toHaveCount(0)
    await expect(current.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('有未保存为版本的修改')
    await expect(current.getByRole('link', { name: /AI 建议/ })).toHaveCount(0)
  }
  expect(JSON.parse((await cli('revisions', requirement.id)).stdout)).toHaveLength(1)
  if (process.env.BROWSER_TEST_ARTIFACT_DIR) await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, 'agent-modified-1440.png') })
  await page.reload(); await hydrated(page)
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('有未保存为版本的修改')
  await page.getByRole('tab', { name: '版本比较', exact: true }).click()
  await expect(page.locator('.rich-diff')).toContainText('新增验收标准：失败时保留用户输入。')
  await page.getByRole('tab', { name: '正文', exact: true }).click()
  await page.getByRole('tab', { name: '文档信息', exact: true }).click()
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('AI 修改后继续人工编辑')
  await page.getByRole('button', { name: '保存版本', exact: true }).click()
  await page.getByRole('button', { name: '确认保存版本', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致')
  await expect(viewer.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致')
  const originalTitle = await page.getByRole('textbox', { name: '文档名称', exact: true }).inputValue()
  await page.getByRole('textbox', { name: '文档名称', exact: true }).fill('临时改名')
  await page.getByRole('textbox', { name: '文档名称', exact: true }).press('Enter')
  await expect(viewer.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('临时改名')
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致')
  await page.getByRole('textbox', { name: '文档名称', exact: true }).fill(originalTitle)
  await page.getByRole('textbox', { name: '文档名称', exact: true }).press('Enter')
  await expect(viewer.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue(originalTitle)
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致')
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('#')
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('有未保存为版本的修改')
  await page.keyboard.press('Backspace')
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致')
  console.log('通过：默认直接修改草稿、不自动保存版本、多人同步、版本比较、人工保存及改回原内容。')

  await cli('snapshot', `${origin}/requirements/${requirement.id}`, '--out', snapshotFile)
  await expect(page.locator('.agent-lock-notice')).toBeVisible()
  await page.getByRole('button', { name: '取消 AI 编辑', exact: true }).click()
  await page.getByRole('button', { name: '确认取消 AI 编辑', exact: true }).click()
  await expect(editor).toBeVisible()
  await expect(viewer.locator('.agent-lock-notice')).toHaveCount(0)

  await cli('snapshot', `${origin}/requirements/${requirement.id}`, '--out', snapshotFile)
  await expect(page.locator('.agent-lock-notice')).toBeVisible()
  await expireLock(requirement.id)
  await expect(page.locator('.agent-lock-notice')).toHaveCount(0, { timeout: 15_000 })
  await expect(viewer.locator('.tiptap')).toHaveAttribute('contenteditable', 'true')
  await viewer.reload(); await hydrated(viewer)
  await expect(viewer.locator('.agent-lock-notice')).toHaveCount(0)
  await expect(viewer.locator('.tiptap')).toHaveAttribute('contenteditable', 'true')
  console.log('通过：锁到期后自动解锁，多标签和重连保持可编辑。')

  // 断线输入早于 AI 读取时，独立保留本机副本，不混入锁定的草稿。
  await page.route(`**/api/requirements/${requirement.id}/edits`, route => route.abort())
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('尚未提交的本机文字')
  await cli('snapshot', `${origin}/requirements/${requirement.id}`, '--out', snapshotFile)
  await expect(page.getByRole('button', { name: '导出本机副本并载入最新内容', exact: true })).toBeVisible()
  await expect(page.locator('.tiptap')).toContainText('尚未提交的本机文字')
  const backupDownload = page.waitForEvent('download')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '导出本机副本并载入最新内容', exact: true }).click()
  const backupPath = join(temporary, 'recovery.json')
  await (await backupDownload).saveAs(backupPath)
  expect(await readFile(backupPath, 'utf8')).toContain('尚未提交的本机文字')
  await page.unroute(`**/api/requirements/${requirement.id}/edits`)
  await expect(page.locator('.tiptap')).not.toContainText('尚未提交的本机文字')
  await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'false')
  await cli('release', '--snapshot', snapshotFile)
  await expect(editor).toBeVisible()
  console.log('通过：网页取消、Skill 解锁，以及锁定前断线输入的导出与隔离。')


  const creationFile = join(temporary, 'creation.json')
  await cli('new', '--create', '--out', creationFile)
  const creation = JSON.parse(await readFile(creationFile, 'utf8'))
  Object.assign(creation, { title: '退款申请文档', changeNote: '建立完整退款文档', properties: { priority: 'high' },
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '重复提交退款只处理一次。' }] }] } })
  await writeFile(creationFile, JSON.stringify(creation))
  const createdResult = JSON.parse((await cli('submit', '--file', creationFile)).stdout)
  expect(createdResult).toMatchObject({ status: 'applied', revision: { version: 1 } })
  expect(JSON.parse((await cli('submit', '--file', creationFile, '-t')).stdout)).toEqual(createdResult)
  await page.goto(createdResult.documentUrl); await hydrated(page)
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致')

  const perform = async (name: string, patch: Record<string, unknown>) => {
    const baselineFile = join(temporary, name + '-snapshot.json'), actionFile = join(temporary, name + '.json')
    await cli('snapshot', createdResult.requirementId, '--out', baselineFile)
    await cli('new', '--snapshot', baselineFile, '--out', actionFile)
    const input = JSON.parse(await readFile(actionFile, 'utf8'))
    Object.assign(input, { changeNote: name }, patch)
    await writeFile(actionFile, JSON.stringify(input))
    return JSON.parse((await cli('submit', '--file', actionFile)).stdout)
  }
  const draftResult = await perform('完善标题', { operations: [{ op: 'set_title', title: '退款及重复处理规则' }] })
  expect(draftResult.revision).toBeNull()
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致')
  expect(JSON.parse((await cli('revisions', createdResult.requirementId)).stdout)).toHaveLength(1)
  const saved = await perform('保存版本', { saveRevision: { changeNote: '明确退款与重复处理规则标题' } })
  expect(saved).toMatchObject({ revision: { version: 2, changeNote: '明确退款与重复处理规则标题' } })
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致')
  await perform('调整优先级', { properties: { priority: 'low' } })
  await expect(page.getByRole('region', { name: '文档常用属性', exact: true })).toContainText('低')
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致')
  expect(JSON.parse((await cli('revisions', createdResult.requirementId)).stdout)).toHaveLength(2)
  await page.getByRole('button', { name: '更多文档操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '属性变更记录', exact: true }).click()
  await expect(page.locator('.property-history')).toContainText('高 → 低')
  await expect(page.locator('.property-history')).toContainText('AI 修改')
  await page.goto(createdResult.documentUrl); await hydrated(page)
  await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致')
  await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'true')
  await page.evaluate(() => document.fonts.ready)
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.getByRole('status', { name: '版本保存状态', exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '打开 AI 编辑状态', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    if (process.env.BROWSER_TEST_ARTIFACT_DIR) await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, 'agent-direct-' + width + '.png') })
  }
  await page.goto(origin + '/requirements/' + createdResult.requirementId + '/suggestions/' + draftResult.id)
  await expect(page).toHaveURL(createdResult.documentUrl)
  await page.goto(origin + '/agent-suggestions')
  await expect(page).toHaveURL(origin + '/requirements')
  console.log('通过：直接创建、默认草稿、显式保存版本、属性日志独立、旧页面返回文档与窄屏状态。')
  await page.goto(`${origin}/account`)
  await page.getByRole('button', { name: '撤销 浏览器验证', exact: true }).click()
  await page.getByRole('dialog', { name: '撤销凭证', exact: true }).getByRole('button', { name: '确认撤销', exact: true }).click()
  await expect(page.getByText('凭证已撤销', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  console.log('通过：直接编辑、版本状态、窄屏布局、凭证撤销，无页面或水合错误。')
} catch (error) {
  if (active && !active.isClosed()) console.error('浏览器失败状态', await active.evaluate(() => ({ path: location.pathname,
    alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent) })).catch(() => '页面不可读取'))
  throw error
} finally {
  await browser?.close()
  await fixture.afterAll()
  const target = resolve(temporary)
  if (target.startsWith(resolve(tmpdir()) + sep) && target.split(sep).at(-1)?.startsWith('requirement-agent-browser-')) await rm(target, { recursive: true, force: true })
}
