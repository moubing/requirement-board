import { expect } from '@playwright/test'

function textContrasts(root, selector) {
  const context = document.createElement('canvas').getContext('2d')
  function luminance() {
    const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255)
    const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
  }
  return [...root.querySelectorAll(selector)].filter(node => getComputedStyle(node).opacity !== '0').map(node => {
    const parents = []
    for (let parent = node; parent; parent = parent.parentElement) parents.unshift(parent)
    context.clearRect(0, 0, 1, 1); context.fillStyle = '#fff'; context.fillRect(0, 0, 1, 1)
    for (const parent of parents) { context.fillStyle = getComputedStyle(parent).backgroundColor; context.fillRect(0, 0, 1, 1) }
    const background = luminance()
    context.fillStyle = getComputedStyle(node).color; context.fillRect(0, 0, 1, 1)
    const foreground = luminance()
    return { text: node.textContent.trim(), ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) }
  })
}

export async function verifyLoginExperience(browser, page, url, screenshot) {
  const destination = '/requirements/fixture?view=diff#chapter'
  const visit = (target = page, redirect = destination) => target.goto(`${url}?page=consumer-accounts&panel=login&redirect=${encodeURIComponent(redirect)}`)
  const account = page.locator('#login-account'), password = page.locator('#login-password')
  const preview = page.locator('.login-preview'), brand = page.locator('.login-brand')
  const features = page.locator('.login-brand__feature')
  const login = page.getByRole('button', { name: '登录', exact: true })
  const loginError = page.getByRole('alert', { name: '登录失败', exact: true })
  const requests = []
  let status = 401, hold = false, release
  await page.route('**/api/auth/sign-in/*', async route => {
    requests.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() })
    if (hold) await new Promise(resolve => { release = resolve })
    if (status === 0) { await route.abort('failed'); return }
    await route.fulfill({ status, json: status === 200 ? { user: { id: 'login-fixture' } } : { code: 'FIXTURE', message: 'fixture' } })
  })
  const noRiveResources = target => target.evaluate(() => performance.getEntriesByType('resource').filter(entry => /@rive-app|\.wasm(?:\?|$)|\.riv(?:\?|$)/.test(entry.name)).map(entry => entry.name))
  const animationTimes = () => preview.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSAnimation).map(animation => [animation.animationName, Math.round(animation.currentTime ?? 0), animation.playState]))
  const visibleLetters = () => preview.locator('.preview-letter').evaluateAll(nodes => nodes.filter(node => Number(getComputedStyle(node).opacity) > .9).length)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await visit()
  await expect(preview).toHaveAttribute('data-scene', 'collaboration')
  await expect(preview).toHaveAttribute('data-paused', 'true')
  expect(await noRiveResources(page)).toEqual([])
  await expect(page.locator('.login-page canvas')).toHaveCount(0)
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: '保持登录', exact: true })).toBeChecked()
  await expect(page.getByRole('link', { name: '注册账号', exact: true })).toHaveAttribute('href', `/register?redirect=${encodeURIComponent(destination)}`)
  const logo = page.locator('.login-brand__identity img')
  const logoSource = await logo.getAttribute('src')
  await expect(logo).toHaveJSProperty('complete', true)

  // 原有表单契约：首次不报错、空值失焦校验、IME、回车转移、密码选区和 CapsLock。
  await account.focus()
  await expect(account).not.toHaveAttribute('aria-invalid', 'true')
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.imeSetComposition', { text: 'ce', selectionStart: 2, selectionEnd: 2 })
    await account.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 })
    await expect(account).toBeFocused()
    expect(requests).toHaveLength(0)
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
  } finally { await cdp.detach() }
  await account.press('Tab')
  await expect(page.getByText('请输入账号或邮箱', { exact: true })).toBeVisible()
  await expect(account).toHaveAttribute('aria-invalid', 'true')
  await account.fill('fixture-user')
  await expect(account).not.toHaveAttribute('aria-invalid', 'true')
  await account.press('Enter')
  await expect(password).toBeFocused()
  expect(requests).toHaveLength(0)
  await login.click()
  await expect(password).toBeFocused()
  await expect(page.getByText('请输入密码', { exact: true })).toBeVisible()
  expect(requests).toHaveLength(0)
  await password.fill('fixture-password')
  await password.dispatchEvent('keydown', { key: 'A', modifierCapsLock: true })
  await expect(page.getByRole('status')).toHaveText('大写锁定已开启')
  await expect(password).toHaveAttribute('aria-describedby', /login-caps-lock/)
  await password.dispatchEvent('keyup', { key: 'CapsLock', modifierCapsLock: false })
  await expect(page.locator('#login-caps-lock')).toHaveCount(0)
  await password.evaluate(input => input.setSelectionRange(2, 6))
  await page.getByRole('button', { name: '显示密码', exact: true }).click()
  await expect(password).toBeFocused()
  expect(await password.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([2, 6])
  await expect(logo).toHaveAttribute('src', logoSource)
  await password.press('Tab')
  await expect(page.getByRole('button', { name: '隐藏密码', exact: true })).toBeFocused()
  await page.keyboard.press('Space')
  await expect(password).toHaveAttribute('type', 'password')
  await password.press('Tab'); await page.keyboard.press('Tab')
  await expect(page.getByRole('checkbox', { name: '保持登录', exact: true })).toBeFocused()
  await page.keyboard.press('Space')
  await page.evaluate(() => document.fonts.ready)
  const cardBeforeSubmit = await page.locator('.login-card').boundingBox()
  const buttonBeforeSubmit = await login.boundingBox()

  hold = true
  await password.press('Enter')
  await expect(page.getByRole('button', { name: '登录中…', exact: true })).toBeDisabled()
  await expect(preview.locator('.preview-status')).toHaveText('同步中…')
  await expect(preview).toHaveAttribute('data-paused', 'true')
  for (const control of [account, password, page.getByRole('checkbox', { name: '保持登录', exact: true }), page.getByRole('button', { name: '显示密码', exact: true })]) await expect(control).toBeDisabled()
  await screenshot('login-submitting')
  await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ path: '/api/auth/sign-in/username', body: { username: 'fixture-user', rememberMe: false } })
  await expect.poll(() => typeof release).toBe('function')
  release(); hold = false
  await expect(page.getByRole('alert')).toHaveText('账号或密码不正确')
  await expect(preview).toHaveAttribute('data-scene', 'collaboration')
  await expect(preview.locator('.preview-status')).toHaveText('进行中')
  await expect(account).toHaveAttribute('aria-describedby', /login-error/)
  await expect(password).toHaveAttribute('aria-invalid', 'true')
  await expect(loginError).toHaveCount(1)
  await expect(page.locator('.login-card').getByRole('alert')).toHaveCount(0)
  expect((await page.locator('.login-card').boundingBox()).height).toBeCloseTo(cardBeforeSubmit.height, 0)
  expect((await login.boundingBox()).y).toBeCloseTo(buttonBeforeSubmit.y, 0)
  await screenshot('login-error')
  // Toast 可关闭，输入框仍保留错误描述；连续重试只展示一条，修改后清除。
  await loginError.getByRole('button', { name: '关闭消息', exact: true }).click()
  await expect(loginError).toHaveCount(0)
  await expect(account).toHaveAttribute('aria-describedby', /login-error/)
  await expect(page.locator('#login-error')).toHaveText('账号或密码不正确')
  for (let retry = 0; retry < 2; retry++) {
    const beforeRetry = requests.length
    await password.press('Enter')
    await expect.poll(() => requests.length).toBe(beforeRetry + 1)
    await expect(loginError).toHaveCount(1)
    await expect(login).toBeEnabled()
  }
  await account.fill('fixture-user-2')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(password).not.toHaveAttribute('aria-invalid', 'true')
  for (const [code, message] of [[429, '尝试次数过多，请稍后再试'], [403, '账号已停用，请联系管理员'], [400, '账号或密码不正确'], [422, '账号或密码不正确'], [503, '暂时无法登录，请稍后重试'], [0, '暂时无法登录，请稍后重试']]) {
    status = code
    await login.click()
    await expect(page.getByRole('alert')).toHaveText(message)
    await password.fill(`fixture-${code}`)
    await expect(page.getByRole('alert')).toHaveCount(0)
  }

  // 真实 CSS 时间轴：逐字输入，悬停后不再走时，移开后从原进度继续。
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.mouse.move(1250, 150)
  await visit()
  await expect(preview).toHaveAttribute('data-scene', 'collaboration')
  await expect.poll(visibleLetters).toBeGreaterThan(0)
  expect(await visibleLetters()).toBeLessThan(20)
  await preview.hover()
  await expect(preview).toHaveAttribute('data-paused', 'true')
  await page.waitForTimeout(60)
  const pausedTimes = await animationTimes(), pausedLetters = await visibleLetters()
  expect(pausedTimes.length).toBeGreaterThan(2)
  expect(pausedTimes.every(([, , state]) => state === 'paused')).toBe(true)
  await page.waitForTimeout(4200)
  expect(await animationTimes()).toEqual(pausedTimes)
  expect(await visibleLetters()).toBe(pausedLetters)
  await expect(preview).toHaveAttribute('data-scene', 'collaboration')
  await account.focus(); await page.mouse.move(1250, 150)
  await expect(preview).toHaveAttribute('data-paused', 'false')
  await expect.poll(visibleLetters).toBeGreaterThan(pausedLetters)
  await expect(preview).toHaveAttribute('data-scene', 'versions', { timeout: 4200 })
  await expect(features.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(preview.locator('.preview-diff-line--added')).toHaveCSS('opacity', '1')
  await expect(preview.locator('del')).toHaveCSS('text-decoration-line', 'line-through')
  await expect(preview).toHaveAttribute('data-scene', 'ai', { timeout: 5000 })
  await expect(features.nth(2)).toHaveAttribute('aria-pressed', 'true')
  await expect(preview.locator('.preview-ai-pending')).toHaveCSS('opacity', '1')
  await expect(preview.locator('.preview-ai-done')).toHaveCSS('opacity', '1', { timeout: 4000 })
  await expect(preview.locator('.preview-ai-after')).toHaveCSS('opacity', '1')

  // 手动选择可直接读到完整画面；亮点悬停和键盘焦点都会停止轮播。
  await features.nth(1).click()
  await expect(preview).toHaveAttribute('data-scene', 'versions')
  await expect(preview.locator('.preview-diff-line--added')).toHaveCSS('opacity', '1')
  await page.waitForTimeout(4200)
  await expect(preview).toHaveAttribute('data-scene', 'versions')
  await features.nth(2).focus(); await page.keyboard.press('Enter')
  await expect(preview).toHaveAttribute('data-scene', 'ai')
  await expect(preview.locator('.preview-ai-done')).toHaveCSS('opacity', '1')
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '暂停品牌动效', exact: true }).click()
    await account.focus(); await page.mouse.move(1250, 150)
    await expect(brand).toHaveAttribute('data-paused', 'true')
    await page.getByRole('button', { name: '播放品牌动效', exact: true }).click()
    await account.focus(); await page.mouse.move(1250, 150)
    await expect(brand).toHaveAttribute('data-paused', 'false')
  }
  await page.mouse.move(1400, 800)
  await expect.poll(() => brand.evaluate(node => node.style.getPropertyValue('--parallax-x'))).not.toBe('')
  const shifts = await brand.evaluate(node => ['--parallax-x', '--parallax-y'].map(key => Math.abs(parseFloat(node.style.getPropertyValue(key)))))
  expect(Math.max(...shifts)).toBeLessThanOrEqual(5)
  // 页面失焦暂停，再聚焦恢复。
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(brand).toHaveAttribute('data-paused', 'true')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(brand).toHaveAttribute('data-paused', 'false')

  status = 401; hold = true; release = undefined
  await account.fill('fixture-user'); await password.fill('fixture-password')
  const beforeLoginScene = await preview.getAttribute('data-scene')
  await login.click()
  await expect(preview.locator('.preview-status')).toHaveText('同步中…')
  await expect(preview).toHaveAttribute('data-paused', 'true')
  await page.waitForTimeout(4200)
  await expect(preview).toHaveAttribute('data-scene', beforeLoginScene)
  await expect.poll(() => typeof release).toBe('function')
  release(); hold = false
  await expect(page.getByRole('alert')).toHaveText('账号或密码不正确')
  await expect(preview).toHaveAttribute('data-scene', beforeLoginScene)
  expect(await page.locator('.login-card').evaluate(node => getComputedStyle(node).animationDuration)).toBe('0.28s')
  await password.fill('fixture-password-2')
  status = 200
  await page.evaluate(() => {
    const timing = window.loginSuccessTiming = {}
    const observer = new MutationObserver(() => {
      if (!timing.success && document.querySelector('.preview-status')?.textContent.includes('已完成')) timing.success = performance.now()
    })
    observer.observe(document.querySelector('.login-page'), { subtree: true, attributes: true, childList: true, characterData: true })
    const requests = window.workspaceFixture.navigationRequests, push = requests.push.bind(requests)
    requests.push = (...args) => { timing.navigation = performance.now(); observer.disconnect(); return push(...args) }
  })
  await login.click()
  await expect(page.getByRole('button', { name: '登录成功', exact: true })).toBeDisabled()
  await expect(preview.locator('.preview-status')).toHaveText('已完成')
  await screenshot('login-success')
  await expect.poll(() => page.evaluate(() => window.workspaceFixture.navigationRequests)).toEqual([destination])
  const extraWait = await page.evaluate(() => window.loginSuccessTiming.navigation - window.loginSuccessTiming.success)
  expect(extraWait).toBeGreaterThanOrEqual(400); expect(extraWait).toBeLessThan(600)
  console.log(`成功状态同步至导航：${extraWait.toFixed(1)}ms。`)
  expect(requests.at(-1).body.rememberMe).toBe(true)

  // 减少动态效果：回到首场景静态帧，允许键盘切换，不再自动播放或视差。
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await visit()
  await expect(preview).toHaveAttribute('data-scene', 'collaboration')
  await page.waitForTimeout(4200)
  await expect(preview).toHaveAttribute('data-scene', 'collaboration')
  expect(await animationTimes()).toEqual([])
  await features.nth(2).focus(); await page.keyboard.press('Enter')
  await expect(preview).toHaveAttribute('data-scene', 'ai')
  await expect(preview.locator('.preview-ai-done')).toHaveCSS('opacity', '1')
  await page.mouse.move(1400, 800)
  expect(await brand.evaluate(node => node.style.getPropertyValue('--parallax-x'))).toBe('')
  await visit(page, '//example.com')
  await account.fill('  fixture@example.test  '); await password.fill(' fixture-password ')
  await password.press('Enter')
  await expect.poll(() => page.evaluate(() => window.workspaceFixture.navigationRequests)).toEqual(['/'])
  expect(requests.at(-1)).toMatchObject({ path: '/api/auth/sign-in/email', body: { email: 'fixture@example.test', password: ' fixture-password ' } })

  // 请求和成功反馈期间卸载，晚到的结果不能导航。
  await visit(); await account.fill('fixture-user'); await password.fill('fixture-password')
  hold = true; release = undefined
  await login.click(); await expect.poll(() => typeof release).toBe('function')
  await page.evaluate(() => window.workspaceFixture.unmount())
  release(); hold = false
  await page.waitForTimeout(650)
  expect(await page.evaluate(() => window.workspaceFixture.navigationRequests)).toEqual([])
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await visit(); await account.fill('fixture-user'); await password.fill('fixture-password')
  await login.click()
  await expect(page.getByRole('button', { name: '登录成功', exact: true })).toBeVisible()
  await page.evaluate(() => window.workspaceFixture.unmount())
  await page.waitForTimeout(650)
  expect(await page.evaluate(() => window.workspaceFixture.navigationRequests)).toEqual([])

  // 六份交付视图、三场景关键帧、边界尺寸和真实文字配色。
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const formSelector = 'h1, .bing-form-item__label, .login-card__brand p, .login-card__footer, .login-register'
  const sceneSelector = 'h3, .preview-breadcrumb, .preview-status, .preview-lead, .preview-caret > span, .preview-diff-line, .preview-diff-summary > span, .preview-ai-after, .preview-annotation p, .preview-annotation-anchor, .preview-ai-done'
  for (const theme of ['light', 'dark']) for (const [width, height] of [[320, 667], [375, 667], [768, 900], [960, 900], [1024, 900], [1440, 900]]) {
    await page.setViewportSize({ width, height }); await visit()
    await page.locator('html').evaluate((node, theme) => node.dataset.bingTheme = theme, theme)
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(250)
    await expect(login).toBeInViewport({ ratio: 1 })
    const layout = await page.locator('.login-layout').boundingBox(), card = await page.locator('.login-card').boundingBox()
    expect(layout.x).toBeGreaterThanOrEqual(0); expect(layout.x + layout.width).toBeLessThanOrEqual(width)
    const accountBox = await account.boundingBox(), passwordBox = await password.boundingBox()
    const passwordLabel = await page.locator('.login-field').nth(1).locator('label').boundingBox()
    const options = await page.locator('.login-form__options').boundingBox(), button = await login.boundingBox()
    for (const [name, gap] of [['账号至密码', passwordLabel.y - accountBox.y - accountBox.height], ['密码至选项', options.y - passwordBox.y - passwordBox.height], ['选项至按钮', button.y - options.y - options.height]]) {
      expect(gap, `${width}px ${theme} ${name}`).toBeGreaterThanOrEqual(16)
      expect(gap, `${width}px ${theme} ${name}`).toBeLessThanOrEqual(24)
    }
    if (width >= 1024) {
      await expect(preview).toBeVisible()
      expect((await preview.boundingBox()).x + (await preview.boundingBox()).width).toBeLessThan(card.x)
      await expect(logo).toBeVisible()
    } else {
      await expect(preview).toHaveCount(0)
      await expect(features.first()).toBeHidden()
      await expect(width < 768 ? page.locator('.login-card__logo') : logo).toBeVisible()
      expect(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('LoginScenePreview.vue')))).toBe(false)
    }
    const formRatios = await page.locator('.login-card').evaluate(textContrasts, formSelector)
    expect(Math.min(...formRatios.map(value => value.ratio)), JSON.stringify(formRatios)).toBeGreaterThanOrEqual(4.5)
    expect(await noRiveResources(page)).toEqual([])
    if ([375, 960, 1440].includes(width)) await screenshot(`login-${width}-${theme}`)
    if (width === 1440) for (let index = 0; index < 3; index++) {
      await features.nth(index).click(); await page.waitForTimeout(220)
      const sceneRatios = await preview.evaluate(textContrasts, sceneSelector)
      expect(Math.min(...sceneRatios.map(value => value.ratio)), JSON.stringify(sceneRatios)).toBeGreaterThanOrEqual(4.5)
      await screenshot(`login-scene-${['collaboration', 'versions', 'ai'][index]}-${theme}`)
    }
  }

  const touch = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' })
  try {
    const touchPage = await touch.newPage(); await visit(touchPage)
    await expect(touchPage.locator('.login-card__logo')).toBeVisible()
    await expect(touchPage.locator('.login-preview')).toHaveCount(0)
    await touchPage.locator('#login-password').tap()
    await touchPage.getByRole('button', { name: '显示密码', exact: true }).tap()
    await expect(touchPage.locator('#login-password')).toHaveAttribute('type', 'text')
    await touchPage.mouse.move(300, 300)
    expect(await touchPage.locator('.login-brand').evaluate(node => node.style.getPropertyValue('--parallax-x'))).toBe('')
  } finally { await touch.close() }

  // 预览模块失败或延迟返回，不阻塞登录，也不在卸载后复活。
  await page.setViewportSize({ width: 1440, height: 900 })
  const sceneModule = target => target.pathname.endsWith('/LoginScenePreview.vue')
  await page.route(sceneModule, route => route.abort('failed'))
  await visit(); await expect(page.locator('.login-brand__placeholder')).toBeVisible()
  await account.fill('fixture-user'); await password.fill('fixture-password')
  status = 401; await login.click()
  await expect(page.getByRole('alert')).toHaveText('账号或密码不正确')
  await page.unroute(sceneModule)
  let releaseModule
  await page.route(sceneModule, async route => { await new Promise(resolve => { releaseModule = resolve }); await route.continue() })
  await visit(); await expect.poll(() => typeof releaseModule).toBe('function')
  await page.evaluate(() => window.workspaceFixture.unmount())
  releaseModule(); await page.waitForTimeout(150)
  await expect(preview).toHaveCount(0)
  await page.unroute(sceneModule); await page.unroute('**/api/auth/sign-in/*')
  console.log('通过：三场景播放/手动选择、真实动画暂停续播、登录状态同步、静态 Logo、无 Rive 请求、完整表单交互与认证分支、Toast 错误关闭/重试/恢复、减少动态效果/触屏、模块失败/卸载，以及 320–1440px 亮暗布局、紧凑间距和文字对比度。')
}
