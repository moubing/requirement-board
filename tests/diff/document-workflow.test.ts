import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { DOCUMENT_STATES, DOCUMENT_TYPES, DOCUMENT_WORKFLOWS, belongsToDocumentType, documentStates, initialDocumentState } from '../../shared/documents/workflow'
import { builtInTemplates, instantiateTemplate } from '../../shared/documents/templates'
import { extractPlainText, type RichTextNode } from '../../shared/editor/document'
import { richTextDocumentSchema } from '../../shared/editor/validation'

describe('文档类型、流程与模板', () => {
  it('需求、缺陷、待办共用五个状态并从待处理开始，说明从草稿开始；同类型内任意切换', () => {
    for (const type of ['requirement', 'defect', 'todo'] as const) {
      expect(documentStates(type)).toEqual(['queued', 'doing', 'testing', 'done', 'closed'])
      expect(initialDocumentState(type)).toBe('queued')
    }
    expect(documentStates('instruction')).toEqual(['draft', 'published', 'archived'])
    expect(initialDocumentState('instruction')).toBe('draft')
    expect(belongsToDocumentType('requirement', 'done')).toBe(true)
    expect(belongsToDocumentType('defect', 'draft')).toBe(false)
    expect(belongsToDocumentType('instruction', 'testing')).toBe(false)
    for (const legacy of ['review', 'ready', 'development', 'acceptance', 'release', 'confirmation', 'repair_ready', 'repairing', 'verification']) {
      expect(DOCUMENT_STATES).toHaveProperty(legacy)
      for (const type of DOCUMENT_TYPES) expect(belongsToDocumentType(type, legacy)).toBe(false)
    }
    for (const type of DOCUMENT_TYPES) expect(DOCUMENT_WORKFLOWS[type]).toEqual({ initial: initialDocumentState(type), states: documentStates(type), transitions: 'any' })
  })
  it('默认模板均合法，正文复制重新分配所有块 ID，并兼容编辑器响应式对象', () => {
    const ids = (node: RichTextNode): string[] => [...(typeof node.attrs?.diffId === 'string' ? [node.attrs.diffId] : []), ...(node.content ?? []).flatMap(ids)]
    for (const template of builtInTemplates()) {
      expect(richTextDocumentSchema.safeParse(template.contentJson).success).toBe(true)
      const original = JSON.stringify(template.contentJson)
      const first = instantiateTemplate(reactive(template.contentJson)), second = instantiateTemplate(template.contentJson)
      expect(extractPlainText(first)).toBe(extractPlainText(second))
      expect(ids(first).some(id => ids(second).includes(id) || ids(template.contentJson).includes(id))).toBe(false)
      expect(JSON.stringify(template.contentJson)).toBe(original)
    }
  })
})
