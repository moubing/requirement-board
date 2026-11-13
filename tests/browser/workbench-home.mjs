import { expect } from '@playwright/test'
import { verifyWorkbenchLayout } from './workbench-layout.mjs'

// 首页工作台：固定接口数据下的布局、拖拽/菜单/撤销、冲突与锁定、动态、负载、完成节奏、区块重试及窄屏。
const card = (scope, key) => scope.locator(`[data-flow-card="${key}"]`)
const column = (page, code) => page.locator(`[data-flow-column="${code}"]`)
const dock = (page, code) => page.locator(`[data-flow-dock="${code}"]`)
const toast = (page, text) => page.locator('.bing-toast').filter({ hasText: text })
const fixture = (page, run, arg) => page.evaluate(run, arg)
const patches = page => fixture(page, () => window.workspaceFixture.workbenchRequests.filter(item => item.name === 'patch').map(({ id, body }) => ({ id, ...body })))

async function center(locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('缺少拖动位置')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
/** 真实鼠标：越过阈值后分步移到目标；目标可在拖动开始后才出现（底部投放区）。 */
async function mouseDrag(page, source, target, { release = true, check } = {}) {
  // 上次放下或 Escape 的收尾结束后再开始下一次手势。
  await expect(page.locator('[data-dnd-dropping]')).toHaveCount(0)
  await expect(page.locator('[data-dnd-dragging]')).toHaveCount(0)
  await expect(page.locator('.bing-drag-overlay .flow-card')).toHaveCount(0)
  const from = await center(source)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 })
  const destination = typeof target === 'function' ? target() : target
  const to = await center(destination)
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await expect(destination).toHaveClass(/is-over/)
  if (check) await check()
  if (release) await page.mouse.up()
}
/** 触摸长按：按住超过 touchDelay 后再移动。 */
async function touchDrag(page, source, target, check) {
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ x: point.x, y: point.y }] : [] })
  const from = await center(source)
  await touch('touchStart', from)
  await page.waitForTimeout(450)
  for (let step = 1; step <= 3; step++) await touch('touchMove', { x: from.x, y: from.y - step * 6 })
  const to = await center(target())
  for (let step = 1; step <= 12; step++) await touch('touchMove', { x: from.x + (to.x - from.x) * step / 12, y: from.y - 18 + (to.y - from.y + 18) * step / 12 })
  if (check) await check()
  await touch('touchEnd')
  await cdp.detach()
}
async function noHorizontalOverflow(page) {
  // 显式启用横向滚动的负载和日历可在自身视口内溢出，页面及纵向列表不能被撑宽。
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.app-page-scroll .bing-scrollbar__viewport, html')]
    .filter(element => !element.parentElement?.classList.contains('is-horizontal') && element.scrollWidth > element.clientWidth + 1)
    .map(element => ({ label: element.getAttribute('aria-label') ?? element.tagName, width: element.clientWidth, scrollWidth: element.scrollWidth })))).toEqual([])
}
async function open(page, url, query = '') {
  await page.goto(`${url}?page=dashboard${query}`)
  await expect(page.locator('.flow-board')).toBeVisible()
  // 测试页的 NuxtLink 是普通链接：记录点击目标，不真的离开页面。
  await page.evaluate(() => {
    window.openedLinks = []
    document.addEventListener('click', event => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (link) { event.preventDefault(); window.openedLinks.push(link.getAttribute('href')) }
    }, true)
  })
}

