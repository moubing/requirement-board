import { Hocuspocus } from '@hocuspocus/server'
import { desc, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import * as Y from 'yjs'
import { collaborationSnapshotSchema, collaborationSignature, createCollaborationDocument, ensureCollaborationTrailingParagraph, readCollaborationDocument, updateCollaborativeTitle, type CollaborationSnapshot } from '../../shared/collaboration/document'
import { useDatabase, type Database } from '../db/client'
import { assets, requirementCollaborationDocuments, requirementEditEvents, requirementRevisions, requirements } from '../db/schema'
import { addNodeContributors, changedAttributionNodes, type CollaborationEdit } from '../../shared/collaboration/attribution'
import { currentNodeContributions } from './node-contributions'
import { requireAccountContextFromHeaders, requireProjectContext } from '../utils/request-context'
import { resolveAuthRuntimeConfig } from '../utils/auth-config'
import { DEFAULT_PROJECT_ID } from '../utils/current-user'
import { lockAssetReferences } from './asset-references'
import { collectReferencedAssetUrls } from './asset-gc'
import { assertDraftImages, requireDraftRequirement } from './requirement-drafts'
import { activeAgentLock, assertRequirementUnlocked, requirementLocked } from './agent-locks'
import type { AgentLockDto } from '../../shared/agent/lock'
import { DOCUMENT_SCHEMA_VERSION } from '../../shared/agent/suggestions'
import { cloneRichTextDocument, ensureBlockIds } from '../../shared/editor/document'
import { DOCUMENT_NODE_CAPABILITIES } from '../../shared/editor/capabilities'

export function requireDocumentSchema(version: unknown, capabilities: readonly string[] = []) {
  if (version !== DOCUMENT_SCHEMA_VERSION || !DOCUMENT_NODE_CAPABILITIES.every(capability => capabilities.includes(capability))) {
    throw createError({ statusCode: 409, message: '正文格式已升级，请保留未同步输入后刷新页面或更新 Skill', data: { code: 'DOCUMENT_SCHEMA_CHANGED' } })
  }
}

const maxUpdateBytes = 16 * 1024 * 1024
let instance: Hocuspocus<Identity> | undefined
interface Identity { userId: string; projectId: string; name: string; color: string; headers: Headers; checkedAt: number }
const documentWrites = new Map<string, Promise<void>>()
const activeWrites = new Set<string>()
const documentEpochs = new Map<string, number>()
const documentLocks = new Map<string, AgentLockDto | null>()
const updateHash = (update: Uint8Array) => createHash('sha256').update(update).digest('hex')

export function exclusiveDocument<T>(id: string, work: () => Promise<T>): Promise<T> {
  const result = (documentWrites.get(id) ?? Promise.resolve()).then(async () => {
    activeWrites.add(id)
    try { return await work() } finally { activeWrites.delete(id) }
  })
  const settled = result.then(() => {}, () => {})
  documentWrites.set(id, settled)
  void settled.then(() => { if (documentWrites.get(id) === settled) documentWrites.delete(id) })
  return result
}

function requirementIdFromRoom(name: string) {
  if (!/^req_[a-zA-Z0-9_-]{1,100}$/.test(name)) throw createError({ statusCode: 404, message: '协作文档不存在' })
  return name
}

async function authorize(headers: Headers, requirementId: string): Promise<Identity> {
  const context = await requireProjectContext(await requireAccountContextFromHeaders(headers))
  await requireDraftRequirement(context.db, requirementId, context.projectId)
  return { userId: context.currentUserId, projectId: context.projectId, name: context.currentUser.name,
    color: /^#[\da-f]{6}$/i.test(context.currentUser.avatarColor) ? context.currentUser.avatarColor : '#2b6ef3', headers, checkedAt: Date.now() }
}

export async function initializeCollaboration(db: Database, requirementId: string, projectId: string, initial?: CollaborationSnapshot) {
  return db.transaction(async tx => {
    await lockAssetReferences(tx)
    await requireDraftRequirement(tx, requirementId, projectId)
    const [requirement] = await tx.select().from(requirements).where(eq(requirements.id, requirementId)).for('update')
    const [existing] = await tx.select().from(requirementCollaborationDocuments).where(eq(requirementCollaborationDocuments.requirementId, requirementId))
    if (existing) {
      if (existing.schemaVersion !== DOCUMENT_SCHEMA_VERSION) throw createError({ statusCode: 503, message: '共同草稿需要升级，请停服执行数据库迁移', data: { code: 'DOCUMENT_SCHEMA_MIGRATION_REQUIRED' } })
      return { record: existing, initialized: false }
    }
    const latest = await tx.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.requirementId, requirementId), orderBy: desc(requirementRevisions.version) })
    if (!latest) throw createError({ statusCode: 404, message: '需求版本不存在' })
    const snapshot = collaborationSnapshotSchema.parse({ title: requirement!.title, contentJson: ensureBlockIds(cloneRichTextDocument(initial?.contentJson ?? latest.contentJson)) })
    await assertDraftImages(tx, snapshot.contentJson, projectId)
    const doc = createCollaborationDocument(snapshot)
    try {
      ensureCollaborationTrailingParagraph(doc)
      const [record] = await tx.insert(requirementCollaborationDocuments).values({ requirementId,
        ...readCollaborationDocument(doc), state: Y.encodeStateAsUpdate(doc) }).returning()
      return { record: record!, initialized: true }
    } finally { doc.destroy() }
  })
}

