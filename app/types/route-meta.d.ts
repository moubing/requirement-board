import type { AccountAccess } from '#shared/auth/access'

declare module 'vue-router' {
  interface RouteMeta {
    /** 本次导航的权限校验结果，仅在路由确认后写入全局账号状态。 */
    accountAccess?: AccountAccess | null
  }
}

export {}
