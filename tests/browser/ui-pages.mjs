import { expect } from '@playwright/test'

async function verifyTemplateViewport(page, screenshot, editing = false) {
  for (const [width, height] of [[1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height })
    const outer = page.getByRole('region', { name: '页面内容', exact: true })
    await expect.poll(() => outer.evaluate(el => el.scrollHeight - el.clientHeight), {
      message: `模板${editing ? '编辑' : '预览'}在 ${width}×${height} 不应撑出外层滚动条`,
    }).toBeLessThanOrEqual(1)
    const card = await page.locator('.templates-card').boundingBox()
    expect(card.y + card.height).toBeLessThanOrEqual(height - 23)
    if (editing) {
      const name = await page.getByRole('textbox', { name: '模板名称', exact: true }).boundingBox()
      const type = await page.getByRole('combobox', { name: '所属类型', exact: true }).boundingBox()
      expect(Math.abs(name.y - type.y)).toBeLessThanOrEqual(1)
      expect(name.x + name.width).toBeLessThan(type.x)
      const body = await page.getByRole('region', { name: '文档正文', exact: true }).boundingBox()
      expect(body.height).toBeGreaterThanOrEqual(300)
      expect(body.y + body.height).toBeLessThanOrEqual(height - 40)
    }
    await screenshot(`ui-template-${editing ? 'editing' : 'preview'}-${width}x${height}`)
  }
  await page.setViewportSize({ width: 1440, height: 960 })
}

