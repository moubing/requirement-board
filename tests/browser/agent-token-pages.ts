import { inArray } from 'drizzle-orm'
import { expect, type Page } from '@playwright/test'
import { createDatabase } from '../../server/db/client'
import { agentTokens } from '../../server/db/schema'

export async function verifyAgentTokenPages(page: Page, database: string, origin: string, userId: string) {
  const connection = createDatabase(database)
  const ids = Array.from({ length: 23 }, (_, i) => `browser_page_pat_${String(i).padStart(3, '0')}`)
  try {
    await connection.db.insert(agentTokens).values(ids.map((id, i) => ({
      id, name: `分页验证 ${i}`, tokenHash: `unused-browser-pagination-hash-${i}`, userId,
      createdAt: new Date(Date.now() - (23 - i) * 1000),
      expiresAt: new Date(Date.now() + (i < 4 ? 1 : -1) * 86400_000),
      revokedAt: i >= 12 ? new Date() : null,
    })))
    await page.goto(`${origin}/account`)
    const panel = page.locator('.agent-tokens')
    const table = panel.locator('.agent-token-desktop')
    const filter = panel.getByRole('tablist', { name: '凭证状态筛选', exact: true })
    await expect(table.getByText('分页验证 3', { exact: true })).toBeVisible()
    await expect(panel.locator('[aria-label="有效凭证数量"]')).toHaveText('4 / 10 个有效凭证')
    await expect(panel.locator('[aria-current="page"]')).toHaveCount(0)
    await filter.getByRole('tab', { name: '已撤销 (11)', exact: true }).click()
    await expect(table.getByText('分页验证 22', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: '末页', exact: true }).click()
    await expect(table.getByText('分页验证 12', { exact: true })).toBeVisible()
    await expect(table.getByText('分页验证 3', { exact: true })).toHaveCount(0)
    await expect(panel.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(panel.locator('[aria-current="page"]')).toHaveText('2')

    await filter.getByRole('tab', { name: '有效 (4)', exact: true }).click()
    await expect(table.getByText('分页验证 3', { exact: true })).toBeVisible()
    await expect(panel.locator('[aria-current="page"]')).toHaveCount(0)
    await expect(panel.getByRole('button', { name: /^撤销 分页验证/ })).toHaveCount(4)
    await panel.getByRole('button', { name: '撤销 分页验证 3', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '撤销凭证', exact: true })
    await expect(dialog).toContainText('分页验证 3')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(panel.locator('[aria-label="有效凭证数量"]')).toHaveText('4 / 10 个有效凭证')
    await panel.getByRole('button', { name: '撤销 分页验证 3', exact: true }).click()
    await dialog.getByRole('button', { name: '确认撤销', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(panel.getByText('分页验证 3', { exact: true })).toHaveCount(0)
    await expect(panel.locator('[aria-label="有效凭证数量"]')).toHaveText('3 / 10 个有效凭证')

    // 切换筛选失败时仍展示上一批数据及有效数量；重试确实请求失败的目标。
    await page.route('**/api/account/agent-tokens?*', async route => {
      if (new URL(route.request().url()).searchParams.get('status') === 'expired') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '分页验证：临时不可用' }) })
      } else await route.continue()
    })
    await filter.getByRole('tab', { name: '已过期 (8)', exact: true }).click()
    await expect(panel.getByRole('button', { name: '重试加载凭证', exact: true })).toBeVisible()
    await expect(table.getByText('分页验证 2', { exact: true })).toBeVisible()
    await expect(panel.locator('[aria-label="有效凭证数量"]')).toHaveText('3 / 10 个有效凭证')
    await page.unroute('**/api/account/agent-tokens?*')
    await panel.getByRole('button', { name: '重试加载凭证', exact: true }).click()
    await expect(table.getByText('分页验证 11', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: /^撤销 分页验证/ })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: '重试加载凭证', exact: true })).toHaveCount(0)

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await expect(filter).toBeVisible()
    }
    console.log('通过：凭证真实分页、独立有效计数、状态筛选、撤销确认/取消、失败保留与重试、窄屏无溢出。')
  } finally {
    await page.unroute('**/api/account/agent-tokens?*')
    await connection.db.delete(agentTokens).where(inArray(agentTokens.id, ids))
    await connection.client.end()
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${origin}/account`)
  await expect(page.locator('[aria-label="有效凭证数量"]')).toHaveText('0 / 10 个有效凭证')
}
