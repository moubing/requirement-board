import { eq, ne, sql } from 'drizzle-orm'

import type { Database } from './client'
import { seedAdminId, seedDatabase, validateSeedManuals } from './seed-data'
import {
  agentAssetUploads, agentSnapshots, agentSuggestions, assets, auditEvents, authRateLimits, authVerifications, documentTemplates, documentWriteReceipts,
  projectAccessRequests, projectInvitations, projectMemberRoles, projectMembers, projects,
  requirementAgentLocks, requirementAssignees, requirementCollaborationDocuments, requirementDraftAssets, requirementDrafts,
  requirementEditEvents, requirementRelations, requirementRevisions, requirementStatuses, requirements, users,
  requirementMilestoneAssignees, requirementMilestones, requirementStatisticCoverage,
} from './schema'

/** 只支持本仓库 Docker Compose 的本机开发库，拒绝 SSH 隧道、测试库和远端库。 */
export function assertLocalResetTarget(databaseUrl: string) {
  const url = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.port !== '5438' || url.pathname !== '/requirement_board'
    || url.username !== 'requirement' || url.search || url.hash) {
    throw new Error('重置仅允许本机 localhost:5438/requirement_board，角色必须为 requirement，不能带连接参数。')
  }
}

/** CLI 已核对本机目标、停止应用并验证备份后调用；测试只能传独立测试库。 */
export async function resetLocalDatabase(db: Database) {
  validateSeedManuals()
  return db.transaction(async tx => {
    await tx.execute(sql`set local lock_timeout = '5s'`)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('requirement-board:seed'))`)
    const [admin] = await tx.select().from(users).where(eq(users.id, seedAdminId)).for('update')
    if (!admin || admin.role !== 'admin' || admin.banned) throw new Error('启用的 admin 管理员不存在，未清理任何数据。')

    // 同一 ID 会被已有浏览器检查点继续访问；重建 Yjs 时必须推进代次，拒绝旧增量回灌。
    const [epoch] = await tx.execute<{ next: number }>(sql`
      select greatest(
        coalesce((select max(edit_epoch) from ${requirementCollaborationDocuments}), 0),
        coalesce((select max(edit_epoch) from ${agentSnapshots}), 0)
      ) + 1 as next
    `)
    await tx.execute(sql`
      truncate table
        ${requirementAgentLocks}, ${agentSuggestions}, ${agentSnapshots}, ${requirementEditEvents},
        ${requirementDraftAssets}, ${requirementDrafts}, ${requirementCollaborationDocuments},
        ${requirementMilestoneAssignees}, ${requirementMilestones}, ${requirementStatisticCoverage},
        ${requirementRevisions}, ${agentAssetUploads}, ${assets}, ${documentWriteReceipts}, ${documentTemplates}, ${requirementAssignees}, ${requirementRelations}, ${requirements}, ${requirementStatuses},
        ${auditEvents}, ${projectInvitations}, ${projectAccessRequests}, ${projectMemberRoles},
        ${projectMembers}, ${projects}, ${authRateLimits}, ${authVerifications}
      restart identity
    `)
    // 外键级联仅移除其他账号的认证数据，管理员密码、会话和 AI 凭证保持原样。
    await tx.delete(users).where(ne(users.id, seedAdminId))
    return { ...await seedDatabase(tx, epoch!.next), editEpoch: epoch!.next }
  })
}