export async function verifyWorkbenchHome(page, url, screenshot) {
  await page.setViewportSize({ width: 1440, height: 960 })
  await open(page, url)
  const verifyChip = page.locator('.desk-focus__chip.is-verify'), staleChip = page.locator('.desk-focus__chip.is-stale')
  await expect(verifyChip).toHaveAttribute('aria-label', '1 条等你验证，查看列表')
  await expect(staleChip).toHaveAttribute('aria-label', '2 条停滞，查看列表')
  await expect(verifyChip).toHaveAttribute('href', '/requirements?reporter=me&statusId=testing')
  await expect(staleChip).toHaveAttribute('href', '/requirements?assignee=me&stale=1')
  // 顶部不再有日期和问候句。
  await expect(page.getByText(/下午好|上午好|晚上好/)).toHaveCount(0)
  const number = code => column(page, code).locator('.flow-column__num')
  await expect(number('queued')).toHaveText('6')
  await expect(number('doing')).toHaveText('2')
  await expect(number('testing')).toHaveText('1')
  await expect(number('doing')).toHaveAttribute('href', '/requirements?assignee=me&statusId=doing')
  // 等我验证排在最前，其后停滞最久的排前；别人负责的验证卡另行提示。
  await expect(column(page, 'testing').locator('[data-flow-card]').first()).toHaveAttribute('data-flow-card', 'REQ-18')
  await expect(column(page, 'doing').locator('[data-flow-card]').first()).toHaveAttribute('data-flow-card', 'REQ-21')
  await expect(card(page, 'REQ-21')).toContainText('8 天没有进展')
  await expect(card(page, 'REQ-18')).toContainText('等你验证')
  await expect(page.locator('[data-flow-dock]')).toHaveCount(0)

  // 动态在右侧跟随工作流等高，列内滚动，第一行不超过视口。
  const main = await page.locator('.desk-island--flow').boundingBox(), rail = await page.locator('.desk-island--activity').boundingBox()
  expect(rail.x).toBeGreaterThanOrEqual(main.x + main.width - 1)
  expect(Math.abs(rail.height - main.height)).toBeLessThan(2)
  const board = await page.locator('.flow-board').boundingBox()
  expect(main.y + main.height - (board.y + board.height)).toBeLessThan(40)
  expect(main.y + main.height).toBeLessThanOrEqual(960)
  await expect(column(page, 'queued').locator('.flow-column__more')).toBeHidden()
  await expect(page.getByRole('tablist', { name: '切换工作流列', exact: true })).toBeHidden()
  await noHorizontalOverflow(page)
  await verifyWorkflowScroll(page, screenshot)
  await screenshot('workbench-home-1440')

  // 单击仍打开文档，不提交状态。
  await page.getByRole('link', { name: '打开 REQ-22 完成节奏日历', exact: true }).click()
  expect(await page.evaluate(() => window.openedLinks)).toEqual(['/requirements/flow-3'])
  expect(await patches(page)).toEqual([])

  // 鼠标拖到相邻列：浮层、目标提示、底部「已完成」投放区；松手后立即移动并可撤销。
  const panelBounds = () => page.locator('.desk-island').evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height }
  }))
  const boundsBeforeDrag = await panelBounds()
  let idleDock
  await mouseDrag(page, card(column(page, 'doing'), 'REQ-22'), column(page, 'testing'), { check: async () => {
    await expect(page.locator('.bing-drag-overlay')).toContainText('完成节奏日历')
    await expect(column(page, 'testing')).toHaveClass(/is-over/)
    await expect(dock(page, 'done')).toBeVisible()
    idleDock = await dock(page, 'done').boundingBox()
    await verifyDragFocus(page, true)
    expect(await panelBounds()).toEqual(boundsBeforeDrag)
    await screenshot('workbench-home-dragging')
  } })
  await expect(card(column(page, 'testing'), 'REQ-22')).toBeVisible()
  await expect(toast(page, '已将 REQ-22 改为测试中')).toBeVisible()
  await expect(number('doing')).toHaveText('1')
  await expect(number('testing')).toHaveText('2')
  // 我提出的文档进入测试中，等我验证随之增加。
  await expect(verifyChip).toHaveAttribute('aria-label', '2 条等你验证，查看列表')
  expect(await patches(page)).toEqual([{ id: 'flow-3', statusId: 'testing', expectedStatusId: 'doing' }])
  expect(await page.evaluate(() => window.openedLinks)).toEqual(['/requirements/flow-3'])
  await expect(dock(page, 'done')).toHaveCount(0)
  await verifyDragFocus(page, false)
  // 成功后工作流、负载、完成节奏和动态重新读取。
  await expect.poll(async () => (await fixture(page, () => window.workspaceFixture.workbenchRequests.map(item => item.name))).filter(name => name === 'team-load').length).toBe(2)
  await toast(page, '已将 REQ-22 改为测试中').getByRole('button', { name: '撤销 REQ-22 的状态修改', exact: true }).click()
  await expect(card(column(page, 'doing'), 'REQ-22')).toBeVisible()
  await expect(toast(page, '已撤销，REQ-22 恢复为进行中')).toBeVisible()
  expect((await patches(page)).at(-1)).toEqual({ id: 'flow-3', statusId: 'doing', expectedStatusId: 'testing' })

  // 拖到底部「已完成」：投放区贴近窗口底边，停在上面不能触发页面滚动；卡片离开工作流，停滞数减少。
  const pageScroll = () => page.evaluate(() => [...document.querySelectorAll('.app-page-scroll .bing-scrollbar__viewport, html')].map(element => element.scrollTop))
  const scrollBefore = await pageScroll()
  // 这一步看落位动画，临时打开动效。
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await mouseDrag(page, card(page, 'REQ-21'), () => dock(page, 'done'), { check: async () => {
    await expect(dock(page, 'done')).toHaveClass(/is-over/)
    await page.waitForTimeout(600)
    const expanded = await dock(page, 'done').boundingBox()
    expect(expanded.width).toBeGreaterThan(idleDock.width + 80)
    expect(expanded.height).toBeGreaterThan(idleDock.height + 32)
    expect(expanded.y).toBeLessThan(idleDock.y - 32)
    await verifyDragFocus(page, true)
    expect(await panelBounds()).toEqual(boundsBeforeDrag)
    await screenshot('workbench-drag-done-expanded')
    // 移入原投放区外、新扩出的左上部分，真实命中范围仍应接收松手。
    await page.mouse.move(expanded.x + 24, expanded.y + 24, { steps: 4 })
    await expect(dock(page, 'done')).toHaveClass(/is-over/)
    expect(await pageScroll()).toEqual(scrollBefore)
    // 记录松手后每一帧浮层的中心：卡片已离开工作流，浮层应收进投放区，不能飞向左上角。
    await page.evaluate(() => {
      window.overlayFrames = []
      const record = () => {
        const overlay = document.querySelector('.bing-drag-overlay')
        if (overlay?.querySelector('.flow-card')) {
          const rect = overlay.getBoundingClientRect()
          window.overlayFrames.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, dropping: overlay.hasAttribute('data-dnd-dropping') })
        }
        if (window.overlayFrames.length < 120) requestAnimationFrame(record)
      }
      requestAnimationFrame(record)
    })
  } })
  await expect(dock(page, 'done')).toHaveClass(/is-received/)
  const dockBox = await dock(page, 'done').boundingBox()
  await expect(dock(page, 'done')).toHaveCount(0)
  await verifyDragFocus(page, false)
  const landing = await page.evaluate(() => window.overlayFrames)
  expect(landing.filter(item => item.dropping).length).toBeGreaterThan(3)
  for (const item of landing) {
    expect(item.width).toBeGreaterThan(40)
    expect(item.x).toBeGreaterThan(dockBox.x - 24)
    expect(item.x).toBeLessThan(dockBox.x + dockBox.width + 24)
    expect(item.y).toBeGreaterThan(dockBox.y - 160)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(card(page, 'REQ-21')).toHaveCount(0)
  await expect(toast(page, '已将 REQ-21 改为已完成')).toBeVisible()
  await expect(staleChip).toHaveAttribute('aria-label', '1 条停滞，查看列表')
  await expect(number('doing')).toHaveText('1')

  // Esc 取消：不提交，卡片留在原列。
  const before = (await patches(page)).length
  await mouseDrag(page, card(page, 'BUG-7'), column(page, 'doing'), { release: false })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(card(column(page, 'queued'), 'BUG-7')).toBeVisible()
  await verifyDragFocus(page, false)
  await expect(dock(page, 'done')).toHaveCount(0)
  expect(await patches(page)).toHaveLength(before)

  // 他人已改状态：409 不覆盖，卡片按服务端最新状态显示并说明原因。
  await fixture(page, () => { window.workspaceFixture.workbenchControl.patch.push('conflict') })
  await mouseDrag(page, card(page, 'BUG-9'), column(page, 'doing'))
  await expect(toast(page, 'BUG-9 未能改为进行中：状态已被他人改为「已关闭」，本次修改未提交')).toBeVisible()
  await expect(card(page, 'BUG-9')).toHaveCount(0)

  // Agent 锁定：423，卡片回到原列。菜单提供同样的移动，键盘可操作。
  await fixture(page, () => { window.workspaceFixture.workbenchControl.patch.push('locked') })
  await page.getByRole('button', { name: 'BUG-7 更多操作', exact: true }).press('Enter')
  await page.getByRole('menuitem', { name: '改为进行中', exact: true }).press('Enter')
  await expect(toast(page, 'BUG-7 未能改为进行中：需求已由 成员乙 的 AI 锁定，当前只能查看，稍后再试')).toBeVisible()
  await expect(card(column(page, 'queued'), 'BUG-7')).toBeVisible()
  await expect(card(column(page, 'queued'), 'BUG-7')).toHaveClass(/is-flash-failed/)

  // 请求中的卡片不能再次移动。
  await fixture(page, () => { window.workspaceFixture.workbenchControl.delay = 800 })
  await page.getByRole('button', { name: 'TODO-3 更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '改为进行中', exact: true }).click()
  await expect(card(column(page, 'doing'), 'TODO-3')).toHaveClass(/is-pending/)
  await expect(page.getByRole('button', { name: 'TODO-3 更多操作', exact: true })).toBeDisabled()
  await expect(card(column(page, 'doing'), 'TODO-3')).not.toHaveClass(/is-pending/)
  await expect(toast(page, '已将 TODO-3 改为进行中')).toBeVisible()
  await fixture(page, () => { window.workspaceFixture.workbenchControl.delay = 0 })

  await verifyActivity(page)
  await verifyActivityLoading(page, screenshot)
  await verifyActivityTiming(page)
  await verifyTeam(page, screenshot)
  await verifyBlockRetry(page, url)
  await verifyNarrow(page, url, screenshot)
  await verifyWorkbenchLayout(page, url, screenshot)
}

async function verifyDragFocus(page, active) {
  await expect.poll(() => page.locator('.desk-island:not(.desk-island--flow)').evaluateAll((elements, opacity) => elements.every(element =>
    Number(getComputedStyle(element).opacity) === opacity), active ? 0.3 : 1)).toBe(true)
  await expect(page.locator('.desk-island--flow')).toHaveCSS('opacity', '1')
  if (active) await expect(page.locator('.desk-island--flow')).not.toHaveCSS('box-shadow', 'none')
}

async function verifyWorkflowScroll(page, screenshot) {
  // 限高后用真实滚轮和键盘滚动列，列头及页面保持原位，末张卡片仍可到达。
  await page.setViewportSize({ width: 1440, height: 700 })
  const queued = column(page, 'queued')
  const viewport = queued.getByRole('region', { name: '待处理的文档滚动区', exact: true })
  await expect(viewport).toHaveAttribute('tabindex', '0')
  expect(await viewport.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none')
  const header = await queued.locator('.flow-column__head').boundingBox()
  const pageViewport = page.getByRole('region', { name: '页面内容', exact: true })
  const pageTop = await pageViewport.evaluate(element => element.scrollTop)
  await queued.locator('[data-flow-card]').first().hover()
  await page.mouse.wheel(0, 140)
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  expect(await queued.locator('.flow-column__head').boundingBox()).toEqual(header)
  expect(await pageViewport.evaluate(element => element.scrollTop)).toBe(pageTop)
  await screenshot('workbench-home-column-scroll')
  await viewport.focus()
  await page.keyboard.press('End')
  await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2)
  const last = await queued.locator('[data-flow-card]').last().boundingBox()
  const frame = await viewport.boundingBox()
  expect(last.y + last.height).toBeLessThanOrEqual(frame.y + frame.height)
  await page.keyboard.press('Home')
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(0)
  await page.setViewportSize({ width: 1440, height: 960 })
}

async function verifyActivity(page) {
  const feed = page.getByRole('complementary', { name: '项目动态', exact: true })
  await expect(feed.getByRole('heading', { name: '今天', exact: true })).toBeVisible()
  await expect(feed.getByRole('heading', { name: '昨天', exact: true })).toBeAttached()
  await expect(feed.locator('.activity__item')).toHaveCount(30)
  expect(await feed.locator('.activity__item.is-mine').count()).toBeGreaterThan(0)
  for (const kind of ['status', 'assignee', 'create', 'revision', 'priority']) await expect(feed.locator(`[data-activity-kind="${kind}"]`).first()).toBeAttached()
  await expect(feed.locator('[data-activity-kind="revision"]').first()).toContainText('保存了正式版本 v')
  // 加载更早失败时保留首屏，重试必须沿用失败的游标。
  await fixture(page, () => { window.workspaceFixture.workbenchControl.fail.add('activity') })
  await feed.locator('.activity__scroll .bing-scrollbar__viewport').first().evaluate(element => element.scrollTo(0, element.scrollHeight))
  await expect(feed.getByRole('alert')).toHaveText('更早的动态暂时无法加载。')
  await expect(feed.locator('.activity__item')).toHaveCount(30)
  await feed.getByRole('button', { name: '重试', exact: true }).click()
  await expect(feed.locator('.activity__item')).toHaveCount(45)
  expect(await fixture(page, () => window.workspaceFixture.workbenchRequests.filter(item => item.name === 'activity').slice(-2).map(item => item.query.cursor))).toEqual(['30', '30'])
  await expect(feed.getByText('已经到底了', { exact: true })).toBeVisible()
  await expect(feed.getByRole('heading', { name: '更早', exact: true })).toHaveCount(1)
  // 末页和仍有下一页时刷新失败，都应从首页重试，而不是根据旧内容追加或直接返回。
  for (const count of [45, 30]) {
    if (count === 30) {
      await feed.getByRole('tab', { name: '版本', exact: true }).click()
      await expect(feed.locator('.activity__item')).toHaveCount(9)
      await feed.getByRole('tab', { name: '全部', exact: true }).click()
      await expect(feed.locator('.activity__item')).toHaveCount(30)
    }
    await feed.locator('.activity__scroll .bing-scrollbar__viewport').first().evaluate(element => element.scrollTo(0, 0))
    const requestCount = await fixture(page, () => window.workspaceFixture.workbenchRequests.filter(item => item.name === 'activity').length)
    await fixture(page, async () => {
      window.workspaceFixture.workbenchControl.fail.add('activity')
      const { useState } = await import('/tests/browser/workspace-runtime.mjs')
      useState('requirement-cache').value.generation++
    })
    await expect(feed.getByRole('alert')).toHaveText('动态刷新失败，已保留上次内容。')
    await expect(feed.locator('.activity__item')).toHaveCount(count)
    await feed.getByRole('button', { name: '重试', exact: true }).click()
    await expect(feed.getByRole('alert')).toHaveCount(0)
    const requests = await fixture(page, () => window.workspaceFixture.workbenchRequests.filter(item => item.name === 'activity').map(item => item.query))
    // 点击底部按钮可能继续触发滚动加载；先检查失败请求及紧随其后的重试都读取首页。
    expect(requests.slice(requestCount, requestCount + 2)).toEqual([{ kind: 'all', limit: 30 }, { kind: 'all', limit: 30 }])
  }
  await feed.getByRole('tab', { name: '版本', exact: true }).click()
  await expect(feed.locator('.activity__item')).toHaveCount(9)
  expect(new Set(await feed.locator('.activity__item').evaluateAll(items => items.map(item => item.dataset.activityKind)))).toEqual(new Set(['revision']))
  const last = await page.evaluate(() => window.workspaceFixture.workbenchRequests.filter(item => item.name === 'activity').at(-1).query)
  expect(last).toMatchObject({ kind: 'revision', limit: 30 })
  await feed.getByRole('tab', { name: '全部', exact: true }).click()
  await expect(feed.locator('.activity__item')).toHaveCount(30)
}

async function verifyActivityLoading(page, screenshot) {
  const feed = page.getByRole('complementary', { name: '项目动态', exact: true })
  const items = feed.locator('.activity__item'), mask = feed.locator('.activity__loading')
  const viewport = feed.locator('.activity__scroll .bing-scrollbar__viewport').first()
  const tab = name => feed.getByRole('tab', { name, exact: true })
  const kinds = () => items.evaluateAll(elements => [...new Set(elements.map(element => element.dataset.activityKind))])
  const geometry = () => feed.evaluate(element => {
    const { y, height } = element.getBoundingClientRect()
    return { y, height }
  })
  const initial = await geometry()
  await viewport.evaluate(element => { element.scrollTop = 120 })
  const scrollBefore = await viewport.evaluate(element => element.scrollTop)
  const original = await items.allTextContents()
  await items.first().evaluate(element => { window.activityFirstItem = element })
  await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 1600 })
  await tab('状态').click()
  await expect(mask).toBeVisible()
  await expect(feed.locator('.activity__scroll')).toHaveAttribute('aria-busy', 'true')
  expect(await items.allTextContents()).toEqual(original)
  expect(await items.first().evaluate(element => element === window.activityFirstItem)).toBe(true)
  expect(await viewport.evaluate(element => element.scrollTop)).toBe(scrollBefore)
  expect(await geometry()).toEqual(initial)
  const covering = await mask.evaluate(element => {
    const box = element.getBoundingClientRect(), viewport = element.previousElementSibling.getBoundingClientRect()
    const tabs = element.closest('.activity').querySelector('.activity__filters').getBoundingClientRect()
    return { alpha: getComputedStyle(element).backgroundColor, covers: box.left <= viewport.left && box.right >= viewport.right && box.top <= viewport.top && box.bottom >= viewport.bottom, belowTabs: box.top >= tabs.bottom }
  })
  expect(covering.covers).toBe(true)
  expect(covering.belowTabs).toBe(true)
  expect(covering.alpha).toMatch(/\/ 0\.72\)|, 0\.72\)/)
  await screenshot('workbench-activity-loading')
  // 后发请求先返回，旧响应随后到达也不能覆盖当前标签。
  await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 80 })
  await tab('新建').click()
  await expect(mask).toHaveCount(0)
  expect(await kinds()).toEqual(['create'])
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(0)
  await page.waitForTimeout(1700)
  expect(await kinds()).toEqual(['create'])
  expect(await geometry()).toEqual(initial)
  // 失败保留旧标签的数据，重试读取已选的新标签。
  await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 400; window.workspaceFixture.workbenchControl.fail.add('activity') })
  await tab('版本').click()
  await expect(mask).toBeVisible()
  expect(await kinds()).toEqual(['create'])
  await expect(feed.getByRole('alert')).toHaveText('动态刷新失败，已保留上次内容。')
  await expect(mask).toHaveCount(0)
  expect(await kinds()).toEqual(['create'])
  await feed.getByRole('button', { name: '重试', exact: true }).click()
  await expect(mask).toBeVisible()
  await expect(mask).toHaveCount(0)
  expect(await kinds()).toEqual(['revision'])
  // 同筛选刷新保留阅读位置；分页只在底部提示，旧条目不清空或重建。
  await viewport.evaluate(element => { element.scrollTop = 40 })
  const refreshScroll = await viewport.evaluate(element => element.scrollTop)
  await fixture(page, async () => {
    const { useState } = await import('/tests/browser/workspace-runtime.mjs')
    useState('requirement-cache').value.generation++
  })
  await expect(mask).toBeVisible()
  await expect(mask).toHaveCount(0)
  expect(await viewport.evaluate(element => element.scrollTop)).toBe(refreshScroll)
  await tab('全部').click()
  await expect(mask).toHaveCount(0)
  await expect(items).toHaveCount(30)
  await items.first().evaluate(element => { window.activityFirstItem = element })
  const more = feed.locator('.activity__more-loading')
  const requestsBefore = await fixture(page, () => window.workspaceFixture.workbenchRequests.filter(item => item.name === 'activity').length)
  await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 1600 })
  // 预加载区外不发请求，进入提前一屏的范围就开始读取，不必等到底部 80px。
  const preloadDistance = await viewport.evaluate(element => Math.max(240, element.clientHeight))
  expect(await viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(preloadDistance + 80)
  await viewport.evaluate((element, distance) => { element.scrollTop = element.scrollHeight - element.clientHeight - distance - 80 }, preloadDistance)
  await page.waitForTimeout(80)
  expect(await fixture(page, () => window.workspaceFixture.workbenchRequests.filter(item => item.name === 'activity').length)).toBe(requestsBefore)
  await viewport.evaluate((element, distance) => { element.scrollTop = element.scrollHeight - element.clientHeight - distance + 16 }, preloadDistance)
  await expect(feed.locator('.activity__scroll')).toHaveAttribute('aria-busy', 'true')
  expect(await viewport.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(80)
  expect(await fixture(page, () => window.workspaceFixture.workbenchRequests.filter(item => item.name === 'activity').length)).toBe(requestsBefore + 1)
  await viewport.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(more).toBeVisible()
  await expect(more).toHaveText('正在加载更早的动态…')
  await expect(mask).toHaveCount(0)
  await expect(items).toHaveCount(30)
  await expect(feed.locator('.activity__scroll')).not.toHaveAttribute('inert', '')
  await expect(feed.getByRole('link')).toHaveCount(30)
  const scrollAtBottom = await viewport.evaluate(element => element.scrollTop)
  const lastLink = await items.last().getAttribute('href')
  await items.last().click()
  expect(await page.evaluate(() => window.openedLinks.at(-1))).toBe(lastLink)
  await screenshot('workbench-activity-loading-more')
  await viewport.hover()
  await page.mouse.wheel(0, -120)
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeLessThan(scrollAtBottom)
  await viewport.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(feed.locator('.activity__scroll')).toHaveAttribute('aria-busy', 'true')
  expect(await fixture(page, () => window.workspaceFixture.workbenchRequests.filter(item => item.name === 'activity').length)).toBe(requestsBefore + 1)
  await expect(items).toHaveCount(45)
  await expect(more).toHaveCount(0)
  await expect(mask).toHaveCount(0)
  expect(await items.first().evaluate(element => element === window.activityFirstItem)).toBe(true)
  expect(await geometry()).toEqual(initial)
  await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 0 })
  // 分页提示已出现时快速切换标签，不沿用分页的计时，也不能把旧页追加到新标签。
  await tab('版本').click()
  await expect(items).toHaveCount(9)
  await tab('全部').click()
  await expect(items).toHaveCount(30)
  await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 500 })
  await viewport.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(more).toBeVisible()
  await feed.evaluate(element => {
    window.activityPaginationMasks = 0
    window.activityPaginationObserver = new MutationObserver(records => {
      for (const record of records) if ([...record.addedNodes].some(node => node instanceof Element && node.matches('.activity__loading'))) window.activityPaginationMasks++
    })
    window.activityPaginationObserver.observe(element.querySelector('.activity__content'), { childList: true })
  })
  await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 30 })
  await tab('新建').click()
  await expect.poll(kinds).toEqual(['create'])
  await expect(more).toHaveCount(0)
  await page.waitForTimeout(550)
  expect(await kinds()).toEqual(['create'])
  expect(await page.evaluate(() => window.activityPaginationMasks)).toBe(0)
  await page.evaluate(() => window.activityPaginationObserver.disconnect())
  await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 0 })
}

