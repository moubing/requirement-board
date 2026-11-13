import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  pgEnum,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

import type { RichTextDocument } from '../../shared/editor/document'
import { PROJECT_ROLES } from '../../shared/auth/access'
import type { DraftImageUpload } from '../../shared/drafts/document'
import type { StoredAttributionSnapshot } from '../../shared/collaboration/attribution'
import type { SuggestionOperation, SuggestionStatus } from '../../shared/agent/suggestions'
import type { RequirementPropertyPatch, PropertyChange } from '../../shared/requirements/properties'
import type { MilestoneKind, MilestoneEvidence, MilestoneObservation } from '../../shared/statistics/milestones'
import type { PropertySource } from '../../shared/requirements/properties'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  email: varchar('email', { length: 160 }).notNull().unique(),
  username: varchar('username', { length: 30 }).unique(),
  displayUsername: varchar('display_username', { length: 80 }),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  avatarColor: varchar('avatar_color', { length: 24 }).notNull().default('#2b6ef3'),
  role: varchar('role', { length: 32 }).notNull().default('user'),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
})

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    impersonatedBy: text('impersonated_by'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    userIdx: index('auth_sessions_user_idx').on(table.userId),
  }),
)

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdx: index('auth_accounts_user_idx').on(table.userId),
    issuerAccountUnique: uniqueIndex('auth_accounts_issuer_account_unique').on(
      table.issuer,
      table.accountId,
    ),
  }),
)

export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    identifierIdx: index('auth_verifications_identifier_idx').on(table.identifier),
  }),
)

export const authRateLimits = pgTable('auth_rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  code: varchar('code', { length: 16 }).notNull().unique(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.userId] }),
    userIdx: index('project_members_user_idx').on(table.userId),
  }),
)

export const projectRole = pgEnum('project_role', PROJECT_ROLES)
export const accessRequestStatus = pgEnum('access_request_status', ['pending', 'approved', 'rejected'])
export const invitationStatus = pgEnum('invitation_status', ['pending', 'accepted', 'revoked'])

export const projectMemberRoles = pgTable('project_member_roles', {
  projectId: text('project_id').notNull(),
  userId: text('user_id').notNull(),
  role: projectRole('role').notNull(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.userId, table.role] }),
  foreignKey({
    columns: [table.projectId, table.userId],
    foreignColumns: [projectMembers.projectId, projectMembers.userId],
  }).onDelete('cascade'),
])

export const projectAccessRequests = pgTable('project_access_requests', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: accessRequestStatus('status').notNull().default('pending'),
  message: varchar('message', { length: 1000 }).notNull().default(''),
  reviewNote: varchar('review_note', { length: 1000 }).notNull().default(''),
  reviewedById: text('reviewed_by_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('project_access_requests_member_unique').on(table.projectId, table.userId),
  index('project_access_requests_status_idx').on(table.projectId, table.status, table.createdAt),
])

export const projectInvitations = pgTable('project_invitations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  email: varchar('email', { length: 160 }).notNull(),
  roles: projectRole('roles').array().notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  status: invitationStatus('status').notNull().default('pending'),
  invitedById: text('invited_by_id').notNull().references(() => users.id),
  acceptedById: text('accepted_by_id').references(() => users.id),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('project_invitations_pending_email_unique')
    .on(table.projectId, table.email).where(sql`${table.status} = 'pending'`),
  check('project_invitations_valid_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
])

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  actorId: text('actor_id').notNull().references(() => users.id),
  subjectUserId: text('subject_user_id').references(() => users.id),
  action: text('action').notNull(),
  targetId: text('target_id').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('audit_events_subject_idx').on(table.subjectUserId, table.createdAt),
  index('audit_events_target_idx').on(table.projectId, table.targetId, table.action, table.createdAt, table.id),
])

export const requirementStatuses = pgTable(
  'requirement_statuses',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    code: varchar('code', { length: 100 }).notNull().default('draft'),
    color: varchar('color', { length: 24 }).notNull(),
    sortOrder: integer('sort_order').notNull(),
    /** 停用的旧状态保留行供历史日志引用，不出现在筛选、选择和分组中。 */
    active: boolean('active').notNull().default(true),
  },
  (table) => ({
    projectSortIdx: index('requirement_statuses_project_sort_idx').on(table.projectId, table.sortOrder),
    projectNameUnique: uniqueIndex('requirement_statuses_project_name_unique').on(table.projectId, table.name),
    projectCodeUnique: uniqueIndex('requirement_statuses_project_code_unique').on(table.projectId, table.code),
    projectIdUnique: uniqueIndex('requirement_statuses_project_id_unique').on(table.projectId, table.id),
  }),
)

