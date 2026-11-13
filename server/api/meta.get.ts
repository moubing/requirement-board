import { and, asc, eq } from 'drizzle-orm'

import { projectMembers, requirementStatuses, users } from '../db/schema'
import { requireAppContext } from '../utils/request-context'

export default defineEventHandler(async (event) => {
  const { db, currentUserId, project, projectId } = await requireAppContext(event)
  const [userRows, statusRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        avatarColor: users.avatarColor,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(and(eq(projectMembers.projectId, projectId), eq(users.banned, false)))
      .orderBy(asc(users.name)),
    db.query.requirementStatuses.findMany({
      where: (table, { and, eq }) => and(eq(table.projectId, projectId), eq(table.active, true)),
      orderBy: asc(requirementStatuses.sortOrder),
    }),
  ])

  return {
    currentUserId,
    project,
    users: userRows,
    statuses: statusRows,
  }
})