export function validateCollaborationUpdate(document: Y.Doc, update: Uint8Array) {
  if (update.byteLength > maxUpdateBytes) throw createError({ statusCode: 413, message: '协作文档过大' })
  const candidate = new Y.Doc()
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document))
    Y.applyUpdate(candidate, update)
    const snapshot = readCollaborationDocument(candidate)
    if ([...candidate.share.keys()].some(key => key !== 'title' && key !== 'default') || !collaborationSnapshotSchema.safeParse(snapshot).success || JSON.stringify(snapshot).length > 4 * 1024 * 1024) {
      throw new Error('invalid document')
    }
  } catch { throw createError({ statusCode: 400, message: '协作内容格式无效，请检查正文或标题长度' }) }
  finally { candidate.destroy() }
}

export async function persistCollaboration(db: Database, requirementId: string, document: Y.Doc) {
  return exclusiveDocument(requirementId, () => persistLockedCollaboration(db, requirementId, document))
}

/** Caller must hold exclusiveDocument; capture only after acquiring the gate. */
export async function persistLockedCollaboration(db: Database, requirementId: string, document: Y.Doc) {
  // 捕获同一时刻的状态；事务内合并上次落盘状态，避免延迟写入丢失更新。
  const state = Y.encodeStateAsUpdate(document)
  const saved = await db.transaction(async tx => {
    await lockAssetReferences(tx)
    const [requirement] = await tx.select({ title: requirements.title }).from(requirements).where(eq(requirements.id, requirementId)).for('update')
    const [previous] = await tx.select().from(requirementCollaborationDocuments)
      .where(eq(requirementCollaborationDocuments.requirementId, requirementId)).for('update')
    if (!previous) throw createError({ statusCode: 404, message: '协作文档不存在' })
    const merged = new Y.Doc()
    try {
      Y.applyUpdate(merged, previous.state)
      const before = readCollaborationDocument(merged)
      let attribution = await currentNodeContributions(tx, previous)
      if (previous.editEpoch > 0) assertConfirmedUpdate(merged, state)
      Y.applyUpdate(merged, state)
      // 旧客户端仍可能携带 Y.Text 标题；元数据是当前标题的唯一来源。
      updateCollaborativeTitle(merged.getText('title'), requirement!.title)
      const changes = changedAttributionNodes(before, readCollaborationDocument(merged))
      let sequence = previous.attributionSequence
      if (changes.length) {
        sequence++
        attribution = addNodeContributors(attribution, changes, null)
        await tx.insert(requirementEditEvents).values({ id: `edit_${nanoid(24)}`, requirementId, sequence,
          authorName: '来源未知', intent: 'legacy', updateHash: updateHash(state),
          blockIds: changes.map(node => node.id), changes: [] })
      }
      ensureCollaborationTrailingParagraph(merged)
      const snapshot = collaborationSnapshotSchema.parse(readCollaborationDocument(merged))
      await assertDraftImages(tx, snapshot.contentJson, DEFAULT_PROJECT_ID)
      const kept = collectReferencedAssetUrls([snapshot.contentJson])
      const released = [...collectReferencedAssetUrls([previous.contentJson])].filter(url => !kept.has(url))
      if (released.length) await tx.update(assets).set({ unreferencedAt: new Date() }).where(inArray(assets.url, released))
      const [record] = await tx.update(requirementCollaborationDocuments).set({ ...snapshot,
        attribution, attributionSequence: sequence,
        state: Y.encodeStateAsUpdate(merged), updatedAt: new Date() })
        .where(eq(requirementCollaborationDocuments.requirementId, requirementId)).returning()
      return record!
    } finally { merged.destroy() }
  })
  Y.applyUpdate(document, saved.state)
  return { ...saved, signature: await collaborationSignature(saved) }
}

