import { and, desc, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import * as Y from 'yjs'
import { applySuggestionOperations, DOCUMENT_SCHEMA_VERSION, MAX_AGENT_DOCUMENT_BYTES, SuggestionContentError, type CreateSuggestionInput, type DocumentSnapshot, type SuggestionConflictReason, type SuggestionInput } from '../../shared/agent/suggestions'
import { applyCandidateToYDocument } from '../../shared/agent/collaboration'
import { collaborationSignature, readCollaborationDocument } from '../../shared/collaboration/document'
import { addNodeContributors, changedAttributionNodes, emptyAttribution } from '../../shared/collaboration/attribution'
import { extractPlainText } from '../../shared/editor/document'
import type { Database, Transaction } from '../db/client'
import { agentSnapshots, agentSuggestions, agentTokens, requirementAgentLocks, requirementCollaborationDocuments, requirementEditEvents, requirementRevisions, requirements, users } from '../db/schema'
import { broadcastRequirementProperties, broadcastSavedRevision, exclusiveDocument, initializeCollaboration, persistLockedCollaboration, publishAgentLock, publishAgentState, withLockedCollaboration } from './collaboration'
import { assertDraftImages, requireDraftRequirement } from './requirement-drafts'
import { lockAssetReferences } from './asset-references'
import { currentNodeContributions } from './node-contributions'
import { writeAudit } from './audit'
import { activeAgentLock, agentLockLost, requirementLocked } from './agent-locks'
import { AGENT_LOCK_DURATION_MS } from '../../shared/agent/lock'
import { describePropertyChanges, normalizeAssignments, propertiesOf, updateRequirementProperties, updateRequirementTitle, validateProperties } from './requirement-properties'
import { createRequirement, normalizeCreationContent, resolveCreationProperties } from './create-requirement'
import type { RequirementPropertyPatch } from '../../shared/requirements/properties'
import { agentContentToken } from './agent-reading'
import { liveAnnotationCompletions } from './annotation-completions'

type Suggestion = typeof agentSuggestions.$inferSelect
type Snapshot = typeof agentSnapshots.$inferSelect
const staleBase = () => createError({ statusCode: 409, message: '需求已发生变化，请重新读取文档并生成操作', data: { code: 'STALE_BASE' } })
const signature = (value: string) => createHash('sha256').update(value).digest('hex')

async function actionConflict(db: Database | Transaction, suggestion: Pick<Suggestion, 'properties' | 'revisionNote'>, snapshot: Snapshot, current: DocumentSnapshot): Promise<SuggestionConflictReason> {
  const conflict = await baselineConflict(snapshot, current)
  if (conflict) return conflict
  const row = await db.query.requirements.findFirst({ where: eq(requirements.id, snapshot.requirementId) })
  if (!row) return 'properties_changed'
  const properties = await propertiesOf(db, row)
  if (Object.keys(suggestion.properties).some(key => {
    if (key === 'assigneeIds') return JSON.stringify(properties.assigneeIds) !== JSON.stringify(snapshot.properties.assigneeIds)
    return properties[key as keyof RequirementPropertyPatch] !== snapshot.properties[key as keyof RequirementPropertyPatch]
  })) return 'properties_changed'
  if (suggestion.revisionNote !== null) {
    const latest = await db.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.requirementId, snapshot.requirementId), orderBy: desc(requirementRevisions.version) })
    if (latest?.id !== snapshot.baseRevisionId) return 'revision_changed'
  }
  return null
}

async function baselineConflict(snapshot: Snapshot, current: DocumentSnapshot): Promise<SuggestionConflictReason> {
  if (snapshot.schemaVersion !== DOCUMENT_SCHEMA_VERSION) return 'schema_changed'
  return snapshot.signature !== await collaborationSignature(current) ? 'document_changed' : null
}

async function assertBase(snapshot: Snapshot, current: typeof requirementCollaborationDocuments.$inferSelect) {
  if (snapshot.editEpoch !== current.editEpoch || await baselineConflict(snapshot, current)) throw staleBase()
}

