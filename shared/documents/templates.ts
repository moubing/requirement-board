import { z } from 'zod'
import { DOCUMENT_TYPES, type DocumentType } from './workflow'
import { cloneRichTextDocument, ensureBlockIds, type RichTextDocument, type RichTextNode } from '../editor/document'
import { richTextDocumentSchema } from '../editor/validation'

export const documentTemplateInputSchema = z.object({
  name: z.string().trim().min(1, '请输入模板名称').max(80, '模板名称最多 80 个字符'),
  documentType: z.enum(DOCUMENT_TYPES),
  description: z.string().trim().max(500, '用途说明最多 500 个字符').default(''),
  contentJson: richTextDocumentSchema,
}).strict()
export interface DocumentTemplate {
  id: string
  name: string
  documentType: DocumentType
  description: string
  contentJson: RichTextDocument
  builtIn: boolean
  canEdit: boolean
  version: number
}
const definitions: { documentType: DocumentType; name: string; description: string; sections: [string, string][] }[] = [
  { documentType: 'requirement', name: '标准需求', description: '描述目标、使用场景与验收标准。', sections: [['背景与目标', '说明当前问题，以及希望达成的目标。'], ['使用场景', '谁会在什么场景下使用这项功能？'], ['详细需求', '描述功能行为、边界条件和异常情况。'], ['验收标准', '列出可以明确验证的完成条件。']] },
  { documentType: 'defect', name: '缺陷报告', description: '记录复现过程、预期与实际结果。', sections: [['问题描述', '简要描述遇到的问题及影响。'], ['复现步骤', '按顺序列出能够复现问题的操作。'], ['预期结果', '说明正确的行为。'], ['实际结果', '说明实际发生的行为。'], ['环境与附件', '记录环境、版本信息，并补充截图或日志。']] },
  { documentType: 'instruction', name: '通用说明', description: '整理使用方法、规则与注意事项。', sections: [['概述', '说明本文的主题和用途。'], ['适用范围', '说明适用的人员、场景与前提。'], ['详细说明', '按步骤或主题展开说明。'], ['示例与注意事项', '提供示例，以及需要注意的限制。']] },
  { documentType: 'todo', name: '事项待办', description: '明确行动目标、执行事项和完成条件。', sections: [['目标', '说明这件事要达成什么结果。'], ['行动清单', '列出需要完成的具体事项。'], ['完成标准', '说明如何判断这件事已经完成。'], ['补充信息', '补充相关背景和参考资料。']] },
]
export function builtInTemplates(): DocumentTemplate[] {
  return definitions.map(item => ({ ...item, id: `builtin_${item.documentType}`, builtIn: true, canEdit: false, version: 1,
    contentJson: ensureBlockIds({ type: 'doc', content: item.sections.flatMap(([title, hint]) => [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] },
      { type: 'paragraph', content: [{ type: 'text', text: hint }] },
    ]) as RichTextNode[] }),
  }))
}
/** 复制模板生成新文档时重新分配块 ID；已有文档和模板的 ID 保持不变。 */
export function instantiateTemplate(content: RichTextDocument): RichTextDocument {
  const copy = cloneRichTextDocument(content)
  function clear(node: RichTextNode) { if (node.attrs) delete node.attrs.diffId; node.content?.forEach(clear) }
  clear(copy)
  return ensureBlockIds(copy)
}