/** 只有原始本地增量通过这个入口才认领作者。合并同步状态一律不认领。 */
export async function acceptCollaborationEdits(db: Database, requirementId: string, projectId: string,
  user: { id: string; name: string }, edits: CollaborationEdit[], stateVector?: string, editEpoch = 0, schemaVersion = DOCUMENT_SCHEMA_VERSION,
  schemaCapabilities: readonly string[] = []) {
  let disconnect: (() => Promise<void>) | undefined
  try {
    return await exclusiveDocument(requirementId, async () => {
      const connection = await useCollaborationServer().openDirectConnection(requirementId)
      let live!: Y.Doc
      try {
        await connection.transact(doc => { live = doc })
        const saved = await db.transaction(async tx => {
          await lockAssetReferences(tx)
          await requireDraftRequirement(tx, requirementId, projectId)
          const [requirement] = await tx.select({ title: requirements.title }).from(requirements).where(eq(requirements.id, requirementId)).for('update')
          const [previous] = await tx.select().from(requirementCollaborationDocuments)
            .where(eq(requirementCollaborationDocuments.requirementId, requirementId)).for('update')
          if (!previous) throw createError({ statusCode: 404, message: '协作文档不存在' })
          const agentLock = await activeAgentLock(tx, requirementId)
          const candidate = new Y.Doc()
          try {
            Y.applyUpdate(candidate, previous.state)
            const initial = readCollaborationDocument(candidate)
            let attribution = await currentNodeContributions(tx, previous)
            if (previous.editEpoch > 0) assertConfirmedUpdate(candidate, Y.encodeStateAsUpdate(live))
            Y.applyUpdate(candidate, Y.encodeStateAsUpdate(live))
            updateCollaborativeTitle(candidate.getText('title'), requirement!.title)
            const inherited = changedAttributionNodes(initial, readCollaborationDocument(candidate))
            attribution = addNodeContributors(attribution, inherited, null)
            let sequence = previous.attributionSequence
            const records: (typeof requirementEditEvents.$inferInsert)[] = []
            if (inherited.length) records.push({ id: `edit_${nanoid(24)}`, requirementId, sequence: ++sequence,
              authorId: null, authorName: '来源未知', intent: 'legacy', updateHash: updateHash(Y.encodeStateAsUpdate(candidate)),
              blockIds: inherited.map(node => node.id), changes: [] })
            let byteLength = 0
            for (const edit of edits) {
              const update = new Uint8Array(Buffer.from(edit.update, 'base64'))
              byteLength += update.byteLength
              if (byteLength > maxUpdateBytes) throw createError({ statusCode: 413, message: '本次编辑过大' })
              const hash = updateHash(update)
              const existing = await tx.query.requirementEditEvents.findFirst({ where: eq(requirementEditEvents.id, edit.id) })
                ?? records.find(record => record.id === edit.id)
              if (existing) {
                if (existing.requirementId !== requirementId || existing.authorId !== user.id || existing.updateHash !== hash || existing.intent !== edit.intent) {
                  throw createError({ statusCode: 409, message: '编辑事件标识已被其他内容使用' })
                }
                continue
              }
              if (agentLock) throw requirementLocked(agentLock.view)
              requireDocumentSchema(schemaVersion, schemaCapabilities)
              if (editEpoch !== previous.editEpoch) throw staleEditEpoch()
              const before = readCollaborationDocument(candidate)
              try {
                if (edit.intent !== 'legacy' && Y.decodeUpdate(update).structs.some(item => item.id.client !== edit.clientId)) {
                  throw new Error('mixed authors')
                }
                Y.applyUpdate(candidate, update)
              } catch { throw createError({ statusCode: 400, message: '编辑增量无效，不能将合并状态认领为个人修改' }) }
              // 缺少依赖的更新不能先确认，否则之后由其他人补齐时会认错作者。
              if (candidate.store.pendingStructs || candidate.store.pendingDs) {
                throw createError({ statusCode: 409, message: '编辑缺少前序更新，请按原顺序重试' })
              }
              const at = new Date()
              let after: CollaborationSnapshot
              try {
                updateCollaborativeTitle(candidate.getText('title'), requirement!.title)
                after = readCollaborationDocument(candidate)
              }
              catch { throw createError({ statusCode: 400, message: '协作内容包含无效节点' }) }
              const changed = changedAttributionNodes(before, after)
              attribution = addNodeContributors(attribution, changed, edit.intent === 'legacy' ? null : { userId: user.id, name: user.name })
              records.push({ id: edit.id, requirementId, sequence: ++sequence, authorId: user.id,
                authorName: edit.intent === 'legacy' ? '来源未知' : user.name, intent: edit.intent, updateHash: hash,
                blockIds: changed.map(node => node.id), changes: [], createdAt: at })
            }
            // BlockId 的修复事务可能紧跟新增节点，整批结束后才执行 schema 校验。
            validateCollaborationUpdate(candidate, new Uint8Array([0, 0]))
            ensureCollaborationTrailingParagraph(candidate)
            const snapshot = collaborationSnapshotSchema.parse(readCollaborationDocument(candidate))
            await assertDraftImages(tx, snapshot.contentJson, projectId)
            if (records.length) await tx.insert(requirementEditEvents).values(records)
            const kept = collectReferencedAssetUrls([snapshot.contentJson])
            const released = [...collectReferencedAssetUrls([previous.contentJson])].filter(url => !kept.has(url))
            if (released.length) await tx.update(assets).set({ unreferencedAt: new Date() }).where(inArray(assets.url, released))
            const state = Y.encodeStateAsUpdate(candidate)
            const [record] = await tx.update(requirementCollaborationDocuments).set({ ...snapshot, state,
              attribution, attributionSequence: sequence, updatedAt: records.length ? new Date() : previous.updatedAt })
              .where(eq(requirementCollaborationDocuments.requirementId, requirementId)).returning()
            let update: Uint8Array
            try { update = Y.encodeStateAsUpdate(candidate, stateVector ? Buffer.from(stateVector, 'base64') : undefined) }
            catch { throw createError({ statusCode: 400, message: '同步状态向量无效' }) }
            return { record: record!, update }
          } finally { candidate.destroy() }
        })
        // 数据库提交后才广播，接收副本因此不会携带尚未持久化的他人修改。
        await connection.transact(doc => Y.applyUpdate(doc, saved.record.state))
        const signature = await collaborationSignature(saved.record)
        const metadata = { type: 'attribution', sequence: saved.record.attributionSequence, snapshot: saved.record.attribution }
        instance?.documents.get(requirementId)?.broadcastStateless(JSON.stringify(metadata))
        instance?.documents.get(requirementId)?.broadcastStateless(JSON.stringify({ type: 'saved', signature, sequence: saved.record.attributionSequence, updatedAt: saved.record.updatedAt.toISOString() }))
        return { accepted: edits.map(edit => edit.id), update: Buffer.from(saved.update).toString('base64'),
          editEpoch: saved.record.editEpoch,
          sequence: saved.record.attributionSequence, snapshot: saved.record.attribution!, signature, updatedAt: saved.record.updatedAt.toISOString() }
      } finally { disconnect = () => connection.disconnect({ unloadImmediately: false }) }
    })
  } finally {
    // 即使延迟卸载，达到 maxDebounce 时 disconnect 也会同步执行存储钩子。
    // 存储钩子需要同一文档锁，必须在原始编辑释放锁后再等待它，避免确认请求悬挂。
    await disconnect?.()
  }
}

