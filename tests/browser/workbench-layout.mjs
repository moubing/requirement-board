import { expect } from '@playwright/test'

const region = (page, name) => page.getByRole('region', { name, exact: true })
const height = async locator => (await locator.boundingBox()).height
async function refresh(page) {
  const before = await page.evaluate(() => window.workspaceFixture.workbenchRequests.length)
  await page.evaluate(async () => {
    const { useState } = await import('/tests/browser/workspace-runtime.mjs')
    useState('requirement-cache').value.generation++
  })
  await expect.poll(() => page.evaluate(() => window.workspaceFixture.workbenchRequests.length)).toBeGreaterThan(before)
  await expect(page.locator('.desk__board')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.rhythm')).toHaveAttribute('aria-busy', 'false')
}
async function top(page) { await region(page, '页面内容').evaluate(element => element.scrollTo(0, 0)) }

// REQ-51：用不同内容量验证布局约束，同时操作真实滚动和焦点，避免只检查 CSS 声明。
export async function verifyWorkbenchLayout(page, url, screenshot) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${url}?page=dashboard`)
  await expect(page.locator('.flow-board')).toBeVisible()
  await verifyPageFit(page)
  await verifyCardCountStability(page, screenshot)
  await page.evaluate(() => {
    window.openedLinks = []
    document.addEventListener('click', event => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (link) { event.preventDefault(); window.openedLinks.push(link.getAttribute('href')) }
    }, true)
  })
  await verifyMenuHitTarget(page, screenshot)
  for (const count of [0, 1, 2]) {
    await page.evaluate(count => {
      window.workspaceFixture.resetWorkbench()
      window.workspaceFixture.workbenchDocs().splice(count)
    }, count)
    await refresh(page)
    await top(page)
    await expect(page.locator('[data-flow-card]')).toHaveCount(count)
    const main = await page.locator('.desk-island--flow').boundingBox()
    const feed = await page.locator('.desk-island--activity').boundingBox()
    expect(main.height).toBeGreaterThanOrEqual(380)
    expect(main.height).toBeLessThan(450)
    expect(Math.abs(main.height - feed.height)).toBeLessThan(2)
    const columns = await page.locator('.flow-column').evaluateAll(items => items.map(item => item.getBoundingClientRect().height))
    expect(Math.max(...columns) - Math.min(...columns)).toBeLessThan(2)
    for (const empty of await page.locator('.flow-column__empty').all()) {
      expect(await height(empty)).toBeGreaterThan(160)
      await expect(empty).toBeVisible()
    }
    for (const name of ['负载', '完成节奏']) {
      const box = await region(page, name).boundingBox()
      expect(box.y + box.height).toBeLessThan(900)
    }
  }
  await screenshot('workbench-home-sparse')

  await page.evaluate(() => {
    window.workspaceFixture.resetWorkbench()
    const docs = window.workspaceFixture.workbenchDocs(), source = docs[2]
    const extra = Array.from({ length: 18 }, (_, n) => ({ id: `dense-member-${n}`, name: `成员 ${n} 的较长姓名`, avatarColor: '#669933' }))
    window.workspaceFixture.workbenchControl.members = extra
    docs.push(...Array.from({ length: 24 }, (_, n) => ({ ...source, id: `flow-${100 + n}`, key: `REQ-${100 + n}`, code: 'queued',
      title: n % 2 ? '多位负责人共同处理的较长文档标题，用于检查两行排版和提醒优先级' : '短标题', assignees: [...source.assignees, ...extra.slice(0, 3)] })))
    // 验证卡同时出现多人和高优先级；只有当前成员的卡片仍隐藏重复头像。
    docs[4].assignees = [...docs[4].assignees, ...extra.slice(0, 3)]
    window.workspaceFixture.workbenchControl.completions = Array.from({ length: 24 }, (_, n) => ({
      id: `dense-done-${n}`, key: `DONE-${100 + n}`, title: '当天完成的较长文档标题，检查省略与内部滚动', documentType: 'requirement',
      date: '2026-10-18', completedAt: '2026-10-18T05:00:00.000Z', mine: n % 2 === 0,
    }))
  })
  await refresh(page)
  await expect(page.locator('[data-flow-card="REQ-21"] .flow-card__people')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '打开 REQ-21 首页工作流拖拽', exact: true })).toHaveAccessibleDescription('负责人：测试成员')
  // 中等桌面宽度也是三列，卡片必须依据自己的宽度折行，不能挤掉菜单或提醒。
  for (const width of [1101, 1280, 1440, 1920, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await top(page)
    await screenshot(`workbench-home-cards-${width}`)
    await expect.poll(() => page.locator('.flow-card__top').evaluateAll(items => items.filter(item => item.getBoundingClientRect().width && item.scrollWidth > item.clientWidth + 1).map(item => item.textContent))).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const loadHeight = await height(region(page, '负载'))
    const rhythm = region(page, '完成节奏'), calendar = await rhythm.locator('.rhythm__scroll').boundingBox(), detail = await rhythm.locator('.rhythm__detail').boundingBox()
    if (detail.x > calendar.x + calendar.width) expect(Math.abs(await height(rhythm) - loadHeight)).toBeLessThan(2)
    else {
      expect(detail.y).toBeGreaterThan(calendar.y + calendar.height)
      expect(await height(rhythm)).toBeGreaterThan(loadHeight)
    }
    if ([1101, 1440, 320].includes(width)) {
      await region(page, '完成节奏').scrollIntoViewIfNeeded()
      await screenshot(`workbench-home-dense-${width}`)
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await top(page)
  const card = page.locator('[data-flow-card="REQ-21"]'), menu = card.locator('.flow-card__menu')
  await page.locator('#desk-flow-title').hover()
  await expect(menu).toHaveCSS('opacity', '1')
  await card.hover()
  await expect(menu).toHaveCSS('opacity', '1')
  await page.locator('#desk-flow-title').hover()
  await card.getByRole('link').focus()
  await expect(menu).toHaveCSS('opacity', '1')
  await card.getByRole('button').press('Enter')
  await page.locator('#desk-flow-title').hover()
  await expect(menu).toHaveCSS('opacity', '1')
  await page.keyboard.press('Escape')
  await verifyStickyLoad(page)
  await verifyDetailReading(page, screenshot)

  // 触控环境常显菜单，按钮保留 44px 命中区；不依赖桌面 hover。
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })
  try {
    const touch = await context.newPage(), errors = []
    touch.on('pageerror', error => errors.push(error.message))
    await touch.goto(`${url}?page=dashboard`)
    const menu = touch.getByRole('button', { name: 'REQ-21 更多操作', exact: true })
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44); expect(Math.round(box.height)).toBeGreaterThanOrEqual(44)
    expect(await menu.locator('..').evaluate(element => getComputedStyle(element.closest('.flow-card__menu')).opacity)).toBe('1')
    await menu.tap()
    await expect(touch.getByRole('menuitem', { name: '改为测试中', exact: true })).toBeVisible()
    await touch.keyboard.press('Escape')
    const calendar = touch.getByRole('region', { name: '完成节奏日历', exact: true })
    const date = touch.locator('.rhythm__cell[data-date="2026-10-15"]')
    await calendar.scrollIntoViewIfNeeded()
    await date.tap()
    expect(await touch.locator('.rhythm__detail').getAttribute('data-preview-date')).toBe('2026-10-15')
    await touch.waitForTimeout(200)
    await expect(date).toHaveAttribute('aria-pressed', 'true')
    // 触控格子更大，横向滚动后指示框仍随内容准确对齐。
    await calendar.evaluate(element => element.scrollTo({ left: 0, behavior: 'instant' }))
    const alignment = await date.evaluate(element => {
      const cell = element.getBoundingClientRect(), marker = element.closest('.rhythm').querySelector('.rhythm__indicator').getBoundingClientRect()
      return { x: marker.x - cell.x, y: marker.y - cell.y, width: marker.width, cell: cell.width }
    })
    expect(alignment).toEqual({ x: -3, y: -3, width: 30, cell: 24 })
    expect(errors).toEqual([])
  } finally { await context.close() }
  console.log('REQ-51 无头验证通过：稀疏与密集布局、卡片宽度适配、常驻菜单与真实坐标定位、固定负载表头/未指派行、连续详情预览、滚动复位/保留、加载失败稳定性及触控菜单。')
}

async function verifyPageFit(page) {
  const viewport = region(page, '页面内容'), flow = page.locator('.desk-island--flow')
  await expect(page.locator('.rhythm')).toBeVisible()
  // 两种下排排布都不能留下 2–4px 的外层滚动；普通动效下反复滚轮也不能移动整排面板。
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  for (const [width, height] of [[2048, 1016], [1440, 960], [1280, 1210]]) {
    await page.setViewportSize({ width, height })
    await top(page)
    await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBe(0)
    const before = await flow.boundingBox()
    await page.locator('#desk-flow-title').hover()
    for (const delta of [180, -180, 180, -180]) await page.mouse.wheel(0, delta)
    expect(await viewport.evaluate(element => element.scrollTop)).toBe(0)
    expect(await flow.boundingBox()).toEqual(before)
    // 列内列表仍然可以滚动，不能靠禁用滚轮掩盖外层溢出。
    const queued = region(page, '待处理的文档滚动区')
    await queued.hover()
    await page.mouse.wheel(0, 140)
    await expect.poll(() => queued.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    expect(await viewport.evaluate(element => element.scrollTop)).toBe(0)
    await queued.evaluate(element => element.scrollTo(0, 0))
  }
  // 空间确实不足时恢复正常页面滚动，第二排的固定内容高度不能被压缩或裁掉。
  for (const width of [2048, 1280, 390]) {
    await page.setViewportSize({ width, height: 800 })
    await top(page)
    await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(20)
    for (const name of ['负载', '完成节奏']) {
      const panel = region(page, name)
      await panel.scrollIntoViewIfNeeded()
      const box = await panel.boundingBox()
      expect(box.y).toBeGreaterThanOrEqual(64)
      expect(box.y + box.height).toBeLessThanOrEqual(801)
      expect(box.height).toBeGreaterThanOrEqual(366)
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await top(page)
}

async function verifyMenuHitTarget(page, screenshot) {
  const card = page.locator('[data-flow-card="REQ-21"]'), button = card.getByRole('button', { name: 'REQ-21 更多操作', exact: true })
  // 普通动效中的 translate 会建立层叠上下文；用真实坐标点击，确认点击落在按钮而非整卡链接。
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion })
    await page.locator('#desk-flow-title').hover()
    await expect(card.locator('.flow-card__menu')).toHaveCSS('opacity', '1')
    const box = await button.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    expect(await page.evaluate(() => window.openedLinks)).toEqual([])
    const menu = page.getByRole('menu', { name: 'REQ-21 操作', exact: true })
    await expect(menu).toBeVisible()
    await expect.poll(async () => {
      const trigger = await button.boundingBox(), panel = await menu.boundingBox()
      return Math.abs(panel.x + panel.width - trigger.x - trigger.width)
    }, { message: '卡片菜单应与三个点按钮右对齐' }).toBeLessThan(2)
    await expect.poll(async () => {
      const trigger = await button.boundingBox(), panel = await menu.boundingBox()
      return Math.abs(panel.y - trigger.y - trigger.height - 8)
    }, { message: '卡片菜单应展开在三个点按钮下方' }).toBeLessThan(2)
    if (reducedMotion === 'reduce') await screenshot('workbench-menu-position')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: 'REQ-21 操作', exact: true })).toHaveCount(0)
  }
  const title = await card.locator('.flow-card__title').boundingBox()
  await page.mouse.click(title.x + title.width / 2, title.y + title.height / 2)
  expect(await page.evaluate(() => window.openedLinks)).toEqual(['/requirements/flow-1'])
  await page.evaluate(() => { window.openedLinks = [] })
}

async function verifyCardCountStability(page, screenshot) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const geometry = () => page.locator('.desk-island').evaluateAll(items => items.map(item => {
    const { y, height } = item.getBoundingClientRect()
    return { y, height }
  }))
  // 横排与上下排列的完成节奏都要稳定，状态菜单实际往返 5 → 6 → 5 张。
  for (const [width, height] of [[2048, 1016], [1440, 960], [1280, 1210]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => {
      window.workspaceFixture.resetWorkbench()
      const docs = window.workspaceFixture.workbenchDocs(), source = docs[0]
      docs.splice(0, docs.length, ...Array.from({ length: 6 }, (_, index) => ({ ...source,
        id: `flow-${501 + index}`, key: `REQ-${501 + index}`, title: `工作事项 ${index + 1}`,
        code: index < 5 ? 'doing' : 'queued', lastActivityAt: '2026-10-18T07:30:00.000Z',
      })))
      window.workspaceFixture.workbenchControl.delay = 160
    })
    await refresh(page)
    await top(page)
    const before = await geometry(), card = page.locator('[data-flow-card="REQ-506"]')
    if (width === 2048) await screenshot('workbench-five-cards')
    await card.getByRole('button').click()
    await page.getByRole('menuitem', { name: '改为进行中', exact: true }).click()
    await expect(page.locator('[data-flow-column="doing"] [data-flow-card]')).toHaveCount(6)
    await expect.poll(geometry, { message: '第 6 张卡片只能增加列内滚动，不能改变四块面板的布局' }).toEqual(before)
    await expect(card).not.toHaveClass(/is-pending/)
    if (width === 2048) await screenshot('workbench-six-cards')
    const viewport = region(page, '进行中的文档滚动区')
    await viewport.hover()
    await page.mouse.wheel(0, 180)
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect.poll(geometry).toEqual(before)
    await card.getByRole('button').click()
    await page.getByRole('menuitem', { name: '改为待处理', exact: true }).click()
    await expect(page.locator('[data-flow-column="doing"] [data-flow-card]')).toHaveCount(5)
    await expect(card).not.toHaveClass(/is-pending/)
    await expect.poll(geometry).toEqual(before)
    // 长标题及更多卡片同样只改变滚动内容；清空列也不让四块面板上下跳动。
    await page.evaluate(() => {
      const docs = window.workspaceFixture.workbenchDocs(), source = docs[0]
      docs.push(...Array.from({ length: 14 }, (_, index) => ({ ...source, id: `flow-${600 + index}`, key: `REQ-${600 + index}`,
        title: '用于检查两行标题和内部滚动的较长工作事项，卡片内容不能改变外层布局' })))
    })
    await refresh(page)
    await expect.poll(geometry).toEqual(before)
    await page.evaluate(() => window.workspaceFixture.workbenchDocs().splice(0))
    await refresh(page)
    await expect(page.locator('[data-flow-card]')).toHaveCount(0)
    await expect.poll(geometry).toEqual(before)
  }
  await page.evaluate(() => window.workspaceFixture.resetWorkbench())
  await refresh(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await top(page)
}

async function verifyStickyLoad(page) {
  const load = region(page, '负载'), viewport = region(page, '团队负载表格')
  await load.scrollIntoViewIfNeeded()
  const head = load.locator('.load__row--head'), footer = load.locator('[data-load-row="unassigned"]')
  const aligned = async cell => {
    await expect.poll(() => cell.evaluate(element => {
      const box = element.getBoundingClientRect(), ring = element.closest('.load').querySelector('.load__indicator').getBoundingClientRect()
      return Math.max(Math.abs(ring.x - box.x + 4), Math.abs(ring.y - box.y + 4), Math.abs(ring.width - box.width - 8), Math.abs(ring.height - box.height - 8))
    })).toBeLessThan(1)
  }
  const footerCell = footer.locator('[data-load-cell="doing"]')
  await footerCell.hover()
  await aligned(footerCell)
  const startHead = await head.boundingBox(), startFooter = await footer.boundingBox()
  for (const top of [200, 10000]) {
    await viewport.evaluate((element, top) => element.scrollTo(0, top), top)
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    expect(Math.abs((await head.boundingBox()).y - startHead.y)).toBeLessThan(2)
    expect(Math.abs((await footer.boundingBox()).y - startFooter.y)).toBeLessThan(2)
    await aligned(footerCell)
  }
  // 浏览器自动滚动键盘焦点时，焦点格不能被表头或底部固定行盖住。
  await page.mouse.move(0, 0)
  await page.keyboard.press('Tab')
  const middle = load.locator('[data-load-row="dense-member-8"] [data-load-cell="doing"]')
  await middle.focus()
  await aligned(middle)
  const box = await middle.boundingBox(), header = await head.boundingBox(), bottom = await footer.boundingBox()
  expect(box.y - 4).toBeGreaterThanOrEqual(header.y + header.height)
  expect(box.y + box.height + 4).toBeLessThanOrEqual(bottom.y)
  for (let index = 0; index < 15; index++) {
    await page.keyboard.press('Tab')
    const focused = await load.locator('.load__cell:focus').boundingBox(), fixed = await footer.boundingBox()
    expect(focused.y + focused.height + 4).toBeLessThanOrEqual(fixed.y)
    await aligned(load.locator('.load__cell:focus'))
  }

  await page.setViewportSize({ width: 320, height: 900 })
  await load.scrollIntoViewIfNeeded()
  await viewport.evaluate(element => element.scrollTo(element.scrollWidth, 200))
  await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  const cells = await load.locator('.load__row--head > span:nth-child(2), [data-load-row="dense-member-8"] > span:nth-child(2), .is-unassigned > span:nth-child(2)').evaluateAll(items => items.map(item => item.getBoundingClientRect().x))
  expect(Math.max(...cells) - Math.min(...cells)).toBeLessThan(1)
  await aligned(load.locator('.load__cell:focus'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await aligned(load.locator('.load__cell:focus'))
}

async function verifyDetailReading(page, screenshot) {
  const rhythm = region(page, '完成节奏'), detail = rhythm.locator('.rhythm__detail'), viewport = region(page, '当天完成的文档')
  const day = date => rhythm.locator(`[data-date="2026-10-${date}"]`)
  await rhythm.scrollIntoViewIfNeeded()
  const stableHeight = await height(rhythm)
  await day('15').click()
  await day('18').hover()
  await expect(detail).toHaveAttribute('data-preview-date', '2026-10-18')
  const calendar = await rhythm.locator('.rhythm__scroll').boundingBox(), aside = await detail.boundingBox()
  await page.mouse.move((calendar.x + calendar.width + aside.x) / 2, aside.y + 80)
  await expect(detail).toHaveAttribute('data-preview-date', '2026-10-18')
  await detail.hover()
  await page.mouse.wheel(0, 240)
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const header = await rhythm.locator('.rhythm__detail-head').boundingBox()
  await page.mouse.wheel(0, 200)
  expect(await rhythm.locator('.rhythm__detail-head').boundingBox()).toEqual(header)
  await expect(detail.locator('a').last()).toHaveAttribute('href', '/requirements/dense-done-23')
  await viewport.evaluate(element => element.scrollTo(0, element.scrollHeight))
  await detail.locator('a').last().click()
  expect(await page.evaluate(() => window.openedLinks.at(-1))).toBe('/requirements/dense-done-23')
  await rhythm.locator('.rhythm__summary').hover()
  await expect(detail).toHaveAttribute('data-preview-date', '2026-10-15')

  // 固定今天后，重复读取同一天保留滚动；实际日期或范围改变才回到顶部。
  await day('18').click()
  await detail.hover()
  await page.mouse.wheel(0, 180)
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const readingTop = await viewport.evaluate(element => element.scrollTop)
  // 先在无惯性的模式定位，再开启普通动效验证刷新，避免仍在滚动时比较位置。
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const content = detail.locator('.rhythm__detail-content')
  await expect.poll(() => content.evaluate(element => element.getAnimations().length)).toBe(0)
  await refresh(page)
  expect(await viewport.evaluate(element => element.scrollTop)).toBe(readingTop)
  expect(await content.evaluate(element => element.getAnimations().length)).toBe(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => { window.workspaceFixture.workbenchControl.readDelay = 700 })
  await rhythm.getByRole('tab', { name: '我的', exact: true }).click()
  await expect(rhythm.locator('[role="status"]')).toHaveText('更新中…')
  expect(await height(rhythm)).toBe(stableHeight)
  await expect(rhythm.locator('.rhythm')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(0)
  await detail.hover(); await page.mouse.wheel(0, 140)
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const failureTop = await viewport.evaluate(element => element.scrollTop)
  await page.evaluate(() => { window.workspaceFixture.workbenchControl.readDelay = 0; window.workspaceFixture.workbenchControl.fail.add('completions') })
  await refresh(page)
  await expect(rhythm.getByRole('alert')).toContainText('更新失败')
  expect(await height(rhythm)).toBe(stableHeight)
  expect(await viewport.evaluate(element => element.scrollTop)).toBe(failureTop)
  await rhythm.getByRole('button', { name: '重试', exact: true }).click()
  await expect(rhythm.getByRole('alert')).toHaveCount(0)
  expect(await viewport.evaluate(element => element.scrollTop)).toBe(failureTop)

  // 所有日期（无记录/零条/多条）都不改变区块高度，返回当天重置详情滚动。
  for (const cell of await rhythm.locator('.rhythm__calendar button').all()) {
    await cell.hover()
    await expect(detail).toHaveAttribute('data-preview-date', await cell.getAttribute('data-date'))
    expect(await height(rhythm)).toBe(stableHeight)
  }
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(0)
  // Tab 从日历进入详情后，即使鼠标离开组合区域，也保留正在阅读的日期。
  await day('15').click()
  await rhythm.locator('.rhythm__summary').hover()
  await page.keyboard.press('Tab')
  await day('17').focus()
  await page.keyboard.press('Tab')
  await expect(detail).toHaveAttribute('data-preview-date', '2026-10-18')
  await detail.locator('a').first().focus()
  await rhythm.locator('.rhythm__summary').hover()
  await expect(detail).toHaveAttribute('data-preview-date', '2026-10-18')
  await page.keyboard.press('Escape')
  await expect(day('15')).toHaveAttribute('aria-pressed', 'false')
  await screenshot('workbench-home-detail-reading')
}
