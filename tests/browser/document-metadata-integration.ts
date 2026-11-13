import { expect, type BrowserContext, type Page, type Request, type Route } from '@playwright/test'

export async function verifyDocumentMetadataPersistence(page: Page, context: BrowserContext, origin: string, id: string) {
  const path = `/api/requirements/${id}`
  const before = await (await context.request.get(origin + path)).json()
  const peer = await context.newPage()
  const requests: { method: string; path: string }[] = []
  const failed: string[] = []
  const observe = (request: Request) => {
    const path = new URL(request.url()).pathname
    if (path === '/api/requirements' || path === `/api/requirements/${id}`) requests.push({ method: request.method(), path })
  }
  const observeFailure = (request: Request) => { if (request.url().includes('/api/requirements')) failed.push(request.url()) }
  try {
    await peer.goto(`${origin}/requirements/${id}`)
    await expect(peer.locator('.tiptap[contenteditable="true"]')).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle'); await peer.waitForLoadState('networkidle')
    const body = await page.locator('.tiptap').innerText()
    page.on('request', observe); page.on('requestfailed', observeFailure)
    const title = page.getByRole('textbox', { name: '文档名称', exact: true })
    await title.fill('独立改名网络验证')
    await title.press('Enter')
    await expect(peer.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('独立改名网络验证')
    await page.waitForLoadState('networkidle')
    expect(requests.filter(request => request.method === 'PATCH')).toHaveLength(1)
    expect(requests.filter(request => request.method === 'GET' && request.path === '/api/requirements')).toHaveLength(0)
    expect(requests.filter(request => request.method === 'GET' && request.path === path)).toHaveLength(0)
    expect(failed).toEqual([])
    const renamed = await (await context.request.get(origin + path)).json()
    expect(renamed.title).toBe('独立改名网络验证')
    expect(renamed.currentRevision.id).toBe(before.currentRevision.id)
    expect(renamed.currentRevision.title).toBe(before.currentRevision.title)
    expect(await page.locator('.tiptap').innerText()).toBe(body)
    await expect(page.getByLabel('版本保存状态')).toHaveText('与最新版本一致')

    requests.length = 0
    await page.getByRole('combobox', { name: '优先级', exact: true }).click()
    await page.getByRole('option', { name: '高', exact: true }).click()
    await expect(peer.getByRole('combobox', { name: '优先级', exact: true })).toContainText('高')
    await page.waitForLoadState('networkidle')
    expect(requests.filter(request => request.method === 'PATCH')).toHaveLength(1)
    expect(requests.filter(request => request.method === 'GET' && request.path === '/api/requirements')).toHaveLength(0)
    expect(requests.filter(request => request.method === 'GET' && request.path === path)).toHaveLength(0)
    expect(failed).toEqual([])
    // 两种保存独立进行，先发请求的旧响应不能覆盖另一个字段的新结果。
    for (const titleFirst of [true, false]) {
      let received = false
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const nextTitle = titleFirst ? '交错保存标题一' : '交错保存标题二'
      const priority = titleFirst ? 'low' : 'medium'
      const label = titleFirst ? '低' : '中'
      const handler = async (route: Route) => {
        const request = route.request()
        const body = request.method() === 'PATCH' ? request.postDataJSON() : null
        if (body && (titleFirst ? body.title === nextTitle : body.priority === priority)) {
          const response = await route.fetch()
          received = true
          await gate
          await route.fulfill({ response })
        } else await route.continue()
      }
      const rename = async () => { await title.fill(nextTitle); await title.press('Enter') }
      const changePriority = async () => {
        await page.getByRole('combobox', { name: '优先级', exact: true }).click()
        await page.getByRole('option', { name: label, exact: true }).click()
      }
      await page.route(origin + path, handler)
      try {
        await (titleFirst ? rename() : changePriority())
        await expect.poll(() => received).toBe(true)
        await (titleFirst ? changePriority() : rename())
        await expect.poll(async () => (await (await context.request.get(origin + path)).json()).title).toBe(nextTitle)
        await expect.poll(async () => (await (await context.request.get(origin + path)).json()).priority).toBe(priority)
        release()
        await expect(title).toBeEnabled()
        await expect(page.getByRole('combobox', { name: '优先级', exact: true })).toBeEnabled()
        await expect(title).toHaveValue(nextTitle)
        await expect(page.getByRole('combobox', { name: '优先级', exact: true })).toContainText(label)
      } finally { release(); await page.unroute(origin + path, handler) }
    }
    await page.reload()
    await expect(title).toHaveValue('交错保存标题二')
    await expect(page.locator('.tiptap[contenteditable="true"]')).toBeVisible()
    await title.fill(before.title); await title.press('Enter')
    await expect(peer.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue(before.title)
    console.log('通过：标题独立持久化与刷新恢复、双标签同步、交错响应不覆盖其他字段、历史版本及正文不变；改名和属性操作只失效查询缓存，不请求全量列表或重复详情。')
  } finally {
    page.off('request', observe); page.off('requestfailed', observeFailure)
    await peer.close()
  }
}