export function useCollaborationServer() {
  if (instance) return instance
  instance = new Hocuspocus<Identity>({
    name: 'requirement-board', debounce: 1000, maxDebounce: 5000, quiet: true,
    async onAuthenticate({ documentName, requestHeaders, requestParameters }) {
      requireDocumentSchema(Number(requestParameters.get('schemaVersion')), requestParameters.get('schemaCapabilities')?.split(',') ?? [])
      const origin = requestHeaders.get('origin')
      if (!origin || !resolveAuthRuntimeConfig().trustedOrigins.includes(origin)) throw new Error('连接来源无效')
      return authorize(requestHeaders, requirementIdFromRoom(documentName))
    },
    async onLoadDocument({ documentName }) {
      const { record } = await initializeCollaboration(useDatabase(), requirementIdFromRoom(documentName), DEFAULT_PROJECT_ID)
      const doc = new Y.Doc()
      Y.applyUpdate(doc, record.state)
      documentEpochs.set(documentName, record.editEpoch)
      documentLocks.set(documentName, (await activeAgentLock(useDatabase(), documentName))?.view ?? null)
      return doc
    },
    async beforeHandleMessage({ context, documentName }) {
      if (Date.now() - context.checkedAt > 5000) Object.assign(context, await authorize(context.headers, documentName))
    },
    async beforeHandleAwareness({ states, context }) {
      if (!context) return
      for (const state of states.values()) state.user = { id: context.userId, name: context.name, color: context.color }
    },
    async beforeSync({ document, documentName, connection, type, payload }) {
      const editEpoch = documentEpochs.get(documentName)
      if (editEpoch === undefined) throw new Error('协作文档尚未就绪')
      connection.sendStateless(JSON.stringify({ type: 'epoch', editEpoch }))
      const lock = documentLocks.get(documentName)
      connection.sendStateless(JSON.stringify({ type: 'agent-lock', editEpoch,
        lock: lock && Date.parse(lock.expiresAt) > Date.now() ? lock : null }))
      if (type === 1 || type === 2) {
        if (editEpoch > 0 || activeWrites.has(documentName)) assertConfirmedUpdate(document, payload)
        validateCollaborationUpdate(document, payload)
      }
    },
    async onStoreDocument({ documentName, document }) {
      const record = await persistCollaboration(useDatabase(), documentName, document)
      document.broadcastStateless(JSON.stringify({ type: 'attribution', snapshot: record.attribution, sequence: record.attributionSequence }))
      document.broadcastStateless(JSON.stringify({ type: 'saved', signature: record.signature, sequence: record.attributionSequence, updatedAt: record.updatedAt.toISOString() }))
    },
  })
  return instance
}