export const requirements = pgTable(
  'requirements',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 40 }).notNull().unique(),
    title: varchar('title', { length: 240 }).notNull(),
    documentType: varchar('document_type', { length: 24 }).$type<import('../../shared/documents/workflow').DocumentType>().notNull().default('requirement'),
    statusId: text('status_id').notNull(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id),
    priority: varchar('priority', { length: 24 }).notNull().default('medium'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectUpdatedIdx: index('requirements_project_updated_idx').on(table.projectId, table.updatedAt),
    projectIdUnique: uniqueIndex('requirements_project_id_unique').on(table.projectId, table.id),
    statusIdx: index('requirements_status_idx').on(table.statusId),
    documentTypeCheck: check('requirements_document_type_check', sql`${table.documentType} in ('requirement', 'defect', 'instruction', 'todo')`),
    projectStatusFk: foreignKey({
      columns: [table.projectId, table.statusId],
      foreignColumns: [requirementStatuses.projectId, requirementStatuses.id],
      name: 'requirements_project_status_fk',
    }),
  }),
)

// 无向关系只保存一行；两个复合外键保证双方都属于同一个项目。
export const requirementRelations = pgTable('requirement_relations', {
  projectId: text('project_id').notNull(),
  firstId: text('first_id').notNull(),
  secondId: text('second_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  primaryKey({ columns: [table.firstId, table.secondId] }),
  check('requirement_relations_order_check', sql`${table.firstId} collate "C" < ${table.secondId} collate "C"`),
  foreignKey({ columns: [table.projectId, table.firstId], foreignColumns: [requirements.projectId, requirements.id], name: 'requirement_relations_first_fk' }).onDelete('cascade'),
  foreignKey({ columns: [table.projectId, table.secondId], foreignColumns: [requirements.projectId, requirements.id], name: 'requirement_relations_second_fk' }).onDelete('cascade'),
  index('requirement_relations_second_idx').on(table.projectId, table.secondId),
])

export const requirementAssignees = pgTable('requirement_assignees', {
  requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
}, table => [
  primaryKey({ columns: [table.requirementId, table.userId] }),
  index('requirement_assignees_user_idx').on(table.userId),
])

// 每个指标单独保存证据缺口。观察到旧文档进入某状态不能证明那是历史第一次。
export const requirementStatisticCoverage = pgTable('requirement_statistic_coverage', {
  projectId: text('project_id').notNull(),
  requirementId: text('requirement_id').notNull(),
  kind: varchar('kind', { length: 24 }).$type<MilestoneKind>().notNull(),
  capturedFrom: timestamp('captured_from', { withTimezone: true, precision: 3 }).notNull(),
  historyComplete: boolean('history_complete').notNull(),
  completeFrom: timestamp('complete_from', { withTimezone: true, precision: 3 }),
  gapReason: text('gap_reason'),
  evidence: jsonb('evidence').$type<MilestoneEvidence>().notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true, precision: 3 }),
  observation: jsonb('observation').$type<MilestoneObservation>(),
}, table => [
  primaryKey({ columns: [table.requirementId, table.kind] }),
  foreignKey({ columns: [table.projectId, table.requirementId], foreignColumns: [requirements.projectId, requirements.id], name: 'statistic_coverage_document_fk' }).onDelete('cascade'),
  index('statistic_coverage_project_kind_idx').on(table.projectId, table.kind),
  check('statistic_coverage_kind_check', sql`${table.kind} in ('first_testing', 'done')`),
  check('statistic_coverage_quality_check', sql`(
    ${table.historyComplete} and ${table.completeFrom} is not null and ${table.gapReason} is null and ${table.observedAt} is null and ${table.observation} is null
  ) or (
    not ${table.historyComplete} and ${table.gapReason} is not null and (
      (${table.completeFrom} is null and ${table.observedAt} is null and ${table.observation} is null) or
      (${table.completeFrom} is not null and ${table.completeFrom} > ${table.observedAt} and ${table.observedAt} is not null and ${table.observation} is not null)
    )
  )`),
])