export async function createAgentSnapshot(db: Database, requirementId: string, projectId: string, userId: string, tokenId: string, ifContentToken?: string) {
  await initializeCollaboration(db, requirementId, projectId)
  return withLockedCollaboration(requirementId, async document => {
    const current = await persistLockedCollaboration(db, requirementId, document)
    const snapshot = await db.transaction(async tx => {
      await lockAssetReferences(tx)
      await requireDraftRequirement(tx, requirementId, projectId)
      const [requirement] = await tx.select().from(requirements).where(eq(requirements.id, requirementId)).for('update')
      const active = await activeAgentLock(tx, requirementId)
      if (active) {
        if (active.lock.tokenId !== tokenId) throw requirementLocked(active.view)
        // 同一凭证重试读取沿用原基线，不创建第二个编辑会话。
        return (await tx.query.agentSnapshots.findFirst({ where: eq(agentSnapshots.id, active.lock.snapshotId) }))!
      }
      const token = await tx.query.agentTokens.findFirst({ where: and(eq(agentTokens.id, tokenId), eq(agentTokens.userId, userId)) })
      if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now()) throw agentLockLost()
      const epoch = current.editEpoch + 1
      const latest = await tx.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.requirementId, requirementId), orderBy: desc(requirementRevisions.version) })
      const [saved] = await tx.insert(agentSnapshots).values({ id: `snap_${nanoid(24)}`, requirementId, userId,
        title: current.title, contentJson: current.contentJson, signature: current.signature,
        properties: await propertiesOf(tx, requirement!), baseRevisionId: latest?.id,
        schemaVersion: DOCUMENT_SCHEMA_VERSION, editEpoch: epoch, expiresAt: new Date(Date.now() + 86400_000) }).returning()
      await tx.update(requirementCollaborationDocuments).set({ editEpoch: epoch }).where(eq(requirementCollaborationDocuments.requirementId, requirementId))
      const values = { snapshotId: saved!.id, tokenId, suggestionId: null, acquiredAt: new Date(),
        expiresAt: new Date(Math.min(Date.now() + AGENT_LOCK_DURATION_MS, token.expiresAt.getTime())) }
      await tx.insert(requirementAgentLocks).values({ requirementId, ...values })
        .onConflictDoUpdate({ target: requirementAgentLocks.requirementId, set: values })
      return saved!
    })
    const active = await activeAgentLock(db, requirementId)
    if (!active) throw agentLockLost()
    publishAgentLock(requirementId, active.view, snapshot.editEpoch)
    const contentToken = `${snapshot.schemaVersion}:${snapshot.signature}`
    const notModified = contentToken === ifContentToken
    const row = await db.query.requirements.findFirst({ where: eq(requirements.id, requirementId), columns: { documentType: true } })
    return { id: snapshot.id, requirementId, documentType: row!.documentType, schemaVersion: snapshot.schemaVersion, contentToken, notModified,
      ...(!notModified ? { title: snapshot.title, contentJson: snapshot.contentJson } : {}),
      properties: snapshot.properties, baseRevisionId: snapshot.baseRevisionId,
      createdAt: snapshot.createdAt.toISOString(), expiresAt: snapshot.expiresAt.toISOString(), lock: active.view }
  })
}

async function ownedSnapshot(tx: Transaction, input: SuggestionInput, userId: string, projectId: string) {
  const snapshot = await tx.query.agentSnapshots.findFirst({ where: and(eq(agentSnapshots.id, input.snapshotId), eq(agentSnapshots.userId, userId)) })
  if (!snapshot) throw createError({ statusCode: 404, message: '读取快照不存在' })
  await requireDraftRequirement(tx, snapshot.requirementId, projectId)
  if (snapshot.expiresAt.getTime() <= Date.now()) throw createError({ statusCode: 410, message: '读取快照已过期，请重新读取需求', data: { code: 'SNAPSHOT_EXPIRED' } })
  return snapshot
}

