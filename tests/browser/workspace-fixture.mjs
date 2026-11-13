import { createApp, defineComponent, h, provide, ref, Suspense, watchEffect } from 'vue'
import { BingCursor, BingScrollbar, BingToast } from '@moubing/bing-ui'
import AppShell from '../../app/components/AppShell.vue'
import AppUserMenu from '../../app/components/AppUserMenu.vue'
import DashboardPage from '../../app/pages/index.vue'
import DocumentsPage from '../../app/pages/requirements/index.vue'
import TemplatesPage from '../../app/pages/templates.vue'
import MembersPage from '../../app/pages/members.vue'
import RequestsPanel from '../../app/components/accounts/RequestsPanel.vue'
import UsersPanel from '../../app/components/accounts/UsersPanel.vue'
import ConsumerAccounts from './consumer-accounts.vue'
import { useAppPreferences } from '../../app/composables/use-app-preferences'
import { useAppTheme } from '../../app/composables/use-app-theme'
import { appPreferenceHtmlAttrs } from '../../app/utils/app-preferences'
import RequirementPage from '../../app/pages/requirements/[id].vue'
import SelectionHistoryPage from '../../app/pages/selection-history/[id].vue'
import RichTextDiffViewer from '../../app/components/diff/RichTextDiffViewer.vue'
import { pageScrollViewportKey } from '../../app/utils/page-scroll-context'
import { fixture } from './workspace-runtime.mjs'
import '@moubing/bing-ui/style.css'
import '../../app/assets/css/main.css'
import '../../app/assets/css/shell.css'
import '../../app/assets/css/workspace.css'
import '../../app/assets/css/workbench.css'
import '../../app/assets/css/accounts.css'
import '../../app/assets/css/editor-workspace.css'
import '../../app/assets/css/preferences.css'

const app = createApp({ setup() {
  const scrollbar = ref(null)
  const { theme } = useAppTheme()
  const preferenceControls = useAppPreferences()
  const { preferences } = preferenceControls
  fixture.preferences = preferenceControls
  watchEffect(() => {
    for (const [key, value] of Object.entries(appPreferenceHtmlAttrs(preferences.value))) {
      if (value === undefined) document.documentElement.removeAttribute(key)
      else document.documentElement.setAttribute(key, value)
    }
    document.documentElement.dataset.bingTheme = theme.value
  })
  provide(pageScrollViewportKey, () => scrollbar.value?.viewport ?? null)
  return () => [
    h(AppShell, null, { default: () => h(BingScrollbar, { ref: scrollbar, class: 'app-page-scroll', height: 'calc(100dvh - var(--app-header-height))',
      style: { '--bing-scrollbar-gutter-left': 'var(--bing-scrollbar-gutter)' }, ariaLabel: '页面内容' }, {
      default: () => new URLSearchParams(location.search).has('fill')
        ? h('div', { style: 'height: 600px; padding: 12px' }, h(RichTextDiffViewer, { base: fixture.documentAt(1), target: fixture.documentAt(2), fillHeight: true }))
        : h(Suspense, null, { default: () => h(({ dashboard: DashboardPage, documents: DocumentsPage, templates: TemplatesPage, members: MembersPage, requests: RequestsPanel, users: UsersPanel, 'consumer-accounts': ConsumerAccounts })[new URLSearchParams(location.search).get('page')] ?? (new URLSearchParams(location.search).has('selection') ? SelectionHistoryPage : RequirementPage)) }),
    }) }),
    h(BingToast),
    h(BingCursor, { global: true, disabled: !preferences.value.customCursor, color: '#000000', outlineColor: '#ffffff' }),
  ]
} })
app.component('ClientOnly', defineComponent({ setup: (_, { slots }) => () => slots.default?.() }))
app.component('AppUserMenu', AppUserMenu)
app.component('NuxtLink', defineComponent({ props: { to: [String, Object], custom: Boolean }, setup: (props, { slots }) => {
  const navigate = event => { event?.preventDefault(); fixture.navigationRequests.push(props.to) }
  const href = () => typeof props.to === 'string' ? props.to : `${props.to.path}${props.to.query && Object.keys(props.to.query).length ? `?${new URLSearchParams(props.to.query)}` : ''}`
  return () => props.custom
    ? slots.default?.({ href: href(), navigate })
    : h('a', { href: href(), onClick: navigate }, slots.default?.())
} }))
app.mount('#app')
fixture.unmount = () => app.unmount()
window.workspaceFixture = fixture