// 实时流程保存有可信初值的首次事件；授权手工补录由覆盖证据区分。历史负责人独立于当前关系。
export const requirementMilestones = pgTable('requirement_milestones', {
  projectId: text('project_id').notNull(),
  requirementId: text('requirement_id').notNull(),
  kind: varchar('kind', { length: 24 }).$type<MilestoneKind>().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, precision: 3 }).notNull(),
  operationId: text('operation_id').notNull(),
  source: varchar('source', { length: 24 }).$type<PropertySource>().notNull(),
}, table => [
  primaryKey({ columns: [table.requirementId, table.kind] }),
  foreignKey({ columns: [table.projectId, table.requirementId], foreignColumns: [requirements.projectId, requirements.id], name: 'milestone_document_fk' }).onDelete('cascade'),
  check('milestone_kind_check', sql`${table.kind} in ('first_testing', 'done')`),
  check('milestone_source_check', sql`${table.source} in ('web', 'agent_review', 'agent_takeover')`),
  index('milestone_project_time_idx').on(table.projectId, table.kind, table.occurredAt),
])

export const requirementMilestoneAssignees = pgTable('requirement_milestone_assignees', {
  requirementId: text('requirement_id').notNull(),
  kind: varchar('kind', { length: 24 }).$type<MilestoneKind>().notNull(),
  userId: text('user_id').notNull().references(() => users.id),
}, table => [
  primaryKey({ columns: [table.requirementId, table.kind, table.userId] }),
  foreignKey({ columns: [table.requirementId, table.kind], foreignColumns: [requirementMilestones.requirementId, requirementMilestones.kind], name: 'milestone_assignees_event_fk' }).onDelete('cascade'),
  index('milestone_assignees_user_idx').on(table.userId, table.kind),
])

// 网页创建与模板保存的幂等收据，不保存正文或敏感表单内容。
export const documentWriteReceipts = pgTable('document_write_receipts', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestId: varchar('request_id', { length: 100 }).notNull(),
  operation: varchar('operation', { length: 40 }).notNull(),
  inputHash: varchar('input_hash', { length: 64 }).notNull(),
  resourceId: text('resource_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [primaryKey({ columns: [table.projectId, table.userId, table.requestId] })])

export const documentTemplates = pgTable('document_templates', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  documentType: varchar('document_type', { length: 24 }).$type<import('../../shared/documents/workflow').DocumentType>().notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  description: varchar('description', { length: 500 }).notNull().default(''),
  contentJson: jsonb('content_json').$type<RichTextDocument>().notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('document_templates_project_idx').on(table.projectId)])

export const requirementRevisions = pgTable(
  'requirement_revisions',
  {
    id: text('id').primaryKey(),
    requirementId: text('requirement_id')
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    contentJson: jsonb('content_json').$type<RichTextDocument>().notNull(),
    contentText: text('content_text').notNull().default(''),
    changeNote: text('change_note').notNull().default(''),
    clientSaveId: text('client_save_id'),
    attribution: jsonb('attribution').$type<StoredAttributionSnapshot>(),
    attributionSequence: integer('attribution_sequence'),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    requirementVersionUnique: uniqueIndex('requirement_revisions_requirement_version_unique').on(
      table.requirementId,
      table.version,
    ),
    requirementCreatedIdx: index('requirement_revisions_requirement_created_idx').on(
      table.requirementId,
      table.createdAt,
    ),
    clientSaveUnique: uniqueIndex('requirement_revisions_client_save_unique').on(table.authorId, table.clientSaveId),
  }),
)

export const requirementDrafts = pgTable('requirement_drafts', {
  id: text('id').primaryKey(),
  requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  baseRevisionId: text('base_revision_id').notNull().references(() => requirementRevisions.id),
  title: varchar('title', { length: 240 }).notNull(),
  contentJson: jsonb('content_json').$type<RichTextDocument>().notNull(),
  changeNote: varchar('change_note', { length: 500 }).notNull().default(''),
  pendingUploads: jsonb('pending_uploads').$type<DraftImageUpload[]>().notNull().default([]),
  version: integer('version').notNull().default(1),
  lastMutationId: text('last_mutation_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, table => [
  index('requirement_drafts_owner_idx').on(table.userId, table.requirementId, table.updatedAt),
])

const yjsState = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: value => Buffer.from(value),
  fromDriver: value => new Uint8Array(value),
})

