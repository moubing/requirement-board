import type { DocumentType } from '#shared/documents/workflow'
import type { RevisionDto } from '#shared/requirements/revisions'

interface UserDto {
  id: string
  name: string
  avatarColor: string
}

interface StatusDto {
  id: string
  code?: string
  name: string
  color: string
}

export interface RequirementDetailMeta {
  currentUserId: string
  users: UserDto[]
  statuses: StatusDto[]
}

export interface RequirementDto {
  id: string
  documentType?: DocumentType
  assigneeIds: string[]
  assignees: UserDto[]
  key: string
  title: string
  priority: 'low' | 'medium' | 'high'
  statusId: string
  status: StatusDto
  reporter: UserDto
  currentRevision: RevisionDto | null
}
