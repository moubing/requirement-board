import type { H3Event } from 'h3'
import { skillArchive } from './skill-archive'
import { skillFiles } from '~~/skills/requirement-board/scripts/files.mjs'

/** 公开分发的固定文件包不包含用户配置、凭证或业务数据。 */
export async function sendAgentSkill(event: H3Event) {
  const files = await Promise.all(skillFiles.map(async path => {
    const raw = await useStorage('assets:agent-skill').getItemRaw<Buffer>(path)
    if (raw === null) throw createError({ statusCode: 503, message: 'Skill 包尚未准备好' })
    return { path, content: Buffer.from(raw) }
  }))
  setHeader(event, 'content-type', 'application/gzip')
  setHeader(event, 'content-disposition', 'attachment; filename="requirement-board-skill.tar.gz"')
  setHeader(event, 'cache-control', 'no-store')
  setHeader(event, 'x-content-type-options', 'nosniff')
  return skillArchive(files)
}
