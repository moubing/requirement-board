import type { RouterConfig } from '@nuxt/schema'

export default {
  // 页面由 AppPageScrollbar 承载，避免 Vue Router 同时滚动 window。
  scrollBehavior: () => false,
} satisfies RouterConfig
