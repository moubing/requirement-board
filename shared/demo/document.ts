import { cloneRichTextDocument, type RichTextDocument, type RichTextNode } from '../editor/document'

export const DEMO_TITLE = '编辑器功能导览'
export const DEMO_IMAGE_SOURCES = ['/demo/nodes.svg'] as const

const text = (value: string, bold = false): RichTextNode => ({ type: 'text', text: value, ...(bold ? { marks: [{ type: 'bold' }] } : {}) })
const paragraph = (id: string, value: string, bold = false): RichTextNode => ({ type: 'paragraph', attrs: { diffId: `demo_${id}` }, content: value ? [text(value, bold)] : [] })
const heading = (id: string, value: string, level = 2): RichTextNode => ({ type: 'heading', attrs: { diffId: `demo_${id}`, level }, content: [text(value)] })
const callout = (tone: string, value: string): RichTextNode => ({ type: 'callout', attrs: { diffId: `demo_callout_${tone}`, tone }, content: [text(value)] })
const listItem = (id: string, value: string): RichTextNode => ({ type: 'listItem', attrs: { diffId: `demo_${id}` }, content: [paragraph(`${id}_text`, value)] })
const marked = (value: string, type: string): RichTextNode => ({ type: 'text', text: value, marks: [{ type }] })