export const requirementCollaborationDocuments = pgTable('requirement_collaboration_documents', {
  requirementId: text('requirement_id').primaryKey().references(() => requirements.id, { onDelete: 'cascade' }),
  schemaVersion: integer('schema_version').notNull().default(3),
  state: yjsState('state').notNull(),
  title: varchar('title', { length: 240 }).notNull(),
  contentJson: jsonb('content_json').$type<RichTextDocument>().notNull(),
  attribution: jsonb('attribution').$type<StoredAttributionSnapshot>(),
  attributionSequence: integer('attribution_sequence').notNull().default(0),
  editEpoch: integer('edit_epoch').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const requirementEditEvents = pgTable('requirement_edit_events', {
  id: text('id').primaryKey(),
  requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  authorId: text('author_id').references(() => users.id),
  authorName: text('author_name').notNull(),
  intent: text('intent').$type<'edit' | 'restore' | 'legacy'>().notNull(),
  updateHash: text('update_hash').notNull(),
  blockIds: text('block_ids').array().notNull(),
  // 兼容已落盘的旧操作详情；新收据固定写 []，只记录 blockIds 与修改人。
  changes: jsonb('changes').$type<unknown[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('requirement_edit_events_sequence_unique').on(table.requirementId, table.sequence),
])

export const agentTokens = pgTable('agent_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('agent_tokens_owner_idx').on(table.userId)])

export const agentSnapshots = pgTable('agent_snapshots', {
  id: text('id').primaryKey(),
  requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 240 }).notNull(),
  contentJson: jsonb('content_json').$type<RichTextDocument>().notNull(),
  signature: text('signature').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  editEpoch: integer('edit_epoch').notNull(),
  properties: jsonb('properties').$type<RequirementPropertyPatch>().notNull().default({}),
  baseRevisionId: text('base_revision_id').references(() => requirementRevisions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => [index('agent_snapshots_expiry_idx').on(table.expiresAt)])

export const agentSuggestions = pgTable('agent_suggestions', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').references(() => agentSnapshots.id),
  requirementId: text('requirement_id').references(() => requirements.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().default('project_main').references(() => projects.id),
  kind: text('kind').$type<'create' | 'update'>().notNull().default('update'),
  documentType: varchar('document_type', { length: 24 }).$type<import('../../shared/documents/workflow').DocumentType>().notNull().default('requirement'),
  executionMode: text('execution_mode').$type<'review' | 'takeover'>().notNull().default('review'),
  properties: jsonb('properties').$type<RequirementPropertyPatch>().notNull().default({}),
  propertyChanges: jsonb('property_changes').$type<PropertyChange[]>().notNull().default([]),
  revisionNote: varchar('revision_note', { length: 500 }),
  savedRevisionId: text('saved_revision_id').references(() => requirementRevisions.id),
  userId: text('user_id').notNull().references(() => users.id),
  requestId: text('request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  changeNote: varchar('change_note', { length: 500 }).notNull(),
  operations: jsonb('operations').$type<SuggestionOperation[]>().notNull(),
  completedAnnotations: jsonb('completed_annotations').$type<import('../../shared/agent/annotations').AnnotationCompletion[]>(),
  title: varchar('title', { length: 240 }).notNull(),
  contentJson: jsonb('content_json').$type<RichTextDocument>().notNull(),
  status: text('status').$type<SuggestionStatus>().notNull().default('pending'),
  reviewerId: text('reviewer_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  appliedEditId: text('applied_edit_id').references(() => requirementEditEvents.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('agent_suggestions_request_unique').on(table.userId, table.requestId),
  index('agent_suggestions_requirement_idx').on(table.requirementId, table.createdAt),
  index('agent_suggestions_project_idx').on(table.projectId, table.createdAt),
])

export const requirementAgentLocks = pgTable('requirement_agent_locks', {
  requirementId: text('requirement_id').primaryKey().references(() => requirements.id, { onDelete: 'cascade' }),
  snapshotId: text('snapshot_id').notNull().references(() => agentSnapshots.id, { onDelete: 'cascade' }),
  tokenId: text('token_id').notNull().references(() => agentTokens.id, { onDelete: 'cascade' }),
  suggestionId: text('suggestion_id').references(() => agentSuggestions.id, { onDelete: 'set null' }),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    requirementId: text('requirement_id').references(() => requirements.id, { onDelete: 'set null' }),
    templateProjectId: text('template_project_id').references(() => projects.id, { onDelete: 'cascade' }),
    fileName: varchar('file_name', { length: 240 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }).notNull(),
    size: integer('size').notNull(),
    url: text('url').notNull(),
    uploadTaskId: text('upload_task_id'),
    unreferencedAt: timestamp('unreferenced_at', { withTimezone: true }),
    uploadedById: text('uploaded_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    requirementIdx: index('assets_requirement_idx').on(table.requirementId),
    uploadTaskUnique: uniqueIndex('assets_upload_task_unique').on(table.uploadedById, table.uploadTaskId),
  }),
)

export const requirementDraftAssets = pgTable('requirement_draft_assets', {
  draftId: text('draft_id').notNull().references(() => requirementDrafts.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
}, table => [primaryKey({ columns: [table.draftId, table.assetId] })])

// Agent 上传的幂等摘要及创建前临时归属；绑定需求后仍保留上传回执。
export const agentAssetUploads = pgTable('agent_asset_uploads', {
  assetId: text('asset_id').primaryKey().references(() => assets.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  createRequestId: text('create_request_id'),
  contentHash: text('content_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => [index('agent_asset_uploads_request_idx').on(table.projectId, table.createRequestId)])

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(authSessions),
  accounts: many(authAccounts),
  projectMemberships: many(projectMembers),
  reportedRequirements: many(requirements, { relationName: 'reporter' }),
  assignments: many(requirementAssignees),
  revisions: many(requirementRevisions),
}))

export const projectsRelations = relations(projects, ({ many }) => ({
  members: many(projectMembers),
  statuses: many(requirementStatuses),
  requirements: many(requirements),
}))

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, {
    fields: [authSessions.userId],
    references: [users.id],
  }),
}))

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(users, {
    fields: [authAccounts.userId],
    references: [users.id],
  }),
}))

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id],
  }),
}))