export async function submitAgentOperation(db: Database, userId: string, projectId: string, input: SuggestionInput | CreateSuggestionInput, tokenId: string, validateOnly = false) {
  // 保留旧接管请求的幂等身份；旧审核请求不能在升级后被自动执行。
  const executionMode = 'takeover' as const
  const hashInput = 'action' in input && input.documentType === 'requirement'
    ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'documentType')) : input
  const requestHash = signature(JSON.stringify({ input: hashInput, executionMode }))
  const result = await db.transaction(async tx => {
    await lockAssetReferences(tx)
    // Same owner/request is serialized even when its first submission has not committed yet.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agent:${userId}:${input.requestId}`}, 0))`)
    if (!validateOnly) {
      const existing = await tx.query.agentSuggestions.findFirst({ where: and(eq(agentSuggestions.userId, userId), eq(agentSuggestions.requestId, input.requestId)) })
      if (existing) {
        if (existing.requestHash !== requestHash) throw createError({ statusCode: 409, message: 'requestId 已被不同内容使用', data: { code: 'IDEMPOTENCY_CONFLICT' } })
        if (existing.projectId !== projectId) throw createError({ statusCode: 404, message: '操作不存在' })
        if (existing.requirementId) await requireDraftRequirement(tx, existing.requirementId, projectId)
        return { id: existing.id, status: existing.status }
      }
    }
    if ('action' in input) {
      const properties = await resolveCreationProperties(tx, projectId, input.properties ?? {}, input.documentType)
      const contentJson = normalizeCreationContent(input.contentJson)
      const candidate = { title: input.title, contentJson }
      if (Buffer.byteLength(JSON.stringify(candidate)) > MAX_AGENT_DOCUMENT_BYTES) throw createError({ statusCode: 413, message: '候选正文不能超过 4 MiB' })
      await assertDraftImages(tx, contentJson, projectId, { userId, requestId: input.requestId })
      const propertyChanges = await describePropertyChanges(tx, {}, properties)
      if (validateOnly) return { valid: true, candidate, propertyChanges, revisionNote: input.changeNote, schemaVersion: DOCUMENT_SCHEMA_VERSION }
      const id = `suggestion_${nanoid(24)}`
      await tx.insert(agentSuggestions).values({ id, kind: 'create', documentType: input.documentType, projectId, executionMode, userId, requestId: input.requestId,
        requestHash, changeNote: input.changeNote, operations: [], properties, propertyChanges, revisionNote: input.changeNote, ...candidate })
      await writeAudit(tx, { action: 'agent.suggestion.create', projectId, actorId: userId, targetId: id, subjectUserId: userId, detail: { requirementId: null } })
      return { id, status: 'pending' as const }
    }
    const snapshot = await ownedSnapshot(tx, input, userId, projectId)
    await tx.select({ id: requirements.id }).from(requirements).where(eq(requirements.id, snapshot.requirementId)).for('update')
    const active = await activeAgentLock(tx, snapshot.requirementId)
    if (!active || active.lock.snapshotId !== snapshot.id || active.lock.tokenId !== tokenId) throw agentLockLost()
    if (active.lock.suggestionId) throw createError({ statusCode: 409, message: '当前操作尚未完成，请重试原请求或取消本次 AI 编辑', data: { code: 'OPERATION_PENDING' } })
    const current = await tx.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, snapshot.requirementId) })
    if (!current) throw staleBase()
    await assertBase(snapshot, current)
    let candidate
    try { candidate = applySuggestionOperations(snapshot, input.operations) }
    catch (error) {
      if (error instanceof SuggestionContentError) throw createError({ statusCode: 422, message: error.message, data: { code: 'INVALID_OPERATIONS', operationIndex: error.operationIndex } })
      throw error
    }
    const properties = normalizeAssignments(input.properties ?? {})
    const target = (await tx.query.requirements.findFirst({ where: eq(requirements.id, snapshot.requirementId) }))!
    await validateProperties(tx, projectId, properties, target)
    const propertyChanges = await describePropertyChanges(tx, snapshot.properties, properties)
    if (!propertyChanges.length && !input.saveRevision && await collaborationSignature(candidate) === snapshot.signature) throw createError({ statusCode: 422, message: '操作没有产生内容变更' })
    const conflict = await actionConflict(tx, { properties, revisionNote: input.saveRevision?.changeNote ?? null }, snapshot, current)
    if (conflict) throw createError({ statusCode: 409, message: '属性或正式版本已变化，请重新读取', data: { code: 'STALE_BASE' } })
    await assertDraftImages(tx, candidate.contentJson, projectId)
    if (validateOnly) return { valid: true, candidate, propertyChanges, revisionNote: input.saveRevision?.changeNote ?? null, schemaVersion: DOCUMENT_SCHEMA_VERSION }
    const id = `suggestion_${nanoid(24)}`
    await tx.insert(agentSuggestions).values({ id, snapshotId: snapshot.id, requirementId: snapshot.requirementId,
      projectId, executionMode, properties, propertyChanges, revisionNote: input.saveRevision?.changeNote,
      userId, requestId: input.requestId, requestHash, changeNote: input.changeNote, operations: input.operations,
      completedAnnotations: input.completedAnnotations, ...candidate })
    await tx.update(requirementAgentLocks).set({ suggestionId: id,
      expiresAt: new Date(Math.min(Date.now() + AGENT_LOCK_DURATION_MS, active.token.expiresAt.getTime(), snapshot.expiresAt.getTime())) })
      .where(eq(requirementAgentLocks.requirementId, snapshot.requirementId))
    await writeAudit(tx, { action: 'agent.suggestion.create', projectId, actorId: userId, targetId: id, subjectUserId: userId, detail: { requirementId: snapshot.requirementId } })
    return { id, status: 'pending' as const }
  })
  if ('id' in result && result.id) {
    const suggestion = (await db.query.agentSuggestions.findFirst({ where: eq(agentSuggestions.id, result.id) }))!
    if (suggestion.requirementId) {
      const requirementId = suggestion.requirementId
      await exclusiveDocument(requirementId, async () => {
        const current = (await db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, requirementId) }))!
        publishAgentLock(requirementId, (await activeAgentLock(db, requirementId))?.view ?? null, current.editEpoch)
      })
    }
    if (suggestion.status === 'pending') {
      const user = (await db.query.users.findFirst({ where: eq(users.id, userId) }))!
      await applyAgentOperation(db, projectId, user, suggestion.id)
    }
    return getAgentOperation(db, projectId, suggestion.id, userId)
  }
  return result
}

