import { requireAppContext } from '../../utils/request-context'
import { saveDocumentTemplate } from '../../services/document-templates'
import { documentWriteKey } from '../../services/document-write-receipts'
export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, currentUser, projectRoles } = await requireAppContext(event)
  return saveDocumentTemplate(db, { projectId, userId: currentUserId, admin: currentUser.role === 'admin' || projectRoles.includes('project_admin') }, await readBody(event), undefined, undefined, documentWriteKey(event))
})
