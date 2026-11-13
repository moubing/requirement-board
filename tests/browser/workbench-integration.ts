import { expect, type BrowserContext, type Page } from '@playwright/test'
import { shanghaiDate } from '../../shared/workbench/home'

type Status = { id: string; code: string; name: string }
// 真实登录与数据库：首页数字、负载格子与带同样筛选的列表数量一致，拖拽/撤销/菜单写入真实状态。
export async function verifyWorkbenchIntegration(context: BrowserContext, origin: string) {
  const meta = await (await context.request.get(`${origin}/api/meta`)).json() as { currentUserId: string; statuses: Status[] }
  const status = (code: string) => meta.statuses.find(item => item.code === code)!
  async function create(title: string, documentType: string) {
    const response = await context.request.post(`${origin}/api/requirements`, { data: { title, documentType, templateId: null, assigneeIds: [meta.currentUserId] } })
    expect(response.ok()).toBe(true)
    return await response.json() as { id: string; key: string }
  }
  async function move(id: string, codes: string[]) {
    for (const code of codes) expect((await context.request.patch(`${origin}/api/requirements/${id}`, { data: { statusId: status(code).id } })).ok()).toBe(true)
  }
  const total = async (query: Record<string, string>) =>
    (await (await context.request.get(`${origin}/api/requirements`, { params: { ...query, pageSize: '1' } })).json() as { total: number }).total
  const current = async (id: string) => (await (await context.request.get(`${origin}/api/requirements/${id}`)).json() as { status: { code: string } }).status.code

  const queued = await create('工作台拖拽回归', 'requirement')
  const doing = await create('工作台进行中回归', 'defect')
  const testing = await create('工作台验证回归', 'todo')
  const instruction = await create('工作台排除说明回归', 'instruction')
  await move(doing.id, ['doing'])
  await move(testing.id, ['doing', 'testing'])

  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (/hydration|failed to resolve component/i.test(message.text())) errors.push(message.text()) })
  const column = (code: string) => page.locator(`[data-flow-column="${code}"]`)
  const card = (key: string) => page.locator(`[data-flow-card="${key}"]`)
  try {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(origin)
    await expect(card(queued.key)).toBeVisible()
    await expectNumbers(page, total, status)
    // 说明的状态与工作流不对应，不出现在首页。
    await expect(card(instruction.key)).toHaveCount(0)
    await expect(card(testing.key)).toContainText('等你验证')

    // 负载每个格子与列表筛选数量一致，含未指派行。
    const load = page.getByRole('region', { name: '负载', exact: true })
    await expect(load.locator('[data-load-row]').last()).toHaveAttribute('data-load-row', 'unassigned')
    for (const row of await load.locator('[data-load-row]').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.loadRow!))) {
      for (const code of ['queued', 'doing', 'testing']) {
        const text = await load.locator(`[data-load-row="${row}"] [data-load-cell="${code}"]`).textContent()
        expect(Number(text?.trim() || 0), `${row} ${code}`).toBe(await total({ assignee: row, statusId: status(code).id }))
      }
    }

    // 真实拖拽：提交时带上看到的状态；撤销恢复。
    await drag(page, card(queued.key), column('doing'))
    await expect(column('doing').locator(`[data-flow-card="${queued.key}"]`)).toBeVisible()
    await expect(page.locator('.bing-toast').filter({ hasText: `已将 ${queued.key} 改为进行中` })).toBeVisible()
    await expect.poll(() => current(queued.id)).toBe('doing')
    await expectNumbers(page, total, status)
    await page.getByRole('button', { name: `撤销 ${queued.key} 的状态修改`, exact: true }).click()
    await expect.poll(() => current(queued.id)).toBe('queued')
    await expect(column('queued').locator(`[data-flow-card="${queued.key}"]`)).toBeVisible()

    // 别处已改状态后，旧页面的提交返回 409，不覆盖。
    await move(doing.id, ['testing'])
    await page.getByRole('button', { name: `${doing.key} 更多操作`, exact: true }).click()
    await page.getByRole('menuitem', { name: '改为已完成', exact: true }).click()
    await expect(page.locator('.bing-toast').filter({ hasText: `${doing.key} 未能改为已完成：状态已被他人改为「测试中」` })).toBeVisible()
    expect(await current(doing.id)).toBe('testing')

    // 菜单完成后进入今天的完成节奏。
    await expect(card(doing.key)).toBeVisible()
    await page.getByRole('button', { name: `${doing.key} 更多操作`, exact: true }).click()
    await page.getByRole('menuitem', { name: '改为已完成', exact: true }).click()
    await expect(card(doing.key)).toHaveCount(0)
    await expect.poll(() => current(doing.id)).toBe('done')
    const today = page.locator(`.rhythm__calendar [data-date="${shanghaiDate(new Date())}"]`)
    await expect(today).not.toHaveAttribute('data-level', '0')
    await today.click()
    await expect(page.locator('.rhythm__detail')).toContainText(doing.key)
    await expectNumbers(page, total, status)

    // 首页数字链接到同样筛选的列表；提出人、停滞等额外条件显示为可移除的标签。
    await page.locator('.desk-focus__chip.is-verify').click()
    await expect(page).toHaveURL(new RegExp(`/requirements\\?reporter=me&statusId=${status('testing').id}$`))
    await expect(page.getByRole('group', { name: '其他筛选条件', exact: true })).toContainText('提出人：我')
    // 列表的视图与条数沿用会话偏好，只比较总数。
    await expect(page.locator('.workspace-count')).toHaveText(`共 ${await total({ reporter: 'me', statusId: status('testing').id })} 条`)
    await page.getByRole('button', { name: '移除提出人筛选', exact: true }).click()
    await expect(page.getByRole('group', { name: '其他筛选条件', exact: true })).toHaveCount(0)
    await page.goto(origin)
    await column('queued').locator('.flow-column__num').click()
    await expect(page).toHaveURL(new RegExp(`/requirements\\?assignee=me&statusId=${status('queued').id}$`))
    await expect(page.locator('.workspace-count')).toHaveText(`共 ${await total({ assignee: 'me', statusId: status('queued').id })} 条`)
    await page.goto(origin)
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    expect(errors).toEqual([])
    console.log('通过：首页四个数字和负载格子与列表一致，说明不进入工作流，拖拽/撤销/冲突/菜单完成写入真实状态并进入完成节奏，SSR 无水合错误。')
  } finally { await page.close() }
}

async function expectNumbers(page: Page, total: (query: Record<string, string>) => Promise<number>, status: (code: string) => Status) {
  for (const code of ['queued', 'doing', 'testing']) {
    await expect(page.locator(`[data-flow-column="${code}"] .flow-column__num`)).toHaveText(String(await total({ assignee: 'me', statusId: status(code).id })))
  }
  const verify = await total({ reporter: 'me', statusId: status('testing').id }), stale = await total({ assignee: 'me', stale: '1' })
  if (verify) await expect(page.locator('.desk-focus__chip.is-verify')).toHaveAttribute('aria-label', `${verify} 条等你验证，查看列表`)
  else await expect(page.locator('.desk-focus__chip.is-verify')).toHaveCount(0)
  if (stale) await expect(page.locator('.desk-focus__chip.is-stale')).toHaveAttribute('aria-label', `${stale} 条停滞，查看列表`)
  else await expect(page.locator('.desk-focus__chip.is-stale')).toHaveCount(0)
}

async function drag(page: Page, source: ReturnType<Page['locator']>, target: ReturnType<Page['locator']>) {
  await source.scrollIntoViewIfNeeded()
  const from = (await source.boundingBox())!, to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 3 })
  await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 12 })
  await page.mouse.up()
}