async function verifyActivityTiming(page) {
  const feed = page.getByRole('complementary', { name: '项目动态', exact: true })
  const mask = feed.locator('.activity__loading')
  const tab = name => feed.getByRole('tab', { name, exact: true })
  const kinds = () => feed.locator('.activity__item').evaluateAll(elements => [...new Set(elements.map(element => element.dataset.activityKind))])
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await feed.evaluate(element => {
    window.activityTiming = { startedAt: 0, events: [], frames: [] }
    window.activityTimingObserver = new MutationObserver(records => {
      for (const record of records) {
        for (const [action, nodes] of [['show', record.addedNodes], ['hide', record.removedNodes]]) {
          if ([...nodes].some(node => node instanceof Element && node.matches('.activity__loading'))) {
            window.activityTiming.events.push({ action, at: performance.now() - window.activityTiming.startedAt })
          }
        }
      }
    })
    window.activityTimingObserver.observe(element.querySelector('.activity__content'), { childList: true })
    const sample = () => {
      const mask = element.querySelector('.activity__loading')
      if (mask) {
        const style = getComputedStyle(mask)
        window.activityTiming.frames.push({ opacity: Number(style.opacity), duration: style.transitionDuration, pointerEvents: style.pointerEvents,
          busy: element.querySelector('.activity__scroll').getAttribute('aria-busy') === 'true', kind: element.querySelector('.activity__item')?.dataset.activityKind })
      }
      window.activityTimingFrame = requestAnimationFrame(sample)
    }
    window.activityTimingFrame = requestAnimationFrame(sample)
  })
  const select = async (name, delay) => {
    await fixture(page, delay => { window.workspaceFixture.workbenchControl.readDelay = delay }, delay)
    await tab(name).evaluate(element => {
      window.activityTiming.events = []; window.activityTiming.frames = []
      element.addEventListener('click', () => { window.activityTiming.startedAt = performance.now() }, { once: true, capture: true })
    })
    await tab(name).click()
  }
  try {
    // 逐帧之外也记录 DOM 插入，避免漏掉只存在一个任务的遮罩闪烁。
    for (const [name, kind, delay] of [['状态', 'status', 0], ['新建', 'create', 50], ['版本', 'revision', 120]]) {
      await select(name, delay)
      await expect.poll(kinds).toEqual([kind])
      await page.waitForTimeout(180)
      expect(await page.evaluate(() => window.activityTiming.events)).toEqual([])
      await expect(mask).toHaveCount(0)
    }
    await select('状态', 500)
    await expect(mask).toBeVisible()
    await expect.poll(kinds).toEqual(['status'])
    await expect(mask).toHaveCount(0)
    const timing = await page.evaluate(() => window.activityTiming)
    expect(timing.events.map(event => event.action)).toEqual(['show', 'hide'])
    expect(timing.events[0].at).toBeGreaterThanOrEqual(140)
    expect(timing.frames.some(frame => frame.busy && frame.opacity > 0 && frame.opacity < 1 && frame.duration === '0.1s')).toBe(true)
    // 数据已返回且条目可操作时，遮罩仍在淡出：数据没有等待动画结束。
    expect(timing.frames.some(frame => !frame.busy && frame.kind === 'status' && frame.opacity > 0 && frame.opacity < 1 && frame.pointerEvents === 'none')).toBe(true)
    // 遮罩尚未出现就改选，后一请求快速完成，前一轮延迟不能随后补出遮罩。
    await select('新建', 500)
    await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 30 })
    await tab('版本').click()
    await expect.poll(kinds).toEqual(['revision'])
    await page.waitForTimeout(550)
    expect(await page.evaluate(() => window.activityTiming.events)).toEqual([])
    expect(await kinds()).toEqual(['revision'])
  } finally {
    await page.evaluate(() => { window.activityTimingObserver.disconnect(); cancelAnimationFrame(window.activityTimingFrame) })
    await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 0 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
  }
}

