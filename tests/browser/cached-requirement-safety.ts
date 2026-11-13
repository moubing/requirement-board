import { expect as baseExpect, type BrowserContext, type Page } from '@playwright/test'

/** 真实 Nuxt 缓存恢复：在隐藏期间发生的协作、锁、权限及账号变化。 */
export async function verifyCachedRequirementSafety(page: Page, context: BrowserContext, origin: string, id: string, timeout = 5000) {
  const expect = baseExpect.configure({ timeout })
  const editor = page.locator('.tiptap[contenteditable="true"]')
  const body = page.locator('.tiptap')
  async function navigate(path: string) {
    await page.evaluate(path => {
      const root = document.querySelector('#__nuxt') as HTMLElement & { __vue_app__: { $nuxt: { $router: { push(path: string): Promise<unknown> } } } }
      return root.__vue_app__.$nuxt.$router.push(path)
    }, path)
  }
  const original = await editor.elementHandle()
  await navigate('/')
  const other = await context.newPage()
  try {
    await other.goto(`${origin}/requirements/${id}`)
    const remoteEditor = other.locator('.tiptap[contenteditable="true"]')
    await expect(remoteEditor).toBeVisible()
    await remoteEditor.click(); await other.keyboard.press('Control+End')
    const accepted = other.waitForResponse(response => response.url().endsWith(`/api/requirements/${id}/edits`) && response.request().method() === 'POST' && response.ok())
    await other.keyboard.insertText('REQ-10 隐藏期间的远端增量')
    await accepted
  } finally { await other.close() }
  await navigate(`/requirements/${id}`)
  await expect(editor).toContainText('REQ-10 隐藏期间的远端增量')
  expect(await editor.evaluate((node, before) => node === before, original)).toBe(true)

  // 并行读取时，无论详情还是协作响应先到，另一项未核对完成都不能开放输入。
  for (const held of ['detail', 'collaboration'] as const) {
    await navigate('/')
    const detailUrl = (url: URL) => url.pathname === `/api/requirements/${id}`
    const collaborationUrl = `**/api/requirements/${id}/collaboration`
    const heldUrl = held === 'detail' ? detailUrl : collaborationUrl
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route(heldUrl, async route => { await gate; await route.continue() })
    try {
      const otherResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/requirements/${id}${held === 'detail' ? '/collaboration' : ''}` && response.ok())
      await navigate(`/requirements/${id}`)
      await otherResponse
      await expect(body).toHaveAttribute('contenteditable', 'false')
      release()
      await expect(editor).toBeVisible()
    } finally { release(); await page.unroute(heldUrl) }
  }

  // 非关键数据仍会刷新，但慢响应/失败不能阻塞已经通过授权与协作核对的正文。
  await navigate('/')
  let releaseAuxiliary!: () => void
  const auxiliaryGate = new Promise<void>(resolve => { releaseAuxiliary = resolve })
  let auxiliaryRequests = 0
  const revisionsUrl = `**/api/requirements/${id}/revisions`
  const relatedUrl = `**/api/requirements/${id}/related`
  await page.route(revisionsUrl, async route => { auxiliaryRequests++; await auxiliaryGate; await route.continue() })
  await page.route(relatedUrl, async route => {
    auxiliaryRequests++; await auxiliaryGate
    await route.fulfill({ status: 503, json: { statusCode: 503, message: '验证关联信息暂不可用' } })
  })
  try {
    await navigate(`/requirements/${id}`)
    await expect.poll(() => auxiliaryRequests).toBe(2)
    await expect(editor).toBeVisible()
    const failed = page.waitForResponse(response => response.url().endsWith(`/api/requirements/${id}/related`) && response.status() === 503)
    releaseAuxiliary()
    await failed
    await expect(editor).toBeVisible()
  } finally {
    releaseAuxiliary()
    await page.unroute(revisionsUrl); await page.unroute(relatedUrl)
  }

  // 隐藏时没有 WebSocket 订阅；恢复必须先读取锁与新代次，不能短暂开放输入。
  await navigate('/')
  const tokenResponse = await context.request.post(`${origin}/api/account/agent-tokens`, { data: { name: 'REQ-10 隔离缓存验证', expiresInDays: 1 } })
  expect(tokenResponse.ok()).toBe(true)
  const credential = await tokenResponse.json() as { id: string; token: string }
  const headers = { Authorization: `Bearer ${credential.token}` }
  const snapshot = await context.request.post(`${origin}/api/agent/v1/requirements/${id}/snapshot`, { headers, data: {} })
  expect(snapshot.ok()).toBe(true)
  const snapshotId = (await snapshot.json()).id as string
  try {
    await navigate(`/requirements/${id}`)
    await expect(body).toHaveAttribute('contenteditable', 'false')
    await expect(page.locator('.requirement-page')).toHaveClass(/requirement-page--locked/)
    expect(await body.evaluate((node, before) => node === before, original)).toBe(true)
  } finally {
    const released = await context.request.post(`${origin}/api/agent/v1/requirements/${id}/lock`, { headers, data: { snapshotId, action: 'release' } })
    expect(released.ok()).toBe(true)
    expect((await context.request.post(`${origin}/api/account/agent-tokens/${credential.id}/revoke`, { data: {} })).ok()).toBe(true)
  }
  await expect(editor).toBeVisible()
  await original?.dispose()

  // 详情已不可访问时备份并移除缓存，之后恢复权限也不能拿回旧实例。
  const unavailable = await editor.elementHandle()
  await navigate('/')
  const detailUrl = (url: URL) => url.pathname === `/api/requirements/${id}`
  await page.route(detailUrl, route => route.fulfill({ status: 403, json: { statusCode: 403, message: '缓存验证：访问资格变化' } }))
  await navigate(`/requirements/${id}`)
  await expect(page).toHaveURL(`${origin}/requirements`)
  await expect(body).toHaveCount(0)
  await page.unroute(detailUrl)
  await navigate(`/requirements/${id}`)
  await expect(editor).toBeVisible()
  expect(await editor.evaluate((node, before) => node !== before, unavailable)).toBe(true)
  await unavailable?.dispose()

  const previousAccount = await editor.elementHandle()
  await navigate('/')
  await page.getByRole('button', { name: /^用户菜单：/ }).click()
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/login`)
  const { TEST_USER_PASSWORD } = await import('../setup/db')
  const login = await context.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { Origin: origin }, data: { email: 'mobing@example.com', password: TEST_USER_PASSWORD },
  })
  expect(login.ok(), await login.text()).toBe(true)
  await navigate(`/requirements/${id}`)
  await expect(editor).toBeVisible()
  expect(await editor.evaluate((node, before) => node !== before, previousAccount)).toBe(true)
  await previousAccount?.dispose()
  console.log('通过：详情/协作双重恢复门禁、慢/失败的辅助信息不阻塞、远端增量、AI 锁/代次、403 淘汰及账号隔离。')
}
