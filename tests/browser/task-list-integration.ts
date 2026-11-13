import { expect, type BrowserContext } from '@playwright/test'

/** 真实 Nuxt、HTTP 原始编辑、WebSocket、数据库与正式版本；不替换编辑/保存实现。 */
export async function verifyTaskListIntegration(context: BrowserContext, origin: string) {
  const created = await context.request.post(`${origin}/api/requirements`, { data: { title: '任务清单协作验收', templateId: null } })
  expect(created.ok()).toBe(true)
  const document = await created.json() as { id: string }
  const path = `${origin}/requirements/${document.id}`
  const local = await context.newPage(), remote = await context.newPage(), legacy = await context.newPage()
  for (const page of [local, remote, legacy]) page.setDefaultTimeout(15_000)
  const errors: string[] = []
  local.on('pageerror', error => errors.push(error.message)); remote.on('pageerror', error => errors.push(error.message))
  try {
    await Promise.all([local.goto(path), remote.goto(path)])
    await expect(local.locator('.tiptap[contenteditable="true"]')).toBeVisible({ timeout: 20_000 })
    await expect(remote.locator('.tiptap[contenteditable="true"]')).toBeVisible({ timeout: 20_000 })
    await local.locator('.tiptap p').first().click()
    await local.getByRole('button', { name: '任务清单', exact: true }).click()
    await local.keyboard.insertText('验收标准')
    const localTask = local.locator('.tiptap .requirement-task-item').first()
    const remoteTask = remote.locator('.tiptap .requirement-task-item').first()
    await expect(remoteTask).toContainText('验收标准')
    await localTask.getByRole('checkbox').click()
    await expect(remoteTask).toHaveAttribute('data-checked', 'true')
    await remoteTask.locator('p').first().click(); await remote.keyboard.press('End'); await remote.keyboard.insertText('：协作者补充')
    await expect(localTask).toContainText('协作者补充')
    await localTask.locator('p').first().click(); await local.keyboard.press('Control+z')
    await expect(localTask).toHaveAttribute('data-checked', 'false')
    await expect(remoteTask).toHaveAttribute('data-checked', 'false')
    await expect(localTask).toContainText('协作者补充')
    await local.getByRole('button', { name: '保存版本', exact: true }).click()
    await local.locator('#revision-note').fill('任务清单真实协作验收')
    await local.getByRole('dialog').getByRole('button', { name: '确认保存版本', exact: true }).click()
    await expect(local.getByRole('dialog')).toBeHidden()
    await expect.poll(async () => {
      const detail = await (await context.request.get(`${origin}/api/requirements/${document.id}`)).json()
      return detail.currentRevision.contentText
    }).toBe('[ ] 验收标准：协作者补充')
    await localTask.getByRole('checkbox').click()
    await expect(remoteTask).toHaveAttribute('data-checked', 'true')
    await remote.reload()
    await expect(remoteTask).toHaveAttribute('data-checked', 'true', { timeout: 20_000 })
    await local.getByRole('tab', { name: '版本比较', exact: true }).click()
    await expect(local.locator('.diff-block--modified').getByRole('img', { name: '已勾选', exact: true }).first()).toBeVisible()
    await expect(local.locator('.diff-block--modified').getByRole('img', { name: '未勾选', exact: true }).first()).toBeVisible()

    // 模拟旧页面的 WS 握手，保证它不能接入后过滤不认识的任务节点。
    const refusals: string[] = []
    const legacySockets: string[] = []
    legacy.on('websocket', socket => {
      legacySockets.push(socket.url())
      socket.on('framereceived', ({ payload }) => refusals.push(payload.toString()))
    })
    await legacy.addInitScript(() => {
      const NativeWebSocket = window.WebSocket
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          const address = new URL(url, location.href)
          if (address.pathname === '/collaboration') address.searchParams.delete('schemaCapabilities')
          super(address, protocols)
        }
      }
    })
    await legacy.goto(path)
    // Hocuspocus 将认证异常编码为 permission-denied；HTTP 返回具体刷新提示。
    await expect.poll(() => refusals.some(frame => frame.includes('permission-denied'))).toBe(true)
    expect(legacySockets.some(address => address.includes('/collaboration?schemaVersion=3') && !address.includes('schemaCapabilities'))).toBe(true)
    await expect(remoteTask).toHaveAttribute('data-checked', 'true')
    expect(errors).toEqual([])
    console.log('通过：真实 HTTP/WS 双页勾选同步、远端文字与本地撤销、保存版本、重载、Diff 和旧页面握手拦截。')
  } finally { await Promise.all([local.close(), remote.close(), legacy.close()]) }
}