async function verifyHeaderControls(page, screenshot) {
  const sidebar = page.locator('.app-header')
  const search = sidebar.getByRole('button', { name: '搜索文档', exact: true })
  const recent = sidebar.getByRole('button', { name: '最近浏览', exact: true })
  const account = sidebar.getByRole('button', { name: /^用户菜单：/ })
  const menu = page.getByRole('menu', { name: '最近浏览的文档', exact: true })
  const input = page.getByRole('combobox', { name: '搜索文档号或名称', exact: true })
  for (const width of [1440, 1001, 1000, 701, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 960 })
    const searchControl = width > 700 ? sidebar.locator('.requirement-header-search') : search
    if (width > 700) await expect(search).toBeHidden()
    let previousRight = 0
    for (const control of [searchControl, recent, sidebar.getByRole('button', { name: '新建文档', exact: true }), sidebar.getByRole('button', { name: '设置', exact: true }), account]) {
      const box = await control.boundingBox()
      expect(box.x, `Header ${width}px 控件不得重叠`).toBeGreaterThanOrEqual(previousRight)
      expect(box.height).toBe(40)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(64)
      previousRight = box.x + box.width
    }
    expect(previousRight).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await recent.click()
    await expect(menu).toBeVisible()
    await expect(recent).toHaveAttribute('aria-expanded', 'true')
    expect((await menu.boundingBox()).y).toBeGreaterThanOrEqual((await recent.boundingBox()).y + 40)
    await screenshot(`header-recent-${width}`)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(recent).toBeFocused()
    await searchControl.click()
    await expect(input).toBeFocused()
    await input.fill('')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await input.fill('目录')
    await expect(page.getByRole('option').first()).toBeVisible()
    await expect(input).toHaveAttribute('aria-expanded', 'true')
    if (width > 700) await expect(sidebar.getByRole('button', { name: '关闭搜索', exact: true })).toBeHidden()
    const panel = await page.getByRole('listbox').boundingBox()
    expect(panel.y).toBeGreaterThan((await input.boundingBox()).y + (await input.boundingBox()).height)
    expect(panel.x).toBeGreaterThanOrEqual(0)
    expect(panel.x + panel.width).toBeLessThanOrEqual(width)
    await screenshot(`header-search-${width}`)
    if (width <= 700) await page.keyboard.press('Escape')
    await recent.click()
    if (width <= 700) await expect(input).toBeHidden()
    else { await expect(input).toBeVisible(); await expect(input).toHaveAttribute('aria-expanded', 'false') }
    await expect(menu).toBeVisible()
    await page.keyboard.press('Control+k')
    await expect(input).toBeFocused()
    await expect(menu).toBeHidden()
    await page.keyboard.press('Escape')
    if (width > 700) await expect(input).toBeVisible()
    await account.click()
    await expect(page.getByRole('menu', { name: '用户菜单', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(account).toBeFocused()
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '新建文档', exact: true }).click()
  const creation = page.getByRole('dialog', { name: '新建文档', exact: true })
  await expect(creation.getByRole('button', { name: '创建并编辑', exact: true })).toBeVisible()
  await creation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(creation).toBeHidden()
  await expect(page.getByRole('button', { name: '新建文档', exact: true })).toBeFocused()
}

// 与工作区验收共用真实页面和侧栏，只替换接口数据；不写入开发数据库。
export async function verifyUiPages(page, url, screenshot) {
  for (const [name, heading, active] of [
    ['dashboard', '工作台', '工作台'], ['documents', '文档', '文档'],
    ['templates', '模板管理', '模板管理'], ['members', '项目成员', '成员管理'],
  ]) {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(`${url}?page=${name}`)
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeAttached()
    await expect(page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: active, exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.workspace-heading')).toHaveCount(0)
    if (name === 'dashboard') await verifyHeaderControls(page, screenshot)
    await page.keyboard.press('Control+k')
    const globalSearch = page.getByRole('combobox', { name: '搜索文档号或名称', exact: true })
    await expect(globalSearch).toBeFocused()
    await globalSearch.fill('目录')
    await expect(page.getByRole('option').first()).toContainText('文档目录与版本比较')
    await page.keyboard.press('Escape')

    if (name === 'dashboard') {
      await expect(page.getByRole('heading', { name: '项目动态', exact: true })).toBeVisible()
      await expect(page.locator('[data-flow-column]')).toHaveCount(3)
    } else if (name === 'documents') {
      await page.getByRole('textbox', { name: '搜索标题或编号', exact: true }).fill('目录')
      await expect(page.locator('.requirement-title-link')).toHaveCount(1)
      await page.getByRole('button', { name: '清除筛选', exact: true }).click()
      await expect(page.locator('.requirement-title-link')).toHaveCount(6)
      await page.getByRole('tab', { name: '按状态分组', exact: true }).click()
      await expect(page.getByRole('region', { name: '按状态分组的文档列表', exact: true })).toBeVisible()
      await screenshot('ui-documents-grouped')
      await page.getByRole('tab', { name: '全部列表', exact: true }).click()
    } else if (name === 'templates') {
      await expect(page.locator('.template-list-item').first().getByLabel('正文结构')).toContainText('背景与目标')
      await expect(page.locator('.template-list-item').first().getByLabel('正文结构')).toContainText('说明当前问题，以及希望达成的目标。')
      await expect(page.locator('.template-list-item')).toHaveCount(5)
      await expect(page.getByRole('heading', { name: '标准需求', exact: true })).toBeVisible()
      await verifyTemplateViewport(page, screenshot)
      const templateSearch = page.getByRole('textbox', { name: '搜索模板名称或用途', exact: true })
      await templateSearch.fill('不存在的模板')
      await expect(page.getByText('没有符合条件的模板', { exact: true })).toBeVisible()
      await expect(page.getByRole('document', { name: '模板正文预览', exact: true })).toHaveCount(0)
      await templateSearch.fill('复现过程')
      await expect(page.locator('.template-list-item')).toHaveCount(1)
      await expect(page.getByRole('heading', { name: '缺陷报告', exact: true })).toBeVisible()
      await templateSearch.fill('')
      await page.getByRole('combobox', { name: '筛选模板来源', exact: true }).click()
      await page.getByRole('option', { name: '项目模板', exact: true }).click()
      await expect(page.locator('.template-list-item')).toHaveCount(1)
      await expect(page.getByRole('heading', { name: '发布概述', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '编辑模板', exact: true })).toBeVisible()
      await page.getByRole('button', { name: '编辑模板', exact: true }).click()
      await expect(page.getByRole('textbox', { name: '模板名称', exact: true })).toHaveValue('发布概述')
      await verifyTemplateViewport(page, screenshot, true)
      await page.getByRole('button', { name: '放弃修改', exact: true }).click()
      await page.getByRole('combobox', { name: '筛选模板来源', exact: true }).click()
      await page.getByRole('option', { name: '全部来源', exact: true }).click()
      await page.getByRole('combobox', { name: '筛选模板类型', exact: true }).click()
      await page.getByRole('option', { name: '需求', exact: true }).click()
      await expect(page.locator('.template-list-item')).toHaveCount(1)
      await page.getByRole('combobox', { name: '筛选模板类型', exact: true }).click()
      await page.getByRole('option', { name: '全部类型', exact: true }).click()
      await page.getByRole('button', { name: '复制为新模板', exact: true }).click()
      await expect(page.getByRole('textbox', { name: '模板名称', exact: true })).toHaveValue('标准需求（副本）')
      await verifyTemplateViewport(page, screenshot, true)
      await page.getByRole('textbox', { name: '模板名称', exact: true }).fill('未保存的团队模板')
      const templateEditor = await page.locator('.tiptap').elementHandle()
      await templateSearch.fill('缺陷')
      await page.locator('.template-list-item').first().click()
      await expect(page.getByRole('status')).toContainText('请先保存或放弃当前修改')
      await expect(page.getByRole('textbox', { name: '模板名称', exact: true })).toHaveValue('未保存的团队模板')
      await templateSearch.fill('')
      await page.setViewportSize({ width: 960, height: 960 })
      await page.getByRole('tab', { name: '模板目录', exact: true }).click()
      await expect(page.locator('.template-list-item').first()).toBeVisible()
      await page.getByRole('tab', { name: '正在编辑', exact: true }).click()
      expect(await page.locator('.tiptap').evaluate((el, original) => el === original, templateEditor)).toBe(true)
      await expect(page.getByRole('textbox', { name: '模板名称', exact: true })).toHaveValue('未保存的团队模板')
      await page.setViewportSize({ width: 390, height: 960 })
      await expect.poll(async () => {
        const name = await page.getByRole('textbox', { name: '模板名称', exact: true }).boundingBox()
        const type = await page.getByRole('combobox', { name: '所属类型', exact: true }).boundingBox()
        return type.y > name.y + name.height
      }).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await screenshot('ui-template-editing-390')
      await page.setViewportSize({ width: 1440, height: 960 })
      await page.getByRole('button', { name: '放弃修改', exact: true }).click()
      await expect(page.getByRole('heading', { name: '标准需求', exact: true })).toBeVisible()
    } else {
      const members = page.locator('.members-table')
      await expect(members.locator('.account-cell-identity')).toHaveCount(10)
      await members.getByRole('button', { name: '下一页', exact: true }).click()
      await expect(members.locator('.account-cell-identity')).toHaveCount(2)
      await page.getByRole('textbox', { name: '搜索成员', exact: true }).fill('成员')
      await expect(members.locator('.account-cell-identity')).toHaveCount(10)
      await expect(members.getByRole('button', { name: '上一页', exact: true })).toBeDisabled()
      await page.getByRole('textbox', { name: '搜索成员', exact: true }).fill('member12@example.com')
      await expect(members.locator('.account-cell-identity')).toHaveCount(1)
      await expect(members).toContainText('协作成员 12')
      await page.getByRole('textbox', { name: '搜索成员', exact: true }).fill('不存在的成员')
      await expect(page.getByText('暂无符合条件的项目成员', { exact: true })).toBeVisible()
      await page.getByRole('textbox', { name: '搜索成员', exact: true }).fill('')
      await page.getByRole('button', { name: '设置角色', exact: true }).first().click()
      await expect(page.getByRole('dialog', { name: '设置项目角色', exact: true })).toBeVisible()
      await page.getByRole('button', { name: '取消', exact: true }).click()
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.dataset.bingTheme = value, theme)
      for (const width of [1440, 960, 390, 320]) {
        await page.setViewportSize({ width, height: 960 })
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        const header = await page.locator('.app-header').boundingBox()
        expect(header.width).toBe(width)
        expect(header.height).toBe(64)
        await screenshot(`ui-${name}-${theme}-${width}`)
        if (name === 'templates' && width < 1440) {
          await page.getByRole('tab', { name: '模板目录', exact: true }).click()
          await expect(page.locator('.template-list-item').first()).toBeVisible()
          await screenshot(`ui-templates-directory-${theme}-${width}`)
          await page.getByRole('tab', { name: '模板预览', exact: true }).click()
        }
      }
    }
  }
  console.log('页面无头验证通过：侧栏导航、全局搜索、工作台、列表筛选与分组、模板复制、成员角色入口，以及 320–1440px 明暗主题。')
}
