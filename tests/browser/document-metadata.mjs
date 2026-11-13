import { expect } from '@playwright/test'

export async function verifyDocumentMetadata(page) {
  const input = page.getByRole('textbox', { name: '文档名称', exact: true })
  const previous = await input.inputValue()
  const before = await page.evaluate(() => ({ body: JSON.stringify(window.workspaceFixture.document()), versions: window.workspaceFixture.revisions.value.length }))
  await page.evaluate(() => { window.workspaceFixture.metadataRequests.length = 0 })
  await input.fill('独立保存的文档标题')
  expect(await page.evaluate(() => window.workspaceFixture.requirement.value.title)).toBe(previous)
  await input.press('Enter')
  await expect.poll(() => page.evaluate(() => window.workspaceFixture.requirement.value.title)).toBe('独立保存的文档标题')
  await expect(input).toHaveValue('独立保存的文档标题')
  await expect(page.getByLabel('版本保存状态')).toHaveText('与最新版本一致')
  const requests = await page.evaluate(() => window.workspaceFixture.metadataRequests)
  expect(requests.filter(request => request.method === 'PATCH')).toHaveLength(1)
  expect(requests.filter(request => request.url === '/api/requirements')).toHaveLength(0)
  expect(requests.filter(request => request.method === 'GET' && request.url === '/api/requirements/fixture')).toHaveLength(0)
  expect(Object.keys(requests[0].body).sort()).toEqual(['mutationId', 'title'])
  expect(await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))).toBe(before.body)
  expect(await page.evaluate(() => window.workspaceFixture.revisions.value.length)).toBe(before.versions)

  await page.evaluate(() => window.workspaceFixture.failMetadata())
  await input.fill('失败后保留的标题')
  await input.press('Tab')
  await expect(page.locator('.requirement-title-feedback')).toContainText('标题尚未保存')
  await expect(input).toHaveValue('失败后保留的标题')
  expect(await page.evaluate(() => window.workspaceFixture.requirement.value.title)).toBe('独立保存的文档标题')
  await page.getByRole('button', { name: '重试保存标题' }).click()
  await expect.poll(() => page.evaluate(() => window.workspaceFixture.requirement.value.title)).toBe('失败后保留的标题')

  await input.fill(' ')
  await input.press('Enter')
  await expect(page.locator('.requirement-title-feedback')).toContainText('标题不能为空')
  await input.press('Escape')
  await expect(input).toHaveValue('失败后保留的标题')
  await input.fill('中文输入确认')
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
  expect(await page.evaluate(() => window.workspaceFixture.requirement.value.title)).toBe('失败后保留的标题')
  await input.press('Escape')

  await page.evaluate(() => {
    const f = window.workspaceFixture
    f.metadataRequests.length = 0
    f.requirement.value = { ...f.requirement.value, title: '其他成员保存的标题' }
    f.notifyProperties()
  })
  await expect(input).toHaveValue('其他成员保存的标题')
  await expect.poll(() => page.evaluate(() => window.workspaceFixture.metadataRequests.filter(request => request.url === '/api/requirements/fixture').length)).toBe(1)
  await input.fill(previous)
  await input.press('Enter')
  await expect.poll(() => page.evaluate(() => window.workspaceFixture.requirement.value.title)).toBe(previous)
}
