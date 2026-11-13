import { expect } from '@playwright/test'

// 正式 npm 包 + 真实业务组件；接口响应由已有工作区 fixture 提供。
export async function verifyConsumer018(page, url, screenshot) {
  const history = await page.evaluate(() => window.workspaceFixture.createSelectionContext())
  const entries = [
    ['documents', 'page=documents'], ['users', 'page=users'], ['requests', 'page=requests'],
    ['invitations', 'page=consumer-accounts&panel=invitations&consumer018=1'],
    ['tokens', 'page=consumer-accounts&panel=tokens&consumer018=1'],
    ['members', 'page=members'], ['history', `selection=1&context=${history}`],
  ]
  for (const [name, query] of entries) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${url}?${query}`)
    const table = page.locator('.bing-table').first()
    await expect(table.locator('tbody tr[data-row-index]').first()).toBeVisible()
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((node, value) => node.dataset.bingTheme = value, theme)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 })
        if (name === 'tokens' && width === 390) {
          await expect(page.locator('.agent-token-cards')).toContainText('联动验证凭证')
          await expect(page.getByRole('button', { name: '撤销 联动验证凭证', exact: true })).toBeVisible()
          await screenshot(`consumer-018-${name}-${theme}-${width}`)
          continue
        }
        const first = table.locator('tbody tr[data-row-index]').first()
        const cells = first.locator('td[data-bing-table-cell]')
        await cells.first().focus()
        await page.keyboard.press('ArrowRight')
        // 树表首列 ArrowRight 可展开；End 在所有表中均移到末列。
        await page.keyboard.press('End')
        await expect(cells.last()).toBeFocused()
        const controls = cells.last().locator('button:not(:disabled), input:not(:disabled), a[href]')
        if (await controls.count()) {
          await page.keyboard.press('F2')
          await expect(controls.first()).toBeFocused()
          await page.keyboard.press('Escape')
          await expect(cells.last()).toBeFocused()
        }
        const viewport = table.locator('.bing-scrollbar__viewport').first()
        await viewport.evaluate(node => { node.scrollLeft = node.scrollWidth; node.scrollTop = node.scrollHeight })
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
        await screenshot(`consumer-018-${name}-${theme}-${width}`)
      }
    }
    if (name === 'history') {
      const row = table.locator('tbody tr[data-row-index]').last()
      await row.locator('td[data-column-key]').first().press('Enter')
      await expect(row).toHaveAttribute('aria-current', 'true')
      const first = table.locator('tbody tr[data-row-index]').first()
      await first.locator('.bing-table__cell-text').first().click()
      await expect(first).toHaveAttribute('aria-current', 'true')
    }
  }
  await page.goto(`${url}?page=consumer-accounts&panel=tokens&consumer018=1&failTokens=1`)
  await expect(page.locator('.agent-credentials [role="alert"]')).toContainText('操作失败，请稍后重试')
  await page.getByRole('button', { name: '重试加载凭证', exact: true }).click()
  await expect(page.locator('.agent-credentials [role="alert"]')).toHaveCount(0)
  await expect(page.locator('.bing-table tbody')).toContainText('联动验证凭证')
  console.log('0.18 联动通过：7 处业务表格的键盘编辑/焦点返回、滚动末端、1440/390px 亮暗主题；选区历史点击与 Enter 激活、凭证加载错误和重试。')
}
