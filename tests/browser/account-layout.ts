import { expect, type Page } from '@playwright/test'

export async function verifyAccountLayout(page: Page, origin: string, password: string) {
  const context = page.context()
  await page.goto(`${origin}/account`)
  const profile = page.getByRole('region', { name: '个人资料', exact: true })
  const security = page.getByRole('region', { name: '账号安全', exact: true })
  await expect(profile).toBeVisible()
  const profileBox = (await profile.boundingBox())!
  const securityBox = (await security.boundingBox())!
  expect(Math.abs(profileBox.y - securityBox.y)).toBeLessThanOrEqual(1)
  expect(securityBox.x).toBeGreaterThan(profileBox.x + profileBox.width)
  await expect(page.getByRole('link', { name: '进入工作台', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '修改密码', exact: true })
  const box = await dialog.boundingBox()
  expect(Math.round(box!.width)).toBe(480); expect(Math.round(box!.height)).toBe(480)
  await dialog.getByRole('button', { name: '保存新密码', exact: true }).click()
  await expect(dialog.getByText('请填写当前密码', { exact: true })).toBeVisible()
  expect(await dialog.boundingBox()).toEqual(box)
  const nextPassword = 'browser-new-password-12'
  let changed = false
  try {
    await dialog.getByRole('textbox', { name: '当前密码', exact: true }).fill(password)
    await dialog.getByRole('textbox', { name: '新密码', exact: true }).fill(nextPassword)
    await dialog.getByRole('textbox', { name: '确认新密码', exact: true }).fill(nextPassword)
    await dialog.getByRole('button', { name: '保存新密码', exact: true }).click()
    await expect(dialog.getByRole('status').filter({ hasText: '密码已修改' })).toBeVisible()
    changed = true
    expect(await dialog.boundingBox()).toEqual(box)
    await expect(dialog.getByRole('textbox')).toHaveCount(0)
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 500 })
      const small = await dialog.boundingBox()
      expect(small!.x).toBeGreaterThanOrEqual(0); expect(small!.x + small!.width).toBeLessThanOrEqual(width)
      expect(small!.y).toBeGreaterThanOrEqual(0); expect(small!.y + small!.height).toBeLessThanOrEqual(500)
      await expect(dialog.getByRole('button', { name: '完成', exact: true })).toBeInViewport()
    }
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
    await page.getByRole('button', { name: '修改密码', exact: true }).click()
    await expect(dialog.getByRole('textbox', { name: '当前密码', exact: true })).toHaveValue('')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  } finally {
    if (changed) expect((await context.request.post(`${origin}/api/auth/change-password`, { headers: { origin }, data: { currentPassword: nextPassword, newPassword: password, revokeOtherSessions: true } })).ok()).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const outsider = await context.browser()!.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  try {
    expect((await outsider.request.post(`${origin}/api/auth/sign-up/email`, { data: { name: '待审批测试', email: 'account-pending@example.com', password } })).ok()).toBe(true)
    const pending = await outsider.newPage()
    const tokenRequests: string[] = []
    pending.on('request', request => { if (request.url().includes('/api/account/agent-tokens')) tokenRequests.push(request.url()) })
    await pending.goto(`${origin}/account`)
    await expect(pending.getByRole('button', { name: '保存申请说明' })).toBeVisible()
    await expect(pending.locator('.agent-tokens')).toHaveCount(0)
    await expect(pending.getByRole('button', { name: '新建文档', exact: true })).toHaveCount(0)
    expect(tokenRequests).toEqual([])
  } finally { await outsider.close() }
  console.log('账号无头验证通过：个人资料与安全并排、真实改密和结果保持 480×480、320×500 适配、重开清空、无项目资格不请求凭证。')
}