async function verifyTeam(page, screenshot) {
  const load = page.getByRole('region', { name: '负载', exact: true })
  await load.scrollIntoViewIfNeeded()
  await expect(load.getByRole('link', { name: '管理', exact: true })).toHaveAttribute('href', '/members')
  const cell = (row, code) => load.locator(`[data-load-row="${row}"] [data-load-cell="${code}"]`)
  // 与工作流同一份状态：此前把 TODO-3 改为进行中、REQ-21 完成、BUG-9 被关闭。
  await expect(cell('fixture-user', 'queued')).toHaveText('5')
  await expect(cell('fixture-user', 'doing')).toHaveText('2')
  await expect(cell('fixture-user', 'testing')).toHaveText('')
  await expect(cell('unassigned', 'queued')).toHaveText('1')
  await expect(cell('member-b', 'doing')).toHaveAttribute('href', '/requirements?assignee=member-b&statusId=doing')
  await expect(cell('unassigned', 'queued')).toHaveAttribute('href', '/requirements?assignee=unassigned&statusId=open')
  await expect(load.locator('[data-load-row]').last()).toHaveAttribute('data-load-row', 'unassigned')
  await verifyLoadIndicator(page, load, screenshot)
  await expect(load).not.toContainText('合计可能大于文档总数')

  const rhythm = page.getByRole('region', { name: '完成节奏', exact: true })
  const cells = rhythm.locator('.rhythm__calendar .rhythm__cell')
  // 12 周 84 天到今天（周日）为止；记录开始之前标为无记录。
  expect(await cells.count()).toBe(84)
  expect(await rhythm.locator('.rhythm__calendar [data-state="unknown"]').count()).toBe(20)
  await expect(rhythm).not.toContainText('最后一次进入「已完成」')
  await verifyRhythmIntent(page)
  await verifyRhythmHover(page)
  await rhythm.locator('[data-date="2026-10-18"]').click()
  await expect(rhythm.locator('.rhythm__detail')).toContainText('10月18日 周日')
  await expect(rhythm.locator('.rhythm__detail a').first()).toHaveAttribute('href', '/requirements/done-0')
  await rhythm.getByRole('tab', { name: '我的', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.workspaceFixture.workbenchRequests.filter(item => item.name === 'completions').at(-1).query.scope)).toBe('mine')
  await expect(rhythm.locator('.rhythm__summary strong')).not.toHaveText('0')
  await screenshot('workbench-home-team')
}

