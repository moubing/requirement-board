import type { AccountAccess } from '#shared/auth/access'
import { resolveAuthRedirect } from '~/utils/auth-redirect'
import { beginDetailReturnTiming } from '~/utils/detail-return-timing'

export default defineNuxtRouteMiddleware(async (to: {
  path: string
  fullPath: string
  query: Record<string, unknown>
  meta: Record<string, unknown>
}) => {
  // 仅固定的静态示例公开；不读取/提交账号，也不扩大任何业务 API 的权限。
  const path = to.path.replace(/\/+$/, '') || '/'
  if (path === '/demo') return
  const requestFetch = useRequestFetch()
  let access: AccountAccess | null
  const endAccess = beginDetailReturnTiming(to.path)?.start('access')
  try {
    access = await requestFetch<AccountAccess>('/api/account/access')
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    if (status !== 401 && status !== 403) throw createError({ statusCode: 503, message: '暂时无法读取账号信息，请刷新重试' })
    access = null
  } finally {
    endAccess?.()
  }
  const publicPage = ['/login', '/register', '/invite'].includes(path)

  if (!access && !publicPage) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  }

  if (access && ['/login', '/register'].includes(path)) {
    return navigateTo(resolveAuthRedirect(to.query.redirect, access.canAccessProject ? '/' : '/account'))
  }
  if (access && !access.canAccessProject && !['/account', '/invite'].includes(path)) {
    return navigateTo('/account')
  }
  if (access && path.startsWith('/admin') && access.user.role !== 'admin') {
    return navigateTo(access.canAccessProject ? '/' : '/account')
  }
  if (access && path === '/members' && access.user.role !== 'admin' && !access.projectRoles.includes('project_admin')) {
    return navigateTo('/')
  }
  // 结果随已通过校验的目标路由提交，不提前更新仍在显示的旧页面。
  to.meta.accountAccess = access
})
