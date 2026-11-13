import type { DocumentType } from '#shared/documents/workflow'

export interface BoardUser {
  id: string
  name: string
  avatarColor: string
}

export interface BoardStatus {
  id: string
  code?: string
  name: string
  color: string
}

export interface BoardRequirement {
  id: string
  documentType?: DocumentType
  assigneeIds: string[]
  assignees: BoardUser[]
  key: string
  title: string
  priority: 'low' | 'medium' | 'high'
  createdAt: string
  updatedAt: string
  status: BoardStatus
  reporter: BoardUser
}

export interface BoardMeta {
  project: { id: string; name: string }
  currentUserId: string
  users: BoardUser[]
  statuses: BoardStatus[]
}
