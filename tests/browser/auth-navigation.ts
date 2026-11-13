import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { workbenchFetch } from './workbench-fixture.mjs'

// 使用本机真实 Nuxt 路由/中间件/App，不替换生命周期；浏览器 API 全部拦截，不登录或写入业务库。
const origin = new URL(process.env.BROWSER_TEST_BASE_URL ?? 'http://localhost:3000')
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('此场景只允许本机开发服务')
const user = { id: 'fixture-user', name: '导航测试员', username: 'fixture-user', email: 'fixture@example.test', role: 'user' }
const memberAccess = { user, canAccessProject: true, projectRoles: ['developer'], request: null }
let access = memberAccess, signedIn = false, failSignOut = false
const unexpected: string[] = [], business: string[] = [], errors: string[] = [], documents: string[] = []
const reports: Record<string, Frame[]> = {}
type Frame = { page: string; x: number; loginLink: boolean; sameWorkbench: boolean }
declare global {
  interface Window {
    authNavigationProbe: { start: () => void; stop: () => Frame[] }
  }
}
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_TEST_CHANNEL })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.resourceType() === 'document') documents.push(request.url()) })
  await page.addInitScript({ content: `
    let recording = false, frames = [], workbench = null
    window.authNavigationProbe = {
      start() { frames = []; workbench = document.querySelector('.desk-page'); recording = true },
      stop() { recording = false; return frames },
    }
    function sample() {
      if (recording) {
        const home = document.querySelector('.desk-page')
        frames.push({ page: home ? 'workbench' : document.querySelector('.login-page') ? 'login' : document.querySelector('.account-home') ? 'account' : 'other',
          x: document.querySelector('.app-page-scroll')?.getBoundingClientRect().x ?? -1,
          loginLink: Boolean(document.querySelector('.app-header__login')), sameWorkbench: !workbench || home === workbench })
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  ` })
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json })
    if (path.startsWith('/api/auth/sign-in/')) { signedIn = true; return reply({ user: access.user, redirect: false }) }
    if (path === '/api/auth/sign-out') {
      if (failSignOut) return reply({ code: 'FIXTURE_FAILURE', message: 'fixture' }, 500)
      signedIn = false; return reply({ success: true })
    }
    if (path === '/api/auth/get-session') return reply(signedIn ? { user: access.user, session: {} } : null)
    if (path === '/api/account/access') {
      // 故意放大等待窗口，捕捉旧页面重建、Header 提前切换及侧栏收缩。
      await new Promise(resolve => setTimeout(resolve, 600))
      return signedIn ? reply(access) : reply({ statusCode: 401, message: '未登录' }, 401)
    }
    business.push(path)
    if (path === '/api/meta') return reply({ project: { id: 'project_main', name: '测试项目' }, currentUserId: user.id, users: [], statuses: [] })
    const data = await workbenchFetch(path, { query: Object.fromEntries(url.searchParams), method: route.request().method() })
    if (data !== undefined) return reply(data)
    if (path === '/api/account/agent-tokens') return reply({ items: [], total: 0, page: 1, limit: 20, activeCount: 0 })
    unexpected.push(`${route.request().method()} ${path}`)
    return reply({ statusCode: 500, message: '未配置的测试接口' }, 500)
  })
  await page.goto(new URL('/login', origin).href)
  await page.waitForFunction(() => (document.querySelector('#__nuxt') as any)?.__vue_app__?.$nuxt?.isHydrating === false)
  const login = page.getByRole('button', { name: '登录', exact: true })
  const home = page.locator('.desk-page')
  const x = () => page.locator('.app-page-scroll').evaluate(node => node.getBoundingClientRect().x)
  async function begin() { await page.evaluate(() => window.authNavigationProbe.start()) }
  async function finish(name: string, width = 224) {
    await page.waitForTimeout(350)
    const frames = reports[name] = await page.evaluate(() => window.authNavigationProbe.stop())
    expect(frames.length, JSON.stringify({ documents, errors })).toBeGreaterThan(0)
    for (const frame of frames) {
      expect(frame.page, `${name} 不出现空白中间页`).not.toBe('other')
      if (frame.page === 'workbench') {
        expect(frame.x, `${name} 工作台首帧/退出前宽度`).toBe(width)
        expect(frame.sameWorkbench, `${name} 旧工作台未被重建`).toBe(true)
        expect(frame.loginLink, `${name} 工作台不出现未登录 Header`).toBe(false)
      } else expect(frame.x, `${name} 登录/待审批账号页宽度`).toBe(0)
    }
    console.log(`${name}：检查 ${frames.length} 帧，无中间侧栏宽度或旧页面重建。`)
  }
  async function signIn() {
    await page.locator('#login-account').fill('fixture-user')
    await page.locator('#login-password').fill('fixture-password')
    await login.click()
  }
  async function signOut() {
    await page.getByRole('button', { name: `用户菜单：${user.name}`, exact: true }).click()
    await page.getByRole('menuitem', { name: '退出登录', exact: true }).click()
  }
  await begin(); await signIn(); await expect(home).toBeVisible(); await finish('登录进入工作台')
  await expect.poll(x).toBe(224)
  // 手动开合仍经过中间宽度，保持原有动画和偏好。
  await begin(); await page.locator('[data-shell-toggle]').click(); await expect.poll(x).toBe(0)
  const closing = await page.evaluate(() => window.authNavigationProbe.stop())
  expect(closing.some(frame => frame.x > 0 && frame.x < 224)).toBe(true)
  await page.locator('[data-shell-toggle]').click(); await expect.poll(x).toBe(224)

  failSignOut = true
  await begin(); await signOut()
  await expect(page.getByRole('alert')).toHaveText('退出失败，请重试')
  await finish('退出接口失败')
  failSignOut = false
  const beforeLogout = business.length
  await begin(); await page.getByRole('menuitem', { name: '退出登录', exact: true }).click()
  await expect(login).toBeVisible(); await finish('登出返回登录页')
  expect(business.length, '登出期间不重建首页并重新发起业务请求').toBe(beforeLogout)

  await begin(); await signIn(); await expect(home).toBeVisible(); await finish('再次登录')
  // 被后续守卫取消的导航不能把候选账号/权限写入全局状态。
  access = { ...memberAccess, user: { ...user, id: 'cancelled-user' }, canAccessProject: false }
  await begin()
  await page.evaluate(async () => {
    const app = (document.querySelector('#__nuxt') as any).__vue_app__.$nuxt
    const remove = app.$router.beforeResolve((to: { path: string }) => to.path === '/account' ? false : undefined)
    try { await app.$router.push('/account') } finally { remove() }
    if (app.payload.state['$saccount-access']?.user.id !== 'fixture-user') throw new Error('取消导航污染了当前账号')
  })
  await finish('取消导航保留原账号')
  access = memberAccess

  // 会话失效经中间件重定向，仍按最终路由一次切换布局。
  signedIn = false
  await begin()
  await page.evaluate(() => (document.querySelector('#__nuxt') as any).__vue_app__.$nuxt.$router.push('/members'))
  await expect(login).toBeVisible(); await finish('会话失效重定向')

  // 用户主动收起的偏好不被登录覆盖。
  await signIn(); await expect(home).toBeVisible()
  await page.locator('[data-shell-toggle]').click(); await expect.poll(x).toBe(0)
  await begin(); await signOut(); await expect(login).toBeVisible(); await finish('收起偏好下登出', 0)
  await begin(); await signIn(); await expect(home).toBeVisible(); await finish('收起偏好下登录', 0)
  await signOut(); await expect(login).toBeVisible()

  access = { ...memberAccess, canAccessProject: false }
  await begin(); await signIn(); await expect(page).toHaveURL(new URL('/account', origin).href)
  await finish('无项目权限进入个人账号', 0)
  expect(await x()).toBe(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
  expect(documents, '认证切换必须使用 SPA 导航').toHaveLength(1)
  if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
    await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
    await writeFile(join(process.env.BROWSER_TEST_ARTIFACT_DIR, 'auth-navigation-frames.json'), JSON.stringify(reports, null, 2))
  }
  console.log('通过：真实 Nuxt 导航、登录/登出逐帧布局、失败/取消/会话失效、侧栏偏好、无项目权限；API 为受控响应。')
} finally { await browser.close() }