/** 执行收据仅供原发起人恢复响应丢失，不提供网页审核或候选比较。 */
export async function getAgentOperation(db: Database, projectId: string, id: string, ownerId: string) {
  const operation = await db.query.agentSuggestions.findFirst({ where: and(eq(agentSuggestions.id, id), eq(agentSuggestions.projectId, projectId), eq(agentSuggestions.userId, ownerId)) })
  if (!operation) throw createError({ statusCode: 404, message: '操作不存在' })
  if (operation.requirementId) await requireDraftRequirement(db, operation.requirementId, projectId)
  const revision = operation.savedRevisionId ? await db.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.id, operation.savedRevisionId),
    columns: { id: true, version: true, changeNote: true } }) : null
  return { id: operation.id, status: operation.status, requirementId: operation.requirementId,
    document: operation.status === 'applied' ? { id: operation.requirementId, schemaVersion: DOCUMENT_SCHEMA_VERSION,
      title: operation.title, contentJson: operation.contentJson, contentToken: await agentContentToken(operation) } : null,
    documentUrl: operation.requirementId ? '/requirements/' + operation.requirementId : null, revision: revision ?? null,
    completedAnnotations: liveAnnotationCompletions(operation) }
}

async function applyCreation(db: Database, projectId: string, actor: { id: string; name: string }, id: string) {
  return db.transaction(async tx => {
    await lockAssetReferences(tx)
    const [operation] = await tx.select().from(agentSuggestions).where(and(eq(agentSuggestions.id, id), eq(agentSuggestions.projectId, projectId), eq(agentSuggestions.userId, actor.id))).for('update')
    if (!operation || operation.kind !== 'create') throw createError({ statusCode: 404, message: '操作不存在' })
    if (operation.status === 'applied') return
    if (operation.status !== 'pending' || operation.executionMode !== 'takeover') throw createError({ statusCode: 409, message: '操作已取消或来自已停用的审核流程' })
    const created = await createRequirement(tx, projectId, actor.id,
      { title: operation.title, documentType: operation.documentType, contentJson: operation.contentJson, properties: operation.properties, changeNote: operation.revisionNote!, agentRequestId: operation.requestId })
    await tx.update(agentSuggestions).set({ status: 'applied', reviewerId: actor.id, reviewedAt: new Date(),
      requirementId: created.requirementId, savedRevisionId: created.revisionId }).where(eq(agentSuggestions.id, id))
    await writeAudit(tx, { action: 'agent.suggestion.apply', projectId, actorId: actor.id, subjectUserId: operation.userId, targetId: id,
      detail: { requirementId: created.requirementId, editId: null, source: 'agent_takeover' } })
  })
}