async function verifyLoadIndicator(page, load, screenshot) {
  const cell = (row, col) => load.locator(`[data-load-row="${row}"] [data-load-cell="${col}"]`)
  const marker = load.locator('.load__indicator'), start = cell('fixture-user', 'queued'), target = cell('member-b', 'doing')
  const aligned = async target => {
    await expect.poll(() => target.evaluate(element => {
      const box = element.getBoundingClientRect(), ring = element.closest('.load').querySelector('.load__indicator').getBoundingClientRect()
      return Math.max(Math.abs(ring.x - box.x + 4), Math.abs(ring.y - box.y + 4), Math.abs(ring.width - box.width - 8), Math.abs(ring.height - box.height - 8))
    })).toBeLessThan(1)
  }
  for (const motion of ['reduce', 'no-preference']) {
    await page.emulateMedia({ reducedMotion: motion })
    await start.hover()
    await aligned(start)
    await marker.evaluate(element => { window.loadIndicator = element })
    const before = await marker.boundingBox(), panel = await load.boundingBox()
    await target.evaluate(element => {
      element.addEventListener('pointerenter', () => {
        const started = performance.now(), marker = element.closest('.load').querySelector('.load__indicator')
        window.loadIndicatorFrames = []
        window.loadIndicatorFinished = new Promise(resolve => {
          const sample = () => {
            const box = marker.getBoundingClientRect()
            window.loadIndicatorFrames.push({ x: box.x, y: box.y })
            if (performance.now() - started < 220) requestAnimationFrame(sample)
            else resolve()
          }
          requestAnimationFrame(sample)
        })
      }, { once: true })
    })
    const destination = await target.boundingBox()
    await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2)
    await page.evaluate(() => window.loadIndicatorFinished)
    await aligned(target)
    const frames = await page.evaluate(() => window.loadIndicatorFrames), after = await marker.boundingBox()
    if (motion === 'no-preference') expect(frames.some(frame => frame.x > before.x + 1 && frame.x < after.x - 1)).toBe(true)
    else expect(frames.every(frame => Math.abs(frame.x - after.x) < 1 && Math.abs(frame.y - after.y) < 1)).toBe(true)
    expect(await marker.evaluate(element => element === window.loadIndicator)).toBe(true)
    expect(await load.boundingBox()).toEqual(panel)
    await expect(marker).toHaveCSS('pointer-events', 'none')
    await expect(target).toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)')
    await expect(load.locator('[data-load-row="member-b"]')).toHaveClass(/is-hot/)
    await expect(load.locator('.load__col.is-hot')).toHaveText('进行中')

    // 经过列间和行间的空隙，指示框与行列强调都保留。
    const next = await cell('member-b', 'testing').boundingBox(), above = await cell('fixture-user', 'doing').boundingBox()
    for (const point of [[(destination.x + destination.width + next.x) / 2, destination.y + 8], [destination.x + 8, (above.y + above.height + destination.y) / 2]]) {
      await page.mouse.move(...point)
      await expect(marker).toHaveAttribute('data-row', 'member-b')
      await expect(marker).toHaveAttribute('data-col', 'doing')
      await expect(marker).toHaveCSS('opacity', '1')
      await expect(cell('unassigned', 'queued')).toHaveCSS('opacity', '0.45')
    }
    await screenshot(`workbench-load-indicator-${motion}`)
    const footer = cell('unassigned', 'testing')
    await footer.hover()
    await aligned(footer)
    await expect(marker).toHaveCSS('z-index', '3')
    await load.getByRole('link', { name: '管理', exact: true }).hover()
    await expect(marker).toHaveCSS('opacity', '0')
    await expect(start).toHaveCSS('opacity', '1')

    // 键盘焦点不等待移动动画；鼠标离开后仍保留键盘提示。
    await load.getByRole('link', { name: '管理', exact: true }).focus()
    await page.keyboard.press('Tab')
    await target.focus()
    await aligned(target)
    await page.mouse.move(0, 0)
    await expect(marker).toHaveAttribute('data-row', 'member-b')
    await expect(marker).toHaveCSS('opacity', '1')
    await target.click()
    expect(await page.evaluate(() => window.openedLinks.at(-1))).toBe('/requirements?assignee=member-b&statusId=doing')
    await load.getByRole('link', { name: '管理', exact: true }).focus()
    await load.getByRole('link', { name: '管理', exact: true }).hover()
    await expect(marker).toHaveCSS('opacity', '0')
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