export const requirementStatusesRelations = relations(requirementStatuses, ({ one, many }) => ({
  project: one(projects, {
    fields: [requirementStatuses.projectId],
    references: [projects.id],
  }),
  requirements: many(requirements),
}))

export const requirementsRelations = relations(requirements, ({ one, many }) => ({
  project: one(projects, {
    fields: [requirements.projectId],
    references: [projects.id],
  }),
  status: one(requirementStatuses, {
    fields: [requirements.statusId],
    references: [requirementStatuses.id],
  }),
  assignments: many(requirementAssignees),
  relationsAsFirst: many(requirementRelations, { relationName: 'relationFirst' }),
  relationsAsSecond: many(requirementRelations, { relationName: 'relationSecond' }),
  reporter: one(users, {
    fields: [requirements.reporterId],
    references: [users.id],
    relationName: 'reporter',
  }),
  revisions: many(requirementRevisions),
}))

export const requirementRelationsRelations = relations(requirementRelations, ({ one }) => ({
  first: one(requirements, { fields: [requirementRelations.firstId], references: [requirements.id], relationName: 'relationFirst' }),
  second: one(requirements, { fields: [requirementRelations.secondId], references: [requirements.id], relationName: 'relationSecond' }),
}))

export const requirementAssigneesRelations = relations(requirementAssignees, ({ one }) => ({
  requirement: one(requirements, {
    fields: [requirementAssignees.requirementId],
    references: [requirements.id],
  }),
  user: one(users, {
    fields: [requirementAssignees.userId],
    references: [users.id],
  }),
}))

export const requirementRevisionsRelations = relations(requirementRevisions, ({ one }) => ({
  requirement: one(requirements, {
    fields: [requirementRevisions.requirementId],
    references: [requirements.id],
  }),
  author: one(users, {
    fields: [requirementRevisions.authorId],
    references: [users.id],
  }),
}))

export const assetsRelations = relations(assets, ({ one }) => ({
  requirement: one(requirements, {
    fields: [assets.requirementId],
    references: [requirements.id],
  }),
  uploadedBy: one(users, {
    fields: [assets.uploadedById],
    references: [users.id],
  }),
}))

export const bumpUpdatedAt = {
  updatedAt: sql`now()`,
}