async function applyAgentOperation(db: Database, projectId: string, reviewer: { id: string; name: string }, id: string) {
  const detail = await db.query.agentSuggestions.findFirst({ where: and(eq(agentSuggestions.id, id), eq(agentSuggestions.projectId, projectId), eq(agentSuggestions.userId, reviewer.id)) })
  if (!detail) throw createError({ statusCode: 404, message: '操作不存在' })
  if (detail.executionMode !== 'takeover') throw createError({ statusCode: 409, message: '审核流程已停用，请重新发起文档操作' })
  if (detail.kind === 'create') return applyCreation(db, projectId, reviewer, id)
  const source = 'agent_takeover' as const
  const requirementId = detail.requirementId!
  return withLockedCollaboration(requirementId, async document => {
    await persistLockedCollaboration(db, requirementId, document)
    const result = await db.transaction(async tx => {
      await lockAssetReferences(tx)
      await requireDraftRequirement(tx, requirementId, projectId)
      const [requirement] = await tx.select().from(requirements).where(eq(requirements.id, requirementId)).for('update')
      const [current] = await tx.select().from(requirementCollaborationDocuments).where(eq(requirementCollaborationDocuments.requirementId, requirementId)).for('update')
      const [suggestion] = await tx.select().from(agentSuggestions).where(eq(agentSuggestions.id, id)).for('update')
      if (!suggestion || !current) throw createError({ statusCode: 404, message: '修改操作不存在' })
      if (suggestion.status === 'applied') return { status: 'applied', record: null, savedRevisionId: null }
      if (suggestion.status !== 'pending') throw createError({ statusCode: 409, message: '操作已取消，不能再次执行' })
      const active = await activeAgentLock(tx, requirementId)
      if (active && active.lock.snapshotId !== suggestion.snapshotId) throw requirementLocked(active.view)
      const snapshot = (await tx.query.agentSnapshots.findFirst({ where: eq(agentSnapshots.id, suggestion.snapshotId!) }))!
      if (await actionConflict(tx, suggestion, snapshot, current)) throw staleBase()
      if (await collaborationSignature(readCollaborationDocument(document)) !== snapshot.signature) throw staleBase()
      await updateRequirementProperties(tx, requirement!, suggestion.properties, reviewer.id, source, suggestion.id, suggestion.userId)
      const candidate = new Y.Doc()
      try {
        Y.applyUpdate(candidate, current.state)
        applyCandidateToYDocument(candidate, suggestion)
        const after = readCollaborationDocument(candidate)
        await updateRequirementTitle(tx, requirement!, after.title, reviewer.id, source, suggestion.id)
        await assertDraftImages(tx, after.contentJson, projectId)
        const changed = changedAttributionNodes(current, after)
        const attribution = addNodeContributors(await currentNodeContributions(tx, current), changed, { userId: reviewer.id, name: reviewer.name })
        const sequence = current.attributionSequence + 1
        const editId = `edit_${nanoid(24)}`
        const state = Y.encodeStateAsUpdate(candidate)
        await tx.insert(requirementEditEvents).values({ id: editId, requirementId, sequence, authorId: reviewer.id,
          authorName: reviewer.name, intent: 'edit', updateHash: createHash('sha256').update(state).digest('hex'), blockIds: changed.map(node => node.id), changes: [] })
        const [record] = await tx.update(requirementCollaborationDocuments).set({ ...after, state, attribution, attributionSequence: sequence,
          editEpoch: current.editEpoch + 1, updatedAt: new Date() }).where(eq(requirementCollaborationDocuments.requirementId, requirementId)).returning()
        let savedRevisionId: string | null = null
        if (suggestion.revisionNote !== null) {
          const latest = await tx.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.requirementId, requirementId), orderBy: desc(requirementRevisions.version) })
          savedRevisionId = `rev_${nanoid(12)}`
          const version = (latest?.version ?? 0) + 1
          await tx.insert(requirementRevisions).values({ id: savedRevisionId, requirementId, version, ...after,
            contentText: extractPlainText(after.contentJson), changeNote: suggestion.revisionNote, authorId: reviewer.id, attribution, attributionSequence: sequence })
          record!.attribution = emptyAttribution({ id: savedRevisionId, version })
          await tx.update(requirementCollaborationDocuments).set({ attribution: record!.attribution }).where(eq(requirementCollaborationDocuments.requirementId, requirementId))
          await tx.update(requirements).set({ updatedAt: new Date() }).where(eq(requirements.id, requirementId))
        }
        await tx.update(agentSuggestions).set({ status: 'applied', reviewerId: reviewer.id, reviewedAt: new Date(), appliedEditId: editId, savedRevisionId }).where(eq(agentSuggestions.id, id))
        await tx.delete(requirementAgentLocks).where(and(eq(requirementAgentLocks.requirementId, requirementId), eq(requirementAgentLocks.snapshotId, suggestion.snapshotId!)))
        await writeAudit(tx, { action: 'agent.suggestion.apply', projectId, actorId: reviewer.id, subjectUserId: suggestion.userId, targetId: id,
          detail: { requirementId, editId, source } })
        return { status: 'applied', record: record!, savedRevisionId }
      } finally { candidate.destroy() }
    })
    if (result.record) publishAgentState(requirementId, document, result.record)
    if (result.record) broadcastRequirementProperties(requirementId)
    if (result.savedRevisionId) await broadcastSavedRevision(requirementId, result.savedRevisionId)
    const current = result.record ?? (await db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, requirementId) }))!
    publishAgentLock(requirementId, (await activeAgentLock(db, requirementId))?.view ?? null, current.editEpoch)
    return { id, status: result.status }
  })
}