async function verifyRhythmIntent(page) {
  const rhythm = page.getByRole('region', { name: '完成节奏', exact: true })
  const day = date => rhythm.locator(`[data-date="2026-10-${date}"]`)
  const detail = rhythm.locator('.rhythm__detail'), indicator = rhythm.locator('.rhythm__indicator')
  await rhythm.scrollIntoViewIfNeeded()
  for (const motion of ['reduce', 'no-preference']) {
    await page.emulateMedia({ reducedMotion: motion })
    await day('15').click()
    await day('05').hover()
    await expect(detail).toHaveAttribute('data-preview-date', '2026-10-05')
    await indicator.evaluate(element => { window.rhythmIndicator = element })
    await detail.evaluate(element => {
      window.rhythmDetailContent = element.querySelector('.rhythm__detail-content')
      window.rhythmIntentChanges = []
      window.rhythmIntentObserver = new MutationObserver(() => window.rhythmIntentChanges.push(element.dataset.previewDate))
      window.rhythmIntentObserver.observe(element, { attributes: true, attributeFilter: ['data-preview-date'] })
    })
    const points = await Promise.all(['06', '13', '14', '15'].map(date => day(date).boundingBox()))
    for (const box of points.slice(0, 3)) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.move(points[2].x + points[2].width / 2, (points[2].y + points[2].height + points[3].y) / 2)
    await page.waitForTimeout(200)
    await expect(detail).toHaveAttribute('data-preview-date', '2026-10-05')
    expect(await page.evaluate(() => window.rhythmIntentChanges)).toEqual([])

    // 记录实际指针进入后的每一帧：框先移动，停留足够久后才更新详情。
    await day('13').evaluate(element => {
      element.addEventListener('pointerenter', () => {
        window.rhythmIntentFrames = []
        const started = performance.now(), root = element.closest('.rhythm')
        window.rhythmIntentFinished = new Promise(resolve => {
          const sample = () => {
            const cursor = root.querySelector('.rhythm__indicator'), box = cursor.getBoundingClientRect()
            const panel = root.querySelector('.rhythm__detail'), panelBox = panel.getBoundingClientRect()
            const content = panel.querySelector('.rhythm__detail-content')
            const elapsed = performance.now() - started
            window.rhythmIntentFrames.push({ elapsed, y: box.y, date: panel.dataset.previewDate, target: cursor.dataset.targetDate,
              opacity: Number(getComputedStyle(content).opacity), offset: content.getBoundingClientRect().y - panelBox.y,
              panelY: panelBox.y, panelHeight: panelBox.height })
            if (elapsed < 360) requestAnimationFrame(sample)
            else resolve()
          }
          requestAnimationFrame(sample)
        })
      }, { once: true })
    })
    await page.mouse.move(points[1].x + points[1].width / 2, points[1].y + points[1].height / 2)
    await expect(detail).toHaveAttribute('data-preview-date', '2026-10-13')
    await page.evaluate(() => window.rhythmIntentFinished)
    const frames = await page.evaluate(() => window.rhythmIntentFrames)
    expect(frames.some(frame => frame.elapsed < 140 && frame.target === '2026-10-13' && frame.date === '2026-10-05')).toBe(true)
    expect(frames.find(frame => frame.date === '2026-10-13').elapsed).toBeGreaterThanOrEqual(145)
    // 确认详情后才淡入，整个过渡不留空白、不挤动背景，并复用内容节点。
    expect(frames.every(frame => frame.opacity >= 0.5)).toBe(true)
    expect(frames.every(frame => frame.panelY === frames[0].panelY && frame.panelHeight === frames[0].panelHeight)).toBe(true)
    if (motion === 'no-preference') {
      expect(frames.some(frame => frame.date === '2026-10-13' && frame.opacity > 0.5 && frame.opacity < 0.99 && frame.offset > 0)).toBe(true)
    } else expect(frames.every(frame => frame.opacity === 1 && frame.offset === 0)).toBe(true)
    const content = detail.locator('.rhythm__detail-content')
    expect(await content.evaluate(element => element === window.rhythmDetailContent)).toBe(true)
    await expect(content).toHaveCSS('opacity', '1')
    await expect(content).toHaveCSS('transform', 'none')
    const box = await indicator.boundingBox(), target = await day('13').boundingBox()
    expect(Math.abs(box.x - (target.x - 3))).toBeLessThan(1)
    expect(Math.abs(box.y - (target.y - 3))).toBeLessThan(1)
    expect(box.width).toBe(target.width + 6)
    expect(box.height).toBe(target.height + 6)
    if (motion === 'no-preference') expect(frames.some(frame => frame.y > box.y + 1 && frame.y < points[2].y - 4)).toBe(true)
    await expect(indicator).toHaveCSS('pointer-events', 'none')
    expect(await indicator.evaluate(element => element === window.rhythmIndicator)).toBe(true)
    await expect(day('13')).toHaveCSS('outline-style', 'none')
    expect(await page.evaluate(() => window.rhythmIntentChanges)).toEqual(['2026-10-13'])
    await page.evaluate(() => window.rhythmIntentObserver.disconnect())

    await page.mouse.move(points[2].x + points[2].width / 2, points[2].y + points[2].height / 2)
    await detail.hover()
    await page.waitForTimeout(200)
    await expect(detail).toHaveAttribute('data-preview-date', '2026-10-13')
    await expect(indicator).toHaveAttribute('data-target-date', '2026-10-13')
    // 点击、键盘聚焦和 Escape 即时生效，不能被之前的悬停计时覆盖。
    await day('07').click()
    expect(await detail.getAttribute('data-preview-date')).toBe('2026-10-07')
    await day('16').focus()
    expect(await detail.getAttribute('data-preview-date')).toBe('2026-10-16')
    await page.keyboard.press('Tab')
    expect(await detail.getAttribute('data-preview-date')).toBe('2026-10-17')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(180)
    await expect(detail).toHaveAttribute('data-preview-date', '2026-10-18')
    expect(await content.evaluate(element => element.getAnimations().length)).toBe(0)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

async function verifyRhythmHover(page) {
  const rhythm = page.getByRole('region', { name: '完成节奏', exact: true })
  await rhythm.scrollIntoViewIfNeeded()
  const day = date => rhythm.locator(`[data-date="2026-10-${date}"]`)
  const detail = rhythm.locator('.rhythm__detail h3')
  await day('15').click()
  await day('05').hover()
  await expect(detail).toHaveText('10月5日 周一')
  // 同时观察过渡中的面板内容，防止只检查最终结果漏掉回退到固定日期的短暂闪动。
  await detail.evaluate(element => {
    window.rhythmDetailChanges = []
    window.rhythmDetailObserver = new MutationObserver(() => window.rhythmDetailChanges.push(element.textContent))
    window.rhythmDetailObserver.observe(element, { childList: true, characterData: true, subtree: true })
  })
  const monday = await day('05').boundingBox(), tuesday = await day('06').boundingBox()
  const nextWeek = await day('13').boundingBox()
  // 行间、列间及四格交点都属于日历；停在缝隙里也不能结束预览。
  await page.mouse.move(monday.x + monday.width / 2, (monday.y + monday.height + tuesday.y) / 2)
  await expect(detail).toHaveText('10月5日 周一')
  await day('06').hover()
  await expect(detail).toHaveText('10月6日 周二')
  const gapX = (tuesday.x + tuesday.width + nextWeek.x) / 2
  const gapY = (monday.y + monday.height + tuesday.y) / 2
  await page.mouse.move(gapX, tuesday.y + tuesday.height / 2)
  await expect(detail).toHaveText('10月6日 周二')
  await page.mouse.move(gapX, gapY)
  await expect(detail).toHaveText('10月6日 周二')
  await day('13').hover()
  await expect(detail).toHaveText('10月13日 周二')
  const changes = await page.evaluate(() => {
    window.rhythmDetailObserver.disconnect()
    delete window.rhythmDetailObserver
    return window.rhythmDetailChanges
  })
  expect(changes).toEqual(['10月6日 周二', '10月13日 周二'])
  await rhythm.locator('.rhythm__summary').hover()
  await expect(detail).toHaveText('10月15日 周四')
  // 取消固定后离开整个日历回到最近完成日；键盘聚焦和失焦仍正常切换。
  await day('15').click()
  await rhythm.locator('.rhythm__summary').hover()
  await expect(detail).toContainText('10月18日 周日')
  await day('16').focus()
  await expect(detail).toHaveText('10月16日 周五')
  await page.keyboard.press('Tab')
  await expect(detail).toHaveText('10月17日 周六')
  await rhythm.getByRole('tab', { name: '团队', exact: true }).focus()
  await expect(detail).toContainText('10月18日 周日')
}

async function verifyBlockRetry(page, url) {
  // 区块各自加载：负载失败不影响工作流和完成节奏，重试只读取自己。
  await open(page, `${url}`, '&workbenchFail=team-load,activity')
  const load = page.getByRole('region', { name: '负载', exact: true })
  await expect(load.getByRole('alert')).toContainText('团队负载暂时无法加载。')
  await expect(page.locator('[data-flow-card]').first()).toBeVisible()
  await expect(page.getByRole('region', { name: '完成节奏', exact: true }).locator('.rhythm__cell').first()).toBeVisible()
  const feed = page.getByRole('complementary', { name: '项目动态', exact: true })
  await expect(feed.getByRole('alert')).toHaveText('动态暂时无法加载。')
  await feed.getByRole('button', { name: '重试', exact: true }).click()
  await expect(feed.locator('.activity__item')).toHaveCount(30)
  await load.getByRole('button', { name: '重试', exact: true }).click()
  await expect(load.locator('[data-load-row]')).toHaveCount(4)
  await expect(load.getByRole('alert')).toHaveCount(0)
}

async function verifyNarrow(page, url, screenshot) {
  // 1100px 以下动态移到下方，每列前 5 条加「查看全部」。
  await page.setViewportSize({ width: 1024, height: 900 })
  await open(page, url)
  const main = await page.locator('.desk-island--flow').boundingBox(), rail = await page.locator('.desk-island--activity').boundingBox()
  expect(rail.y).toBeGreaterThanOrEqual(main.y + main.height - 1)
  await expect(column(page, 'queued').locator('[data-flow-card]:visible')).toHaveCount(5)
  await expect(column(page, 'queued').getByRole('link', { name: '查看全部 6 条', exact: true })).toHaveAttribute('href', '/requirements?assignee=me&statusId=open')
  await noHorizontalOverflow(page)

  // 760px 以下改为可切换的单列；拖动时其余两列和「已完成」出现在底部，触摸长按也能拖。
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 780 })
    await open(page, url)
    const tabs = page.getByRole('tablist', { name: '切换工作流列', exact: true })
    await expect(tabs).toBeVisible()
    await expect(page.locator('[data-flow-column]:visible')).toHaveCount(1)
    await expect(column(page, 'doing')).toBeVisible()
    await noHorizontalOverflow(page)
    for (const name of ['团队负载表格', '完成节奏日历']) {
      const viewport = page.getByRole('region', { name, exact: true })
      await viewport.scrollIntoViewIfNeeded()
      expect(await viewport.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none')
      if (width === 320) {
        await expect(viewport).toHaveAttribute('tabindex', '0')
        await viewport.focus()
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      }
    }
    await screenshot(`workbench-home-bottom-${width}`)
  }
  await page.getByRole('tablist', { name: '切换工作流列', exact: true }).getByRole('tab', { name: /^待处理/ }).click()
  await expect(column(page, 'queued')).toBeVisible()
  await screenshot('workbench-home-390')
  await touchDrag(page, card(page, 'BUG-7'), () => dock(page, 'doing'), async () => {
    await expect(dock(page, 'testing')).toBeVisible()
    await expect(dock(page, 'done')).toBeVisible()
    await expect(dock(page, 'doing')).toHaveClass(/is-over/)
    expect((await dock(page, 'doing').boundingBox()).height).toBe(132)
    await verifyDragFocus(page, true)
    await noHorizontalOverflow(page)
    await screenshot('workbench-home-touch')
  })
  await expect(toast(page, '已将 BUG-7 改为进行中')).toBeVisible()
  expect(await patches(page)).toEqual([{ id: 'flow-2', statusId: 'doing', expectedStatusId: 'open' }])
  expect(await page.evaluate(() => window.openedLinks)).toEqual([])
  // 投放区卸载后，原来被 CSS 隐藏的列仍可接收后续拖动；切宽屏不重载页面。
  await expect(page.locator('[data-flow-dock]')).toHaveCount(0)
  await verifyDragFocus(page, false)
  await touchDrag(page, card(page, 'TODO-7'), () => dock(page, 'done'), async () => {
    const box = await dock(page, 'done').boundingBox()
    const label = await dock(page, 'done').locator('.flow-dock__label').boundingBox()
    const overlay = await page.locator('.bing-drag-overlay .flow-card').boundingBox()
    expect(box.height).toBe(132)
    expect(box.x).toBeGreaterThanOrEqual(16)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width - 16)
    expect(label.y + label.height).toBeLessThan(overlay.y)
    await expect(dock(page, 'done')).toHaveClass(/is-over/)
    await verifyDragFocus(page, true)
    await noHorizontalOverflow(page)
    await screenshot('workbench-drag-done-mobile')
  })
  await expect(toast(page, '已将 TODO-7 改为已完成')).toBeVisible()
  await expect(card(page, 'TODO-7')).toHaveCount(0)
  await expect(page.locator('[data-flow-dock]')).toHaveCount(0)
  await verifyDragFocus(page, false)
  await page.setViewportSize({ width: 1440, height: 960 })
  await mouseDrag(page, card(column(page, 'doing'), 'BUG-7'), column(page, 'testing'), { check: async () => {
    await expect(column(page, 'testing')).toHaveClass(/is-over/)
  } })
  await expect(card(column(page, 'testing'), 'BUG-7')).toBeVisible()
  expect((await patches(page)).at(-1)).toEqual({ id: 'flow-2', statusId: 'testing', expectedStatusId: 'doing' })
  const load = page.getByRole('region', { name: '负载', exact: true })
  await load.scrollIntoViewIfNeeded()
  await noHorizontalOverflow(page)

  // 暗色主题。
  await page.setViewportSize({ width: 1440, height: 960 })
  await open(page, url)
  await page.evaluate(() => { document.documentElement.dataset.bingTheme = 'dark' })
  await expect.poll(() => page.locator('.flow-card').first().evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(255, 255, 255)')
  await screenshot('workbench-home-dark')
  await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 1200 })
  const feed = page.getByRole('complementary', { name: '项目动态', exact: true })
  await feed.getByRole('tab', { name: '状态', exact: true }).click()
  await expect(feed.locator('.activity__loading')).toBeVisible()
  await expect(feed.locator('.activity__item')).toHaveCount(30)
  await screenshot('workbench-activity-loading-dark')
  await expect(feed.locator('.activity__loading')).toHaveCount(0)
  await expect(feed.locator('.activity__item')).toHaveCount(9)
  await fixture(page, () => { window.workspaceFixture.workbenchControl.readDelay = 0 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await verifyRhythmHover(page)
  await screenshot('workbench-home-rhythm-dark')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => { document.documentElement.dataset.bingTheme = 'light' })
  console.log('首页工作台无头验证通过：数字与链接、排序、BingScrollbar 列内及窄屏横向滚动、拖拽/停靠/撤销/Esc、409/423、菜单键盘操作、动态分页与筛选、负载、完成日历间隙连续预览/固定/键盘、区块重试、触屏长按及 1440/1024/390/320 亮暗主题。')
}
