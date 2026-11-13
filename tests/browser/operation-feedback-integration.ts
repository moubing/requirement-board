import { expect, type BrowserContext, type Page, type Route } from '@playwright/test'

/** 使用真实 Nuxt、IndexedDB、协作和版本接口，不能用 prepareVersion 的替身代替。 */
export async function verifyOperationFeedbackIntegration(page: Page, context: BrowserContext, origin: string) {
  page.setDefaultTimeout(15_000)
  const response = await context.request.post(`${origin}/api/requirements`, { data: { title: '操作反馈真实回归', templateId: null } })
  expect(response.ok()).toBe(true)
  const document = await response.json() as { id: string; key: string }
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes(`/api/requirements/${document.id}`)) requests.push(`${request.method()} ${new URL(request.url()).pathname}`) })
  page.on('response', response => { if (response.url().includes(`/api/requirements/${document.id}`)) requests.push(`${response.status()} ${new URL(response.url()).pathname}`) })
  await page.goto(`${origin}/requirements/${document.id}`)
  const editor = page.locator('.tiptap[contenteditable="true"]')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.insertText('保存后必须进入正式版本的正文')
  await page.getByRole('button', { name: '保存版本', exact: true }).click()
  const save = page.getByRole('dialog', { name: '保存正式版本', exact: true })
  await save.getByRole('textbox', { name: '版本说明', exact: true }).fill('真实保存回归')
  await save.getByRole('button', { name: '确认保存版本', exact: true }).click()
  await expect(save).toBeHidden()
  try {
    await expect(page.getByText(`${document.key} 已保存版本 v2`, { exact: true })).toBeVisible({ timeout: 20_000 })
  } catch (error) {
    console.error('保存流程请求记录', requests)
    throw error
  }
  const saved = await (await context.request.get(`${origin}/api/requirements/${document.id}`)).json()
  expect(saved.currentRevision.version).toBe(2)
  expect(saved.currentRevision.contentText).toContain('保存后必须进入正式版本的正文')
  expect(saved.currentRevision.changeNote).toBe('真实保存回归')
  console.log('通过：真实草稿、协作和版本保存完成，Toast 更新为成功。')

  // 协作请求挂起时，保存前 flush 也必须超时；不能只给最后的版本 POST 加超时。
  const editsUrl = `**/api/requirements/${document.id}/edits`
  const heldEdits: Route[] = []
  await page.route(editsUrl, route => { heldEdits.push(route) })
  await editor.click()
  await page.keyboard.insertText('网络恢复后仍要保存的修改')
  await page.getByRole('button', { name: '保存版本', exact: true }).click()
  await save.getByRole('textbox', { name: '版本说明', exact: true }).fill('超时后保留的版本说明')
  await save.getByRole('button', { name: '确认保存版本', exact: true }).click()
  try {
    await expect.poll(() => heldEdits.length).toBeGreaterThan(0)
    await expect(page.getByText(new RegExp(`${document.key} 保存版本未完成`))).toBeVisible({ timeout: 18_000 })
    await expect(page.getByText(`正在保存 ${document.key} 的正式版本`, { exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: '保存版本', exact: true })).toBeEnabled()
  } finally {
    await page.unroute(editsUrl)
    await Promise.all(heldEdits.map(route => route.abort().catch(() => {})))
  }
  await page.getByRole('button', { name: '保存版本', exact: true }).click()
  await expect(save.getByRole('textbox', { name: '版本说明', exact: true })).toHaveValue('超时后保留的版本说明')
  await save.getByRole('button', { name: '确认保存版本', exact: true }).click()
  await expect(page.getByText(`${document.key} 已保存版本 v3`, { exact: true })).toBeVisible()
  const recovered = await (await context.request.get(`${origin}/api/requirements/${document.id}`)).json()
  expect(recovered.currentRevision.contentText).toContain('网络恢复后仍要保存的修改')
  expect(recovered.currentRevision.changeNote).toBe('超时后保留的版本说明')
  console.log('通过：协作请求挂起会结束保存提示，恢复网络后可保存原正文和说明。')

  // 实际写入后丢失响应，再次确认沿用同一 clientSaveId；刷新失败不能误报版本未保存。
  const versionsUrl = `**/api/requirements/${document.id}/revisions`
  const versionBodies: unknown[] = []
  let loseResponse = true, failRefresh = false
  await page.route(versionsUrl, async route => {
    if (route.request().method() === 'POST') {
      versionBodies.push(route.request().postDataJSON())
      const response = await route.fetch()
      if (loseResponse) { loseResponse = false; await route.abort('failed') }
      else { failRefresh = true; await route.fulfill({ response }) }
    } else if (failRefresh) await route.fulfill({ status: 503, json: { message: '版本列表暂不可用' } })
    else await route.continue()
  })
  await page.getByRole('button', { name: '保存版本', exact: true }).click()
  await save.getByRole('textbox', { name: '版本说明', exact: true }).fill('响应丢失时仍然只生成一次')
  await save.getByRole('button', { name: '确认保存版本', exact: true }).click()
  await expect(page.getByText(new RegExp(`${document.key} 保存版本未完成`))).toBeVisible()
  await page.getByRole('button', { name: '保存版本', exact: true }).click()
  await expect(save.getByRole('textbox', { name: '版本说明', exact: true })).toHaveValue('响应丢失时仍然只生成一次')
  await save.getByRole('button', { name: '确认保存版本', exact: true }).click()
  await expect(page.getByText('操作已成功，最新列表暂未加载，请稍后刷新。', { exact: true })).toBeVisible()
  expect(versionBodies).toHaveLength(2)
  expect(versionBodies[0]).toEqual(versionBodies[1])
  expect((await (await context.request.get(`${origin}/api/requirements/${document.id}`)).json()).currentRevision.version).toBe(4)
  await page.unroute(versionsUrl)
  console.log('通过：版本响应丢失可幂等重试，列表刷新失败保留已保存结果。')

  // 标题的等待状态只出现在 Toast；空值校验、网络失败与重试仍在字段旁可恢复。
  const title = page.getByRole('textbox', { name: '文档名称', exact: true })
  const titleUrl = `**/api/requirements/${document.id}`
  let titleRequest: Route | undefined
  await page.route(titleUrl, route => {
    if (route.request().method() === 'PATCH') titleRequest = route
    else void route.continue()
  })
  await title.fill('标题延迟回归')
  await title.press('Enter')
  await expect.poll(() => !!titleRequest).toBe(true)
  await expect(page.getByText(`正在保存 ${document.key} 的标题`, { exact: true })).toBeVisible()
  await expect(page.locator('.requirement-title-feedback')).toHaveCount(0)
  await expect(title).toBeDisabled()
  await titleRequest!.continue()
  await expect(page.getByText(`${document.key} 的标题已保存`, { exact: true })).toBeVisible()
  await expect(title).toBeEnabled()
  titleRequest = undefined
  await title.fill('失败后保留的标题')
  await title.press('Tab')
  await expect.poll(() => !!titleRequest).toBe(true)
  await titleRequest!.fulfill({ status: 503, json: { message: '标题写入暂不可用' } })
  await expect(page.locator('.requirement-title-feedback')).toContainText('标题尚未保存')
  await expect(title).toHaveValue('失败后保留的标题')
  await page.unroute(titleUrl)
  await page.getByRole('button', { name: '重试保存标题', exact: true }).click()
  await expect(page.locator('.requirement-title-feedback')).toHaveCount(0)
  await expect(title).toBeEnabled()
  expect((await (await context.request.get(`${origin}/api/requirements/${document.id}`)).json()).title).toBe('失败后保留的标题')
  await title.fill(' ')
  await title.press('Enter')
  await expect(page.locator('.requirement-title-feedback')).toContainText('文档标题不能为空')
  await page.getByRole('button', { name: '取消修改', exact: true }).click()
  await expect(title).toHaveValue('失败后保留的标题')
  console.log('通过：标题没有重复进度或空白占位，失败重试与校验保留。')

  const create = page.getByRole('dialog', { name: '新建文档', exact: true })
  const startCreate = async (title: string) => {
    await page.getByRole('button', { name: '新建文档', exact: true }).click()
    await create.getByRole('textbox', { name: '文档标题', exact: true }).fill(title)
    await create.getByRole('button', { name: '创建并编辑', exact: true }).click()
    await expect(create).toBeHidden()
  }
  for (const name of ['创建后自动进入详情', '连续创建的下一篇文档']) {
    const createdResponse = page.waitForResponse(response => response.url() === `${origin}/api/requirements` && response.request().method() === 'POST')
    await startCreate(name)
    const created = await (await createdResponse).json()
    await expect(page).toHaveURL(`${origin}/requirements/${created.id}`)
    await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue(name)
    await expect(page.locator('.document-create-result')).toHaveCount(0)
  }

  // 创建期间用户切页，仍提供结果入口；真正打开目标文档后才清除。
  let releaseCreation!: () => void
  const creationHeld = new Promise<void>(resolve => { releaseCreation = resolve })
  let creationStarted = false
  await page.route('**/api/requirements', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    const response = await route.fetch()
    creationStarted = true
    await creationHeld
    await route.fulfill({ response })
  })
  await startCreate('切页后保留创建入口')
  await expect.poll(() => creationStarted).toBe(true)
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '工作台', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/`)
  releaseCreation()
  const resultLink = page.getByRole('link', { name: '已创建：切页后保留创建入口', exact: true })
  await expect(resultLink).toBeVisible()
  await expect(page).toHaveURL(`${origin}/`)
  await resultLink.click()
  await expect(page.getByRole('textbox', { name: '文档名称', exact: true })).toHaveValue('切页后保留创建入口')
  await expect(page.locator('.document-create-result')).toHaveCount(0)
  await page.unroute('**/api/requirements')
  console.log('通过：正常创建及连续创建不残留结果条，切页时保留入口、打开目标后清除。')
}
