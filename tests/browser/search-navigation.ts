import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type BrowserContext } from '@playwright/test'

// 真实 Nuxt 路由、认证、协作与独立测试库；只挂起或替换指定读取响应。
export async function verifySearchNavigation(context: BrowserContext, origin: string) {
  const create = async (title: string) => {
    const response = await context.request.post(`${origin}/api/requirements`, { data: { title, templateId: null } })
    expect(response.ok()).toBe(true)
    return response.json() as Promise<{ id: string; key: string }>
  }
  const a = await create('搜索导航甲')
  const b = await create('搜索导航乙')
  const missing = await create('搜索导航失效')
  const slow = await create('搜索导航慢请求')
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (/hydration.*mismatch|failed to resolve component/i.test(message.text())) errors.push(message.text()) })
  page.setDefaultTimeout(20_000)
  const search = page.getByRole('combobox', { name: '搜索文档号或名称', exact: true })
  const results = page.getByRole('grid', { name: '搜索文档号或名称', exact: true }).getByRole('row')
  const editor = page.locator('.tiptap[contenteditable="true"]')
  // 按实际呈现帧检查编号和标签位置，避免只验证加载前后截图而漏掉中间占位文字。
  const startNavigationFrames = (id: string) => page.evaluate(id => {
    const state = {
      running: true,
      frames: [] as Array<{ key: string | null; keyX: number | null; tabsX: number | null }>,
      sample() {
        if (!state.running) return
        if (location.pathname === `/requirements/${id}`) {
          const key = document.querySelector('.requirement-navigation__key')
          const tabs = document.querySelector('.requirement-navigation [aria-label="文档视图"]')
          state.frames.push({ key: key?.textContent ?? null, keyX: key?.getBoundingClientRect().x ?? null, tabsX: tabs?.getBoundingClientRect().x ?? null })
        }
        requestAnimationFrame(state.sample)
      },
    }
    ;(window as any).__searchNavigationFrames = state
    requestAnimationFrame(state.sample)
  }, id)
  const checkNavigationFrames = async (key: string) => {
    const frames = await page.evaluate(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const state = (window as any).__searchNavigationFrames
      state.running = false
      delete (window as any).__searchNavigationFrames
      return state.frames as Array<{ key: string | null; keyX: number | null; tabsX: number | null }>
    })
    expect(frames.length).toBeGreaterThan(0)
    expect([...new Set(frames.map(frame => frame.key))], '每帧保持目标编号，不闪过文档详情或其他文档编号').toEqual([key])
    for (const field of ['keyX', 'tabsX'] as const) {
      const positions = frames.map(frame => frame[field])
      expect(positions).not.toContain(null)
      expect(Math.max(...positions as number[]) - Math.min(...positions as number[]), `${field} 在加载和恢复期间不横向位移：${[...new Set(positions)].join(', ')}`).toBeLessThanOrEqual(1)
    }
  }
  const choose = async (key: string) => {
    if (!await search.isVisible()) await page.getByRole('button', { name: '搜索文档', exact: true }).click()
    await search.fill(key)
    await search.focus()
    await expect(results.first()).toContainText(key)
  }
  let releaseDetail: () => void = () => {}
  let releaseMeta: () => void = () => {}
  let releaseCancelled: () => void = () => {}
  let detailFinished = false, detailReads = 0, metaHeld = false
  const detailGate = new Promise<void>(resolve => { releaseDetail = resolve })
  const metaGate = new Promise<void>(resolve => { releaseMeta = resolve })
  try {
    await page.goto(origin)
    await page.waitForFunction(() => (document.querySelector('#__nuxt') as any)?.__vue_app__?.$nuxt?.isHydrating === false)
    await choose(a.key)
    await page.route(`**/api/requirements/${a.id}`, async route => {
      detailReads++
      await detailGate
      detailFinished = true
      await route.continue()
    })
    await page.route('**/api/meta', async route => { metaHeld = true; await metaGate; await route.continue() })
    await startNavigationFrames(a.id)
    await results.first().click()
    await expect(page).toHaveURL(`${origin}/requirements/${a.id}`)
    await expect(page.getByRole('main', { name: '文档详情', exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '正在加载文档' })).toBeVisible()
    await expect(page.locator('.desk-page')).toHaveCount(0)
    await expect(editor).toHaveCount(0)
    expect(detailFinished, '完整详情返回前已经切换页面').toBe(false)
    expect(metaHeld, '元数据等待不阻塞详情页框架').toBe(true)
    await expect(page.locator('.requirement-navigation__key')).toHaveText(a.key)
    await expect(page.locator('.requirement-topbar')).not.toContainText('文档详情')
    await expect(page.locator('.requirement-navigation [aria-label="文档视图"]')).toHaveAttribute('inert', '')
    await expect(page.locator('.requirement-editor__toolbar')).toBeVisible()
    if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
      await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
      await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, 'detail-navigation-pending.png') })
    }
    releaseDetail()
    await expect.poll(() => detailFinished).toBe(true)
    await expect(editor).toHaveCount(0)
    releaseMeta()
    await expect(editor).toBeVisible()
    await checkNavigationFrames(a.key)
    expect(detailReads, '首次打开只读取一次详情').toBe(1)
    await page.unroute(`**/api/requirements/${a.id}`)
    await page.unroute('**/api/meta')

    await editor.click()
    await page.keyboard.insertText('搜索切换后保留的草稿')
    await choose(b.key)
    await startNavigationFrames(b.id)
    let failedReads = 0
    await page.route(`**/api/requirements/${b.id}`, route => {
      failedReads++
      return route.fulfill({ status: 503, json: { statusCode: 503, message: '测试网络失败' } })
    })
    await search.press('Enter')
    await expect(page).toHaveURL(`${origin}/requirements/${b.id}`)
    await expect(page.getByRole('alert')).toContainText('暂时无法加载文档')
    await expect(editor).toHaveCount(0)
    expect(failedReads).toBe(1)
    await page.unroute(`**/api/requirements/${b.id}`)
    await page.getByRole('button', { name: '重新加载文档', exact: true }).click()
    await expect(editor).toBeVisible()
    await checkNavigationFrames(b.key)
    await choose(a.key)
    await startNavigationFrames(a.id)
    await search.press('Enter')
    await expect(page).toHaveURL(`${origin}/requirements/${a.id}`)
    await expect(editor).toContainText('搜索切换后保留的草稿')
    await checkNavigationFrames(a.key)

    // 每条结果的独立按钮另开文档；结果本身和输入框 Enter 始终在当前页跳转。
    for (const key of [b.key, a.key]) {
      await choose(key)
      const newTab = results.first().getByRole('button', { name: /^在新标签页打开：/ })
      await expect(newTab).toBeVisible()
      await expect(page.getByRole('checkbox', { name: '在新标签页打开', exact: true })).toHaveCount(0)
      const popupPromise = context.waitForEvent('page')
      if (key === b.key) await newTab.click()
      else { await search.press('F2'); await expect(newTab).toBeFocused(); await newTab.press('Enter') }
      const popup = await popupPromise
      popup.on('pageerror', error => errors.push(error.message))
      popup.on('console', message => { if (/hydration.*mismatch|failed to resolve component/i.test(message.text())) errors.push(message.text()) })
      await expect(popup).toHaveURL(`${origin}/requirements/${key === b.key ? b.id : a.id}`)
      await expect(popup.locator('.tiptap[contenteditable="true"]')).toBeVisible()
      expect(await popup.evaluate(() => window.opener === null)).toBe(true)
      await expect(page).toHaveURL(`${origin}/requirements/${a.id}`)
      await expect(search).toHaveValue(key)
      await expect(editor).toContainText('搜索切换后保留的草稿')
      await popup.close()
    }
    await choose(missing.key)
    await page.route(`**/api/requirements/${missing.id}`, route => route.fulfill({ status: 404, json: { statusCode: 404 } }))
    await results.first().click()
    await expect(page).toHaveURL(`${origin}/requirements/${missing.id}`)
    await expect(page.getByRole('alert')).toContainText('文档已删除或暂时无权访问')
    await expect(editor).toHaveCount(0)
    await page.unroute(`**/api/requirements/${missing.id}`)

    // 从尚未加载的页面离开，再返回仍能加载；不留失效的空缓存页。
    await page.getByRole('link', { name: '返回文档列表', exact: true }).click()
    await expect(page).toHaveURL(`${origin}/requirements`)
    await expect(page.locator('.requirements-list-page')).toBeVisible()
    await choose(missing.key)
    await search.press('Enter')
    await expect(editor).toBeVisible()

    const cancelledGate = new Promise<void>(resolve => { releaseCancelled = resolve })
    let slowReads = 0
    await page.route(`**/api/requirements/${slow.id}`, async route => {
      slowReads++
      if (slowReads === 1) await cancelledGate
      await route.continue().catch(() => {})
    })
    await choose(slow.key)
    await search.press('Enter')
    await expect(page).toHaveURL(`${origin}/requirements/${slow.id}`)
    await expect(page.getByRole('main', { name: '文档详情', exact: true })).toBeVisible()
    await expect.poll(() => slowReads).toBe(1)
    await choose(missing.key)
    await search.press('Enter')
    await expect(page).toHaveURL(`${origin}/requirements/${missing.id}`)
    await expect(editor).toBeVisible()
    releaseCancelled()
    await choose(slow.key)
    await search.press('Enter')
    await expect(page).toHaveURL(`${origin}/requirements/${slow.id}`)
    await expect(editor).toBeVisible()
    expect(slowReads, '取消初始请求后返回重新读取').toBe(2)
    await page.unroute(`**/api/requirements/${slow.id}`)
    let destination = 0
    for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 })
      // 默认主题跟随系统；直接改 DOM 会在 Nuxt 导航后被 useHead 恢复，不能验证切换中的暗色。
      await page.emulateMedia({ colorScheme: theme, reducedMotion: theme === 'light' ? 'no-preference' : 'reduce' })
      await choose('搜索导航')
      await expect(results).toHaveCount(4)
      for (const result of await results.all()) {
        const button = result.getByRole('button', { name: /^在新标签页打开：/ })
        await expect(button).toBeVisible()
        const bounds = await button.boundingBox()
        const row = await result.boundingBox()
        expect(bounds!.x).toBeGreaterThan(row!.x + row!.width / 2)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      }
      if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
        await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `search-${width}-${theme}.png`) })
      }
      await search.press('Escape')
      // 三篇轮换越过两篇 KeepAlive 上限，亮暗窄屏也覆盖首次加载框架。
      const target = [a, b, missing][destination++ % 3]!
      await choose(target.key)
      await startNavigationFrames(target.id)
      await search.press('Enter')
      await expect(page).toHaveURL(`${origin}/requirements/${target.id}`)
      await expect(editor).toBeVisible()
      await checkNavigationFrames(target.key)
      if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
        await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `detail-navigation-${width}-${theme}.png`) })
      }
    }
    expect(errors).toEqual([])
    console.log('通过：加载/重试/缓存返回逐帧保持目标编号与导航横坐标、慢详情/元数据先进入详情页、单次读取、失败重试、404、加载中切换/返回、草稿恢复、鼠标/键盘新标签页及当前文档另开、SSR 水合及亮暗窄屏。')
  } catch (error) {
    console.error('搜索导航状态', { errors, page: await page.locator('body').innerText().catch(() => '') })
    throw error
  } finally {
    releaseDetail(); releaseMeta(); releaseCancelled()
    await page.close()
  }
}
