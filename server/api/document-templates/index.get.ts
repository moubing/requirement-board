import { requireAppContext } from '../../utils/request-context'
import { listDocumentTemplates } from '../../services/document-templates'
export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, currentUser, projectRoles } = await requireAppContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return listDocumentTemplates(db, { projectId, userId: currentUserId, admin: currentUser.role === 'admin' || projectRoles.includes('project_admin') })
})
