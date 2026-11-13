import { listProjectMembers } from '../../services/accounts'
import { requireAppContext } from '../../utils/request-context'

export default defineEventHandler(async (event) => {
  const context = await requireAppContext(event)
  if (context.currentUser.role !== 'admin' && !context.projectRoles.includes('project_admin')) {
    throw createError({ statusCode: 403, message: '需要项目管理员权限' })
  }
  return listProjectMembers(context.db)
})
