import { expect, type Page } from '@playwright/test'

export async function verifyRelatedDocumentPersistence(page: Page, ids: Record<string, string>, origin: string) {
  await page.goto(`${origin}/requirements/${ids.requirement}`)
  await page.getByRole('tab', { name: '文档信息', exact: true }).click()
  const section = page.getByRole('region', { name: '关联文档', exact: true })
  await section.getByRole('button', { name: '添加关联文档', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加关联文档', exact: true })
  const query = dialog.getByRole('searchbox', { name: '搜索关联文档', exact: true })
  await query.fill('说明浏览器验证')
  await dialog.getByText('说明浏览器验证', { exact: true }).click()
  await query.fill('待办浏览器验证')
  await dialog.getByText('待办浏览器验证', { exact: true }).click()
  await dialog.getByRole('button', { name: '确认关联（2）', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(section.locator('.related-documents__count')).toHaveText('2')
  await page.reload()
  await page.getByRole('tab', { name: '文档信息', exact: true }).click()
  await expect(section.locator('.related-documents__count')).toHaveText('2')

  const instruction = section.locator(`a[href="/requirements/${ids.instruction}"]`)
  const popupPromise = page.waitForEvent('popup')
  await instruction.click()
  const popup = await popupPromise
  try {
    await expect(popup).toHaveURL(`${origin}/requirements/${ids.instruction}`)
    await popup.getByRole('tab', { name: '文档信息', exact: true }).click()
    const reverse = popup.getByRole('region', { name: '关联文档', exact: true })
    await expect(reverse.locator(`a[href="/requirements/${ids.requirement}"]`)).toContainText('需求浏览器验证')
    await expect(popup.locator('.tiptap[contenteditable="true"]')).toBeVisible()
    await reverse.getByRole('button', { name: /更多操作$/ }).click()
    await popup.getByRole('menuitem', { name: '解除关联', exact: true }).click()
    await expect(reverse.getByText('还没有关联文档', { exact: true })).toBeVisible()
    // 原窗口不刷新，验证服务端向双方协作房间广播了变化。
    await expect(section.locator('.related-documents__count')).toHaveText('1')
    await expect(instruction).toHaveCount(0)
    await reverse.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(reverse.locator('.related-documents__count')).toHaveText('1')
    await expect(section.locator('.related-documents__count')).toHaveText('2')
  } finally { await popup.close() }

  await page.reload()
  await page.getByRole('tab', { name: '文档信息', exact: true }).click()
  await expect(section.locator('.related-documents__count')).toHaveText('2')
  const response = await page.request.get(`${origin}/api/requirements/${ids.requirement}/revisions`)
  expect(response.ok()).toBe(true)
  expect(await response.json()).toHaveLength(1)
  console.log('通过：关联文档搜索多选、刷新持久化、新标签页反向查看、双向实时解除与撤销，正文版本保持不变。')
}
