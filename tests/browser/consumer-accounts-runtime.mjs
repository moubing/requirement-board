// 只替换账号接口响应；回归使用真实页面、表单、菜单和弹窗。
const consumer018 = new URLSearchParams(location.search).has('consumer018')
const tokens = consumer018 ? [{ id: 'consumer-token', name: '联动验证凭证', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString(), revokedAt: null, lastUsedAt: null }] : []
const awaitingApproval = new URLSearchParams(location.search).has('pendingAccount')
export const consumerAccounts = {
  tokens, requests: [],
  access: { user: { id: 'fixture-user', name: '测试成员', username: 'fixture.user', email: 'member@example.test', role: awaitingApproval ? 'user' : 'admin', avatarColor: '#3366cc' },
    canAccessProject: !awaitingApproval, projectRoles: awaitingApproval ? [] : ['project_admin', 'developer', 'designer'],
    request: awaitingApproval ? { id: 'request-fixture', status: 'pending', message: '原申请说明', reviewNote: '', reviewedAt: null } : null },
}
const status = token => token.revokedAt ? 'revoked' : Date.parse(token.expiresAt) <= Date.now() ? 'expired' : 'active'
const tokenFixture = new URLSearchParams(location.search).get('tokenFixture')
if (tokenFixture) {
  const active = tokenFixture === 'limit' ? 10 : 2
  for (let index = 0; index < active + 16; index++) tokens.push({
    id: 'account-token-' + index, name: index < active ? '工作电脑 ' + (index + 1) : '历史凭证 ' + (index + 1),
    createdAt: new Date(Date.now() - 20 * 86400_000).toISOString(),
    expiresAt: new Date(Date.now() + (index < active ? index === 0 ? 7 : 30 : -1) * 86400_000).toISOString(),
    revokedAt: index >= active + 13 ? new Date().toISOString() : null,
  })
}
export function consumerAccountFetch(url, options) {
  consumerAccounts.requests.push({ url, method: options.method ?? 'GET', query: options.query, body: options.body })
  if (url === '/api/account/access') return structuredClone(consumerAccounts.access)
  if (url === '/api/account/request') {
    consumerAccounts.access.request = { id: 'request-fixture', status: 'pending', message: options.body.message, reviewNote: '', reviewedAt: null }
    return { id: 'request-fixture' }
  }
  if (url === '/api/admin/invitations') {
    if (options.method === 'POST') return { invitation: { id: 'fixture-invitation' }, url: 'https://example.test/invite/fixture' }
    const items = consumer018 ? [{ id: 'consumer-invitation', name: '联动验证邀请', email: 'consumer@example.test', roles: ['developer'], status: 'pending', expiresAt: new Date(Date.now() + 86400_000).toISOString() }] : []
    return { items, total: items.length, page: 1, limit: 20 }
  }
  if (url.endsWith('/revoke')) { tokens.find(token => url.includes('/' + token.id + '/')).revokedAt = new Date().toISOString(); return { success: true } }
  if (options.method === 'POST') {
    const created = { id: 'fixture-token-' + tokens.length, name: options.body.name, createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + options.body.expiresInDays * 86400_000).toISOString(), revokedAt: null }
    tokens.unshift(created)
    return { ...created, token: 'fixture-only-not-a-valid-token' }
  }
  const { page = 1, limit = 10, status: filter = 'all' } = options.query ?? {}
  const filtered = tokens.filter(token => filter === 'all' || status(token) === filter)
  return { items: structuredClone(filtered.slice((page - 1) * limit, page * limit)), total: filtered.length, page, limit,
    activeCount: tokens.filter(token => status(token) === 'active').length, asOf: new Date().toISOString() }
}
