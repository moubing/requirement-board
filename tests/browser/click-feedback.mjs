import { expect } from '@playwright/test'

export async function verifyClickFeedback(page, url) {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(url)
  await expect(page.locator('.tiptap')).toBeVisible()
  const original = await page.evaluate(() => {
    window.feedbackEditor = document.querySelector('.tiptap')
    return JSON.stringify(window.workspaceFixture.document())
  })
  const compare = page.getByRole('tab', { name: '版本比较', exact: true })
  const body = page.getByRole('tab', { name: '正文', exact: true })
  const comparison = page.locator('.requirement-page__comparison')
  const firstFrame = await compare.evaluate(async tab => {
    tab.click()
    await new Promise(resolve => requestAnimationFrame(resolve))
    return {
      selected: tab.getAttribute('aria-selected'),
      comparisonMounted: !!document.querySelector('.requirement-page__comparison'),
      animations: [...document.querySelectorAll('.bing-click-particles:last-child .bing-click-particles__shard')]
        .flatMap(shard => shard.getAnimations()).length,
    }
  })
  // 点击反馈和选中态已更新时，重内容还未挂载；不使用机器相关的耗时阈值。
  expect(firstFrame).toEqual({ selected: 'true', comparisonMounted: false, animations: 12 })
  await expect(comparison).toBeVisible()
  await body.press('Enter')
  await expect(comparison).toBeHidden()

  // 在下一次绘制前反向选择，旧任务不能把界面又切回比较。
  await page.evaluate(async () => {
    const tabs = [...document.querySelectorAll('[role="tab"]')]
    tabs.find(tab => tab.textContent.trim() === '版本比较').click()
    await Promise.resolve()
    tabs.find(tab => tab.textContent.trim() === '正文').click()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await expect(body).toHaveAttribute('aria-selected', 'true')
  await expect(comparison).toBeHidden()
  expect(await page.evaluate(() => window.feedbackEditor === document.querySelector('.tiptap'))).toBe(true)
  expect(await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))).toBe(original)

  const navigation = page.getByRole('navigation', { name: '主导航', exact: true })
  const documents = navigation.getByRole('link', { name: '文档', exact: true })
  const firstNavigationFrame = await documents.evaluate(async button => {
    window.workspaceFixture.navigationRequests.length = 0
    button.click()
    await new Promise(resolve => requestAnimationFrame(resolve))
    return [...window.workspaceFixture.navigationRequests]
  })
  expect(firstNavigationFrame).toEqual([])
  await expect.poll(() => page.evaluate(() => window.workspaceFixture.navigationRequests)).toEqual(['/requirements'])
  await navigation.evaluate(async nav => {
    window.workspaceFixture.navigationRequests.length = 0
    const links = [...nav.querySelectorAll('[role="link"]')]
    for (const label of ['工作台', '模板管理', '成员管理']) links.find(link => link.textContent.trim() === label).click()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  expect(await page.evaluate(() => window.workspaceFixture.navigationRequests)).toEqual(['/members'])
  await expect(page.locator('.bing-click-particles')).toHaveCount(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await documents.evaluate(button => {
    window.workspaceFixture.navigationRequests.length = 0
    button.click()
    return [...window.workspaceFixture.navigationRequests]
  })).toEqual(['/requirements'])
  await expect(page.locator('.bing-click-particles')).toHaveCount(0)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  expect(await documents.evaluate(async button => {
    window.workspaceFixture.navigationRequests.length = 0
    button.click()
    window.workspaceFixture.unmount()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return [...window.workspaceFixture.navigationRequests]
  })).toEqual([])
}
