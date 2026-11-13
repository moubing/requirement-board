import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { expect, type BrowserContext, type Page } from '@playwright/test'
import postgres from 'postgres'
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { DOCUMENT_NODE_CAPABILITIES } from '../../shared/editor/capabilities'

const surface = (page: Page) => page.locator('.demo-page .tiptap[contenteditable="true"]')
const paragraph = (page: Page) => surface(page).locator('[data-diff-id="demo_description"]')
async function hydrated(page: Page) {
  await expect(surface(page)).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(() => (document.querySelector('#__nuxt') as any)?.__vue_app__?.$nuxt?.isHydrating === false)
}
async function navigate(page: Page, path: string) {
  await page.evaluate(async path => { await (document.querySelector('#__nuxt') as any).__vue_app__.$nuxt.$router.push(path) }, path)
}
async function storage(page: Page) {
  return page.evaluate(async () => {
    const databases: Record<string, unknown> = {}
    for (const item of await indexedDB.databases()) {
      if (!item.name) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(item.name!); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      const records: Record<string, unknown> = {}
      for (const name of db.objectStoreNames) records[name] = await new Promise((resolve, reject) => {
        const request = db.transaction(name, 'readonly').objectStore(name).getAll()
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      databases[item.name] = records; db.close()
    }
    return { local: { ...localStorage }, session: { ...sessionStorage }, databases: JSON.stringify(databases) }
  })
}

/** 真实 SSR/路由/API/WS 与隔离测试库；不使用生产样本或业务 API 响应替身。 */
export async function verifyDemoIntegration(member: BrowserContext, origin: string, database: string) {
  const address = new URL(database)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname) || !address.pathname.endsWith('_browser_test')) throw new Error('游客验收只允许本机隔离测试库')
  const sql = postgres(database, { max: 1 })
  const snapshot = async () => {
    const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public' order by tablename`
    const hashes: Record<string, string> = {}
    for (const { tablename } of tables) {
      const result = await sql`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text, '[]')) as hash from ${sql(tablename)} t`
      hashes[tablename] = result[0]!.hash
    }
    return hashes
  }
  const browser = member.browser()!
  const anonymous = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' })
  const independent = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const page = await anonymous.newPage(), sibling = await anonymous.newPage(), other = await independent.newPage()
  const errors: string[] = [], requests: string[] = [], sockets: string[] = [], external: string[] = []
  const observe = (current: Page) => {
    current.setDefaultTimeout(15_000)
    current.on('pageerror', error => errors.push(error.message))
    current.on('console', message => { if (/hydration.*mismatch|failed to resolve component/i.test(message.text())) errors.push(message.text()) })
    current.on('request', request => { if (/^\/(api|uploads)\//.test(new URL(request.url()).pathname)) requests.push(request.url()) })
    current.on('websocket', socket => { if (new URL(socket.url()).pathname === '/collaboration') sockets.push(socket.url()) })
  }
  for (const current of [page, sibling, other]) observe(current)
  await anonymous.route('https://tracking.example/**', route => { external.push(route.request().url()); return route.abort() })
  try {
    const before = await snapshot()
    const ssr = await anonymous.request.get(`${origin}/demo?documentId=private&version=v999`)
    expect(ssr.status()).toBe(200)
    expect(await ssr.text()).toContain('游客体验')
    await page.goto(`${origin}/demo?documentId=private&version=v999`); await hydrated(page)
    const cleanStorage = await storage(page)
    await expect(page.getByRole('button', { name: '保存版本', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '图片', exact: true })).toHaveCount(0)
    await expect(page.locator('input[type=file]')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: '搜索文档号或名称', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '查看当前块历史', exact: true })).toHaveCount(0)
    await paragraph(page).click(); await page.keyboard.press('End'); await page.keyboard.insertText('临时访客甲')
    await expect(page.locator('.demo-change-state')).toHaveText('有临时修改')
    await page.keyboard.press('Control+z'); await expect(paragraph(page)).not.toContainText('临时访客甲')
    await page.keyboard.press('Control+y'); await expect(paragraph(page)).toContainText('临时访客甲')
    await page.getByRole('tab', { name: '版本比较', exact: true }).click()
    await expect(page.locator('.rich-diff')).toContainText('临时访客甲')
    await page.locator('.rich-diff__row--modified').first().hover()
    await page.getByRole('button', { name: '回退此更改', exact: true }).first().click()
    await page.getByRole('tab', { name: '正文', exact: true }).click()
    await expect(paragraph(page)).not.toContainText('临时访客甲')
    await paragraph(page).click(); await page.keyboard.press('Control+z')
    await expect(paragraph(page)).toContainText('临时访客甲')
    const task = surface(page).locator('[data-diff-id="demo_task_try"]')
    await task.getByRole('checkbox').click(); await expect(task).toHaveAttribute('data-checked', 'true')
    await page.getByRole('tab', { name: '版本比较', exact: true }).click()
    await page.getByRole('combobox', { name: '基准示例版本', exact: true }).click()
    await page.getByRole('option', { name: /v1 · 基础示例/ }).click()
    await page.getByRole('combobox', { name: '目标示例版本', exact: true }).click()
    await page.getByRole('option', { name: /v3 · 增删与结构/ }).click()
    await expect(page.getByRole('button', { name: '回退此更改', exact: true })).toHaveCount(0)
    await expect(page.locator('.rich-diff')).toContainText('删除示例：这段文字在 v3 中被移除。')
    await expect(page.locator('.rich-diff')).toContainText('新增示例：这一条补充说明从 v3 开始出现。')
    await page.getByRole('tab', { name: '正文', exact: true }).click()

    await sibling.goto(`${origin}/demo`); await hydrated(sibling)
    await other.goto(`${origin}/demo`); await hydrated(other)
    for (const current of [sibling, other]) await expect(paragraph(current)).not.toContainText('临时访客甲')
    await expect(surface(sibling).locator('[data-diff-id="demo_task_try"]')).toHaveAttribute('data-checked', 'false')
    await paragraph(sibling).click(); await sibling.keyboard.press('End'); await sibling.keyboard.insertText('临时访客乙')
    await expect(paragraph(page)).not.toContainText('临时访客乙')
    await expect(paragraph(other)).not.toContainText('临时访客乙')
    await page.reload(); await hydrated(page)
    await expect(paragraph(page)).not.toContainText('临时访客甲')

    // 所有资源入口：真实 DOM 事件、HTML、Markdown、文件拖放、斜杠菜单和保存快捷键。
    await paragraph(page).click(); await page.keyboard.press('End')
    await surface(page).evaluate(element => {
      const data = new DataTransfer(); data.items.add(new File(['fake'], 'clipboard.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
    })
    for (const [type, value] of [
      ['text/html', '<p>允许文字<img src="https://tracking.example/pixel"><img src="/uploads/private.png"><input type="image" src="https://tracking.example/input"></p>'],
      ['text/plain', '![外部图片](https://tracking.example/pixel)'],
      ['text/html', '<img src="/demo/nodes.svg?tracking=1">'],
    ]) await surface(page).evaluate((element, { type, value }) => {
      const data = new DataTransfer(); data.setData(type!, value!)
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, { type, value })
    await expect(surface(page).locator('img')).toHaveCount(1)
    await surface(page).locator('[data-diff-id="demo_end"]').click(); await page.keyboard.press('End')
    await page.keyboard.type(' /image')
    await expect(page.getByRole('menuitem', { name: /^图片/ })).toHaveCount(0)
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+s')
    await expect(page.locator('.demo-feedback[role="status"]')).toContainText('游客体验不可保存版本')
    await page.getByRole('button', { name: '重置示例', exact: true }).click()
    await expect(page.locator('.demo-change-state')).toHaveText('与示例 v3 一致')
    await paragraph(page).click(); await page.keyboard.press('Control+z')
    await expect(page.locator('.demo-change-state')).toHaveText('与示例 v3 一致')

    await paragraph(page).click(); await page.keyboard.press('End'); await page.keyboard.insertText('页面快照恢复前的临时内容')
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    await expect(paragraph(page)).not.toContainText('页面快照恢复前的临时内容')

    await page.reload(); await hydrated(page)
    await page.evaluate(() => document.fonts.ready)

    for (const width of [320, 390, 960, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ reducedMotion: width === 320 ? 'reduce' : 'no-preference', colorScheme: theme as 'light' | 'dark' })
      await expect(page.getByRole('button', { name: '重置示例', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px ${theme} 页面无横向溢出`).toBe(true)
      if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
        await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `demo-${width}-${theme}.png`), animations: 'disabled' })
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: '切换亮暗主题', exact: true }).focus(); await page.keyboard.press('Enter')
    await page.getByRole('tab', { name: '正文', exact: true }).focus(); await page.keyboard.press('ArrowRight')
    await expect(page.locator('.rich-diff')).toBeVisible()
    await page.getByRole('tab', { name: '正文', exact: true }).click()
    await paragraph(page).click(); await page.keyboard.press('End'); await page.keyboard.insertText('离开后丢弃')
    expect(await storage(page)).toEqual(cleanStorage)
    expect(requests, '游客操作零业务 API/私有图片请求').toEqual([])
    expect(sockets, '游客页面不连接协作').toEqual([])
    expect(external, '外部图片在产生请求前拦截').toEqual([])
    expect(await snapshot(), '游客编辑未修改任何数据库表').toEqual(before)

    // 退出/重新进入走真实 SPA 路由，离开即销毁临时正文。
    await page.getByRole('link', { name: '进入正式应用', exact: true }).click()
    await expect(page).toHaveURL(`${origin}/login`)
    await page.getByRole('link', { name: '无需注册，体验示例文档', exact: true }).click(); await hydrated(page)
    await expect(paragraph(page)).not.toContainText('离开后丢弃')

    for (const path of ['/api/meta', '/api/requirements', '/api/requirements/search?q=demo', '/api/requirements/private', '/api/revisions/private', '/api/requirements/private/revisions', '/api/requirements/private/related', '/api/workbench/my-work', '/uploads/asset_demo_private.png']) {
      expect((await anonymous.request.get(`${origin}${path}`, { headers: { Accept: 'application/json' }, maxRedirects: 0 })).status(), path).toBe(401)
    }
    for (const [path, method] of [['/api/requirements', 'POST'], ['/api/requirements/private', 'PATCH'], ['/api/requirements/private/revisions', 'POST'], ['/api/assets/upload', 'POST'], ['/api/requirements/private/related', 'POST'], ['/api/requirements/private/collaboration', 'POST']]) {
      expect((await anonymous.request.fetch(`${origin}${path}`, { method, headers: { Origin: origin }, data: {} })).status(), path).toBe(401)
    }
    const require = createRequire(import.meta.resolve('@hocuspocus/server'))
    const WebSocket = require('ws')
    class AnonymousSocket extends WebSocket { constructor(url: string) { super(url, { headers: { Origin: origin } }) } }
    const websocket = new HocuspocusProviderWebsocket({ url: `${origin.replace('http:', 'ws:')}/collaboration?schemaVersion=3&schemaCapabilities=${DOCUMENT_NODE_CAPABILITIES.join(',')}`, WebSocketPolyfill: AnonymousSocket })
    const doc = new Y.Doc()
    let refusal = '', authenticated = false
    const provider = new HocuspocusProvider({ name: 'req_demo_probe', document: doc, websocketProvider: websocket, token: '',
      onAuthenticationFailed: ({ reason }) => { refusal = reason }, onAuthenticated: () => { authenticated = true } })
    provider.attach()
    try { await expect.poll(() => refusal).toContain('permission-denied'); expect(authenticated).toBe(false) }
    finally { provider.destroy(); websocket.destroy(); doc.destroy() }

    // 真实登录账号保留原共同草稿、正式版本、Yjs、个人备份和身份；游客副本仍无业务请求。
    const created = await member.request.post(`${origin}/api/requirements`, { data: { title: '游客隔离验收的真实文档', templateId: null } })
    expect(created.ok()).toBe(true)
    const real = await created.json() as { id: string }
    const signed = await member.newPage()
    observe(signed)
    try {
      await signed.goto(`${origin}/requirements/${real.id}`)
      await expect(signed.locator('.tiptap[contenteditable="true"]')).toBeVisible({ timeout: 30_000 })
      await signed.locator('.tiptap p').first().click(); await signed.keyboard.insertText('真实草稿必须保留')
      await expect.poll(async () => {
        const rows = await sql`select content_json::text as content from requirement_collaboration_documents where requirement_id=${real.id}`
        return rows[0]?.content
      }).toContain('真实草稿必须保留')
      const identity = await signed.evaluate(() => JSON.stringify((document.querySelector('#__nuxt') as any).__vue_app__.$nuxt.payload.state['account-access']))
      await navigate(signed, '/demo'); await hydrated(signed)
      const memberBefore = await snapshot(), memberStorage = await storage(signed)
      const memberRequests: string[] = []
      signed.on('request', request => { if (/^\/(api|uploads)\//.test(new URL(request.url()).pathname)) memberRequests.push(request.url()) })
      await paragraph(signed).click(); await signed.keyboard.press('End'); await signed.keyboard.insertText('登录者临时内容')
      await signed.getByRole('button', { name: '重置示例', exact: true }).click()
      expect(memberRequests).toEqual([])
      expect(await storage(signed)).toEqual(memberStorage)
      expect(await snapshot()).toEqual(memberBefore)
      expect(await signed.evaluate(() => JSON.stringify((document.querySelector('#__nuxt') as any).__vue_app__.$nuxt.payload.state['account-access']))).toBe(identity)
      await navigate(signed, `/requirements/${real.id}`)
      await expect(signed.locator('.tiptap[contenteditable="true"]')).toContainText('真实草稿必须保留')
    } finally { await signed.close() }
    expect(errors).toEqual([])
    console.log('通过：游客 SSR、真实编辑/撤销/比较/局部恢复/重置、多标签隔离、资源与请求隔离、无数据库写入、匿名 API/WS 拒绝、登录草稿保留、亮暗窄屏及键盘。')
  } finally { await anonymous.close(); await independent.close(); await sql.end() }
}