export function staleEditEpoch() {
  return createError({ statusCode: 409, message: '共同文档已进入新的编辑阶段，请保留本机修改并重新读取文档', data: { code: 'EDIT_EPOCH_CHANGED' } })
}

export function assertConfirmedUpdate(document: Y.Doc, update: Uint8Array) {
  const candidate = new Y.Doc()
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document))
    const before = Y.snapshot(candidate)
    Y.applyUpdate(candidate, update)
    if (candidate.store.pendingStructs || candidate.store.pendingDs || !Y.equalSnapshots(before, Y.snapshot(candidate))) throw staleEditEpoch()
  } finally { candidate.destroy() }
}

/** Also used for immutable snapshots and atomic suggestion application. */
export async function withLockedCollaboration<T>(requirementId: string, work: (document: Y.Doc) => Promise<T>) {
  let disconnect: (() => Promise<void>) | undefined
  try {
    return await exclusiveDocument(requirementId, async () => {
      const connection = await useCollaborationServer().openDirectConnection(requirementId)
      disconnect = () => connection.disconnect()
      let current!: Y.Doc
      await connection.transact(document => { current = document })
      return await work(current)
    })
  } finally {
    // The immediate store hook acquires the same gate, so disconnect only after releasing it.
    await disconnect?.()
  }
}

