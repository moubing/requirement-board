import { z } from 'zod'
import { richTextDocumentSchema } from '../editor/validation'
import { isBlockNode, type RichTextNode } from '../editor/document'

export const draftDocumentSchema = richTextDocumentSchema.refine(document => {
  const ids = new Set<string>()
  function valid(node: RichTextNode): boolean {
    if (isBlockNode(node)) {
      const id = node.attrs?.diffId
      if (typeof id !== 'string' || !id || ids.has(id)) return false
      ids.add(id)
    }
    if (node.type === 'image' && String(node.attrs?.src).startsWith('blob:')) return false
    return node.content?.every(valid) ?? true
  }
  return document.content.every(valid)
}, '草稿必须保留唯一的块 ID，图片不能使用临时预览地址')

export const draftIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{12,100}$/)
export const draftSnapshotSchema = z.object({
  baseRevisionId: z.string().min(1).max(100),
  title: z.string().max(240),
  contentJson: draftDocumentSchema,
  changeNote: z.string().max(500),
  pendingUploads: z.array(z.object({
    id: draftIdSchema,
    imageDiffId: z.string().min(1).max(100),
    fileName: z.string().min(1).max(240),
    mimeType: z.string().startsWith('image/').max(120),
    size: z.number().int().min(1).max(5 * 1024 * 1024),
    position: z.number().int().min(0).max(20_000_000),
    order: z.number().int().min(0),
    relativePosition: z.string().max(2000).optional(),
  }).strict()).max(100),
}).strict().refine(value => new Set(value.pendingUploads.map(upload => upload.id)).size === value.pendingUploads.length,
  '图片上传任务重复')

// 本地备份保留尚未通过业务长度校验的输入，用户可以恢复后修改。
export const localDraftSnapshotSchema = draftSnapshotSchema.safeExtend({ title: z.string(), changeNote: z.string(), contentJson: richTextDocumentSchema })

export const draftWriteSchema = z.object({
  // 保留旧请求兼容字段；当前不做编辑版本冲突校验。
  expectedVersion: z.number().int().min(0).optional(),
  mutationId: draftIdSchema,
  snapshot: draftSnapshotSchema,
}).strict()

export const draftCloseSchema = z.object({ expectedVersion: z.number().int().min(0).optional() }).strict()