export async function changeAgentLock(db: Database, requirementId: string, projectId: string,
  actor: { userId: string; tokenId?: string; admin?: boolean }, snapshotId: string, action: 'renew' | 'release') {
  await requireDraftRequirement(db, requirementId, projectId)
  return withLockedCollaboration(requirementId, async () => {
    await db.transaction(async tx => {
      await tx.select({ id: requirements.id }).from(requirements).where(eq(requirements.id, requirementId)).for('update')
      const active = await activeAgentLock(tx, requirementId)
      if (!active || active.lock.snapshotId !== snapshotId) throw agentLockLost()
      if (actor.tokenId ? active.lock.tokenId !== actor.tokenId : (!actor.admin && active.user.id !== actor.userId)) {
        throw createError({ statusCode: 403, message: '只有发起人或管理员可以取消这次 AI 编辑' })
      }
      if (action === 'release') {
        // 主动取消终止尚未执行的请求；重试不能再次执行已取消的操作。
        if (active.lock.suggestionId) {
          const [rejected] = await tx.update(agentSuggestions).set({ status: 'rejected', reviewerId: actor.userId, reviewedAt: new Date() })
            .where(and(eq(agentSuggestions.id, active.lock.suggestionId), eq(agentSuggestions.status, 'pending'))).returning()
          if (rejected) await writeAudit(tx, { action: 'agent.suggestion.reject', projectId, actorId: actor.userId,
            subjectUserId: rejected.userId, targetId: rejected.id, detail: { requirementId } })
        }
        await tx.delete(requirementAgentLocks).where(eq(requirementAgentLocks.requirementId, requirementId))
      } else {
        const snapshot = (await tx.query.agentSnapshots.findFirst({ where: eq(agentSnapshots.id, snapshotId) }))!
        if (snapshot.expiresAt.getTime() <= Date.now()) throw agentLockLost()
        await tx.update(requirementAgentLocks).set({ expiresAt: new Date(Math.min(Date.now() + AGENT_LOCK_DURATION_MS,
          active.token.expiresAt.getTime(), snapshot.expiresAt.getTime())) }).where(eq(requirementAgentLocks.requirementId, requirementId))
      }
    })
    const lock = (await activeAgentLock(db, requirementId))?.view ?? null
    const record = (await db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, requirementId) }))!
    publishAgentLock(requirementId, lock, record.editEpoch)
    return { lock, editEpoch: record.editEpoch }
  })
}