export async function withCollaborativeDocument<T>(requirementId: string, update: Uint8Array, save: (document: Y.Doc) => Promise<T>, editEpoch = 0) {
  return withLockedCollaboration(requirementId, async document => {
    const record = await useDatabase().query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, requirementId) })
    if (!record || record.editEpoch !== editEpoch) throw staleEditEpoch()
    await assertRequirementUnlocked(useDatabase(), requirementId)
    if (record.editEpoch > 0) assertConfirmedUpdate(document, update)
    validateCollaborationUpdate(document, update)
    Y.applyUpdate(document, update)
    await persistLockedCollaboration(useDatabase(), requirementId, document)
    return save(document)
  })
}

/** Commit in the database first. Notify clients before merging the new epoch into their provider. */
export function publishAgentState(requirementId: string, document: Y.Doc, record: typeof requirementCollaborationDocuments.$inferSelect) {
  documentEpochs.set(requirementId, record.editEpoch)
  instance?.documents.get(requirementId)?.broadcastStateless(JSON.stringify({ type: 'epoch', editEpoch: record.editEpoch }))
  Y.applyUpdate(document, record.state)
  instance?.documents.get(requirementId)?.broadcastStateless(JSON.stringify({ type: 'attribution', sequence: record.attributionSequence, snapshot: record.attribution }))
}

export function publishAgentLock(requirementId: string, lock: AgentLockDto | null, editEpoch: number) {
  if ((documentEpochs.get(requirementId) ?? 0) > editEpoch) return
  const changed = documentEpochs.get(requirementId) !== editEpoch || JSON.stringify(documentLocks.get(requirementId)) !== JSON.stringify(lock)
  documentEpochs.set(requirementId, editEpoch)
  documentLocks.set(requirementId, lock)
  if (changed) instance?.documents.get(requirementId)?.broadcastStateless(JSON.stringify({ type: 'agent-lock', editEpoch, lock }))
}

export async function broadcastSavedRevision(requirementId: string, revisionId: string, mutationId?: string) {
  const record = await useDatabase().query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, requirementId) })
  if (record) instance?.documents.get(requirementId)?.broadcastStateless(JSON.stringify({ type: 'attribution',
    sequence: record.attributionSequence, snapshot: await currentNodeContributions(useDatabase(), record) }))
  instance?.documents.get(requirementId)?.broadcastStateless(JSON.stringify({ type: 'revision', revisionId, mutationId }))
}

export function broadcastRequirementProperties(requirementId: string, mutationId?: string) {
  instance?.documents.get(requirementId)?.broadcastStateless(JSON.stringify({ type: 'properties', mutationId }))
}

export async function closeCollaborationServer() {
  const current = instance
  if (!current) return
  current.closeConnections()
  await Promise.all([...current.documents].map(([id, doc]) => persistCollaboration(useDatabase(), id, doc)))
  current.flushPendingStores()
  instance = undefined
}
