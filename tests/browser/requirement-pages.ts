import { expect, type BrowserContext, type Request } from '@playwright/test'
import type { RequirementPage } from '../../shared/requirements/query'

export async function verifyRequirementPages(context: BrowserContext, origin: string) {
  const meta = await (await context.request.get(`${origin}/api/meta`)).json()
  const docs: { id: string; key: string; title: string }[] = []
  for (let i = 1; i <= 45; i++) {
    const response = await context.request.post(`${origin}/api/requirements`, { data: {
      title: `分页回归 ${String(i).padStart(2, '0')}${i === 1 ? '：长标题需要在单元格内完整换行。'.repeat(8) : ''}`,
      templateId: null, assigneeIds: i % 2 ? [meta.currentUserId] : [],
    } })
    expect(response.ok()).toBe(true)
    const doc = await response.json()
    docs.push(doc)
    if (i % 3 === 0) {
      const patched = await context.request.patch(`${origin}/api/requirements/${doc.id}`, { data: { statusId: meta.statuses.find((status: { code: string }) => status.code === 'doing').id } })
      expect(patched.ok()).toBe(true)
    }
  }
  const page = await context.newPage()
  const requests: URL[] = []
  const errors: string[] = []
  const observe = (request: Request) => { const url = new URL(request.url()); if (url.pathname === '/api/requirements' && request.method() === 'GET') requests.push(url) }
  page.on('request', observe); page.on('pageerror', error => errors.push(error.message))
  const path = `${origin}/requirements?q=${encodeURIComponent('分页回归')}`
  const table = page.locator('.requirements-list-page .paged-requirements').first()
  const rows = table.locator('.requirement-key-link')
  const current = table.locator('[aria-current="page"]')
  const expected = async (query: Record<string, string | number>) => (await (await context.request.get(`${origin}/api/requirements`, { params: query })).json()) as RequirementPage
  try {
    await page.goto(path)
    await expect(rows).toHaveCount(10)
    await expect(page.locator('.workspace-count')).toHaveText('共 45 条')
    const before = requests.length
    await table.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(current).toHaveText('2')
    expect(requests.length - before).toBe(1)
    expect(await rows.allTextContents()).toEqual((await expected({ q: '分页回归', page: 2, pageSize: 10 })).items.map(item => item.key))
    // 服务端文本排序先作用于全集，表格不对当前页二次重排。
    await table.getByRole('button', { name: '文档标题', exact: true }).click()
    await expect(current).toHaveText('1')
    await expect(rows.first()).toHaveText(docs[0]!.key)
    const titleBox = await table.locator('.requirement-title-link').first().boundingBox()
    expect(titleBox!.height).toBeGreaterThan(40)
    await table.getByRole('button', { name: '末页', exact: true }).click()
    await expect(current).toHaveText('5')
    await expect(rows).toHaveCount(5)
    // 失败保留最后成功的第五页；重试后才将显示页改为第四页。
    await page.route('**/api/requirements?*', route => new URL(route.request().url()).searchParams.get('page') === '4'
      ? route.fulfill({ status: 503, json: { message: '分页读取失败' } }) : route.continue())
    await table.getByRole('button', { name: '上一页', exact: true }).click()
    await expect(table.getByRole('alert')).toContainText('已保留')
    await expect(current).toHaveText('5')
    await expect(rows).toHaveCount(5)
    await page.unroute('**/api/requirements?*')
    await table.getByRole('button', { name: '重试', exact: true }).click()
    await expect(current).toHaveText('4')

    requests.length = 0
    await page.getByRole('tab', { name: '按状态分组', exact: true }).click()
    const groups = page.getByRole('region', { name: '按状态分组的文档列表', exact: true })
    await expect(groups.locator('.requirement-key-link')).toHaveCount(10)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.searchParams.has('statusId')).toBe(true)
    await page.getByRole('button', { name: '收起待处理分组', exact: true }).click()
    await expect(groups.locator('.requirement-key-link')).toHaveCount(0)
    const columns = page.getByRole('button', { name: '所有分组的列设置', exact: true })
    await columns.click()
    const typeColumn = page.getByRole('checkbox', { name: '显示列：类型', exact: true })
    await typeColumn.focus(); await typeColumn.press('Space')
    await expect(typeColumn).not.toBeChecked()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '展开进行中分组', exact: true }).click()
    await expect(groups.locator('.requirement-key-link')).toHaveCount(10)
    await expect(groups.getByRole('button', { name: '类型', exact: true })).toHaveCount(0)
    await groups.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(groups.locator('[aria-current="page"]')).toHaveText('2')
    await expect(groups.locator('.requirement-key-link')).toHaveCount(5)
    await page.getByRole('button', { name: '收起进行中分组', exact: true }).click()
    await page.getByRole('button', { name: '展开进行中分组', exact: true }).click()
    await expect(groups.locator('[aria-current="page"]')).toHaveText('2')
    await page.getByRole('tab', { name: '全部列表', exact: true }).click()
    await expect(current).toHaveText('4')
    await expect(table.getByRole('button', { name: '类型', exact: true })).toHaveCount(0)

    await page.goto(origin)
    // 首页是个人工作流与全项目动态，不再有分页表格。
    await expect(page.locator('[data-flow-column]')).toHaveCount(3)
    await expect(page.getByRole('complementary', { name: '项目动态', exact: true }).locator('.activity__item').first()).toBeVisible()
    // 最早的文档不在默认首页中，仍能通过全范围检索、关联候选和最近浏览使用。
    const target = docs[0]!, another = docs[1]!
    const search = page.getByRole('combobox', { name: '搜索文档号或名称', exact: true })
    await search.click()
    await search.fill(target.key)
    await expect(page.getByRole('option').first()).toContainText(target.key)
    await search.press('Enter')
    await expect(page).toHaveURL(`${origin}/requirements/${target.id}`)
    await expect(page.locator('.tiptap[contenteditable="true"]')).toBeVisible()
    await page.getByRole('tab', { name: '文档信息', exact: true }).click()
    await page.getByRole('button', { name: '添加关联文档', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '添加关联文档', exact: true })
    await expect(picker.getByRole('checkbox')).toHaveCount(8)
    const first = picker.getByRole('checkbox').first()
    await first.focus(); await first.press('Space')
    await picker.getByRole('button', { name: '下一页文档', exact: true }).click()
    await expect(picker.locator('.related-picker__pagination')).toContainText('2 /')
    await expect(picker.getByText('已选择 1 篇', { exact: true })).toBeVisible()
    await picker.getByRole('searchbox', { name: '搜索关联文档', exact: true }).fill(another.title)
    await expect(picker.getByRole('checkbox')).toHaveCount(1)
    await picker.getByRole('checkbox').focus(); await picker.getByRole('checkbox').press('Space')
    await expect(picker.getByText('已选择 2 篇', { exact: true })).toBeVisible()
    await picker.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '文档', exact: true }).click()
    await page.getByRole('button', { name: '最近浏览', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: `${target.key}（${target.title}）`, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    expect(errors).toEqual([])
    console.log('通过：45 条文档服务端分页/排序、失败保留与重试、分组按需加载及共享列偏好、首页工作台、跨页搜索/关联/最近浏览、窄屏。')
  } catch (error) {
    console.error('分页验证失败状态', await page.evaluate(() => ({ path: location.pathname,
      alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent),
      currentPages: [...document.querySelectorAll('[aria-current="page"]')].map(node => node.textContent) })))
    throw error
  } finally { await page.close() }
}