function documentAt(version: number): RichTextDocument {
  const row = (id: string, cells: string[], header = false): RichTextNode => ({ type: 'tableRow', content: cells.map((value, column) => ({
    type: header ? 'tableHeader' : 'tableCell', attrs: { diffId: `demo_${id}_${column}`, colspan: 1, rowspan: 1, colwidth: null, align: null },
    content: [paragraph(`${id}_${column}_text`, value)],
  })) })
  const task = (id: string, value: string, checked: boolean): RichTextNode => ({ type: 'taskItem', attrs: { diffId: `demo_${id}`, checked }, content: [paragraph(`${id}_text`, value)] })
  return { type: 'doc', content: [
    heading('start', '从一段文字开始', 1),
    { type: 'callout', attrs: { diffId: 'demo_scope', tone: 'note' }, content: [
      text('游客体验仅展示部分基本编辑与版本比较功能，并非完整功能演示。', true),
      text('多人协作、保存正式版本、图片上传、AI 标注、选区历史等功能未在本页开放，需进入正式应用使用。'),
    ] },
    paragraph('description', version === 1
      ? '这是一段普通正文。点击文字开始编辑，再去看看版本比较。'
      : '这是一段可编辑的正文。选中文字试试加粗、高亮或链接，再去看看版本比较。'),
    paragraph('intro', '下方展示的都是真实节点，可以直接操作。用左侧目录跳到感兴趣的部分，或在空段输入 / 插入新节点。'),

    heading('text', '标题、段落与文字格式'),
    heading('subheading', '三级标题用来细分主题', 3),
    paragraph('headings_help', '文首是一级标题，章节使用二级标题，上面这一行是三级标题。标题会自动进入目录；普通段落适合连续说明。'),
    { ...paragraph('marks', ''), content: [text('选中文字可使用 '), marked('加粗', 'bold'), text('、'), marked('斜体', 'italic'), text('、'), marked('下划线', 'underline'), text('、'), marked('删除线', 'strike'), text('、'), marked('高亮', 'highlight'), text(' 和 '), marked('行内代码', 'code'), text('；也能插入 '),
      { type: 'text', text: '链接', marks: [{ type: 'link', attrs: { href: 'https://github.com/moubing', target: '_blank', rel: 'noopener noreferrer' } }] }, text('。这些样式都可以参与版本比较。')] },
    { ...paragraph('line_break', ''), content: [text('同一段内也可以换行：按 Shift + Enter。'), { type: 'hardBreak' }, text('这一行仍属于上面那个段落；按 Enter 则新建段落。')] },

    heading('lists', '列表、步骤与任务'),
    { type: 'bulletList', attrs: { diffId: 'demo_bullets' }, content: [
      listItem('bullet_group', '无序列表适合并列的要点，例如功能范围、背景和注意事项。'),
      listItem('bullet_edit', '在列表中按 Enter 继续下一项，用 Tab / Shift + Tab 调整层级。'),
    ] },
    { type: 'orderedList', attrs: { diffId: 'demo_steps', start: 1 }, content: [
      listItem('step_edit', '有序列表适合操作步骤：先在正文中修改一个词。'),
      listItem('step_compare', '再切换到版本比较，选择示例 v3 与当前临时内容。'),
    ] },
    { type: 'taskList', attrs: { diffId: 'demo_tasks' }, content: [
      task('task_edit', '已体验文字编辑', version >= 2),
      task('task_compare', '已查看两个示例版本的差异', version >= 3),
      task('task_try', '点一下这个复选框，看看勾选状态怎样出现在 Diff 中', false),
    ] },

    heading('callouts', '引用与提示块'),
    { type: 'blockquote', attrs: { diffId: 'demo_quote' }, content: [paragraph('quote_text', '引用块用来保留原话、参考说明或背景材料，左侧竖线将它与普通正文区分开。')] },
    callout('note', '说明：提示块可以把一条补充信息从正文中单独提出来。'),
    callout('tip', '建议：试着修改这句话，或从斜杠菜单插入另一种提示块。'),
    callout('warning', '注意：刷新、离开页面或重置示例，会清除本次临时修改。'),
    callout('danger', '风险：这种样式适合突出重要限制；这里展示的是节点样式。'),

    heading('structured', '代码与表格'),
    paragraph('code_help', '代码块支持选择语言、语法高亮和复制。下面是一段 JavaScript；也可以修改代码或给代码块起标题。'),
    { type: 'codeBlock', attrs: { diffId: 'demo_code', language: 'javascript', title: '一份示例文档' }, content: [text(`const document = {\n  title: '编辑器功能导览',\n  version: ${version},\n  editable: true,\n}\n\nconsole.log(document.title)`)] },
    paragraph('table_help', '表格适合对照信息。可以编辑单元格、增删行列、调整对齐，或拖动列边界改变宽度；版本比较也能显示表格里的变化。'),
    { type: 'table', attrs: { diffId: 'demo_fields_table' }, content: [
      row('fields_header', ['节点', '适合做什么'], true),
      row('text_usage', ['段落与标题', version === 1 ? '书写内容' : '书写内容、组织层级并生成目录']),
      row('table_usage', ['表格', '把多项信息放在一起对照']),
      ...(version >= 3 ? [row('details_usage', ['折叠块', '收纳补充说明，按需展开'])] : []),
    ] },

    heading('images', '图片与题注'),
    paragraph('image_help', '这是一张预置图片。选中后可以拖动角点缩放、改变对齐，或编辑图片下方的题注；游客页不支持上传新图片。'),
    { type: 'image', attrs: { diffId: 'demo_preview', src: DEMO_IMAGE_SOURCES[0], alt: '由标题、文字、任务和表格组成的文档示意图', width: 760, height: 340, align: 'center' },
      content: [{ type: 'imageCaption', content: [text('这是可编辑的图片题注：给图片补充一段说明。')] }] },

    heading('containers', '折叠块与分隔线'),
    { type: 'details', attrs: { diffId: 'demo_details' }, content: [
      { type: 'detailsSummary', attrs: { diffId: 'demo_details_summary' }, content: [text('点左侧箭头，展开这条补充说明')] },
      { type: 'detailsContent', content: [
        paragraph('details_help', '折叠块把较长的补充内容收在摘要下。展开或收起只改变显示，不会产生正文修改。'),
        paragraph('details_diff', version === 1 ? '折叠起来的内容仍属于文档。' : '折叠起来的内容仍属于文档，内部的文字变化也会出现在版本比较中。'),
      ] },
    ] },
    paragraph('divider_help', '下面是真实的分隔线节点，可以把两个主题隔开。'),
    { type: 'horizontalRule', attrs: { diffId: 'demo_divider' } },

    heading('diff', '试试版本比较'),
    paragraph('diff_versions', '先切到「版本比较」，把基准设为 v1、目标设为 v3：你会看到正文替换、加粗、任务勾选、代码修改、表格加行，以及整段新增和删除。'),
    paragraph('diff_views', '可以在「并排」与「统一」之间切换，勾选「仅变化」收起未修改内容，用前后箭头逐处查看。'),
    paragraph('diff_try', '要比较自己的修改，把基准设为 v3、目标设为「当前临时内容」。把鼠标移到变更处后，可以回退这一处；回到正文还可以按 Ctrl / ⌘ Z 撤销回退。'),
    paragraph('rule', '回退只改变当前临时内容，原来的示例版本不会被改写。', version >= 2),
    ...(version < 3 ? [paragraph('old_notice', '删除示例：这段文字在 v3 中被移除。')] : []),
    ...(version >= 3 ? [{ type: 'callout', attrs: { diffId: 'demo_added_tip', tone: 'note' }, content: [text('新增示例：这一条补充说明从 v3 开始出现。')] } as RichTextNode] : []),
    paragraph('end', '从这里开始试写：改一个词、加一个节点，或者回到上面勾选一项任务。想重新开始时，点击「重置示例」。'),
  ] }
}

/** 每个页面实例拥有独立副本，不进入业务文档、版本或草稿缓存。 */
export function createDemoDocuments() {
  const revisions = [
    { id: 'v1', label: 'v1 · 基础示例', note: '示例作者小林：展示各类正文节点，作为版本比较的起点。', content: documentAt(1) },
    { id: 'v2', label: 'v2 · 文字与格式', note: '示例作者小夏：修改文字、加粗恢复说明，更新代码、表格、任务和折叠内容。', content: documentAt(2) },
    { id: 'v3', label: 'v3 · 增删与结构', note: '示例作者小林：新增提示和表格行、删除旧段落，并更新任务状态与代码。', content: documentAt(3) },
  ]
  return { revisions, draft: cloneRichTextDocument(revisions[2]!.content) }
}
