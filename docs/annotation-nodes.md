# 节点的 AI 标注能力

REQ-30 提示块支持 note/说明、tip/建议、warning/注意、danger/风险。结构仍为 inline*，能力 version=1 和签名协议不变；tone 原本已属于有效属性。类型切换保留 diffId 与文字，经过同一个 annotation-edit-guard；确认清除受影响整体标注、独立记录撤销，取消不落入 Yjs。图标按钮和占位提示是 NodeView 展示内容，不加入文本范围、纯文本或序列化 HTML。只读与 Diff 图标没有操作入口。

标注目标分为文字范围和节点整体。提示块、图片、整表、单元格都使用同一套节点身份、菜单、边框、输入框、列表、复制、失效保护和完成回执；特殊语义由节点能力提供。

## 普通节点接入

唯一注册入口是 `skills/requirement-board/scripts/annotation-node-capabilities.mjs`。该模块无浏览器或 Node.js 专属依赖，随 Skill 包一起分发；网页、服务端 schema 和 CLI 都读取它。

新增节点先完成编辑器与服务端正文 schema、只读渲染、稳定 diffId、Diff 和持久化接入。标注注册不替代这些要求，也不会让服务端接受未知正文节点。随后在注册表增加一项：

```js
businessCard: { label: '业务卡片', text: 'children', object: true },
```

这一个声明会提供“标注业务卡片”菜单、默认摘要、整块边框、节点定位、内容核验、复制和 CLI 定位。无需修改标注菜单、目标类型枚举、输入框、列表、保护逻辑或完成回执。鼠标以本次命中的 ProseMirror 节点及可标注祖先生成菜单；键盘支持节点选择和节点内折叠光标；触屏默认只接管节点留白/边缘，保留文字长按。

`text` 描述真实正文结构，不凭节点名称推断：

| 声明 | 用途 |
| --- | --- |
| `block` | 自身直接承载 text/hardBreak，例如 paragraph、callout、codeBlock |
| `children` | 容器，继续查找其中的文字块，例如列表或内含段落的卡片 |
| 不声明 | 不开放其内部文字范围，整体标注仍可用，例如表格 |

callout 当前是 `inline*`，所以声明 `block`，不能把它作为包含 paragraph 的容器。没有独立 diffId 的节点不能作整体目标。空节点仍可整体标注，显示注册名称作为提示。

任务清单的 `taskList`、`taskItem` 都声明 `text: 'children'`，继续使用内部 paragraph 的 diffId 与 Unicode 范围；topLevelId 指向所在顶层容器。两者暂不提供整体节点标注。`taskItem.defaultAttrs.checked` 为 false；真实勾选状态属于包含它的对象签名，但不改变其内部文字标注的定位或完成摘要。

折叠块的 `details` 声明 `text: 'children', object: true`，提供 version=1 的整块标注；`detailsSummary` 声明 `text: 'block'`，以自己的 diffId 保存摘要文字范围；`detailsContent` 声明 `text: 'children'`，沿用内部文字块的身份，不作独立整体目标。展开状态不在正文中，不影响签名、失效保护或修改状态。收起时不绘制隐藏内容的标注，定位先展开祖先再计算位置；定位整个 details 时同时展开内部折叠块。

## 默认语义与特殊适配

普通节点的签名覆盖整个子树的类型、有效属性、文字、marks、链接和结构。所有 diffId 都不参与内容签名，目标身份另行核验；其余未知属性默认参与，避免把有意义的变化当作纯样式。属性顺序和 mark 顺序不产生变化。

注册项可声明 `ignoredAttrs`、`defaultAttrs` 和 `summaryAttrs`。仅确认不改变语义的展示属性才可忽略。当前图片忽略 width/height/align；单元格忽略 colwidth，并归一化缺省 rowspan/colspan。提示块的 tone 参与签名。

整表签名递归使用各子节点的注册规则，因此同样忽略表头和普通单元格的 colwidth。列宽拖动和双击恢复自动宽不会使整表或单元格标注失效，也不会触发修改原文确认；文字、格式和合并跨度仍严格参与签名。旧对象目标与新 node 目标分别由 annotation-objects、annotation-nodes 测试覆盖。

`object: true` 使用全部默认值；特殊节点可使用 `object: { ... }`：

| 字段 | 职责 |
| --- | --- |
| `version` | 节点标注能力版本，默认 1；身份/上下文契约或语义规则发生不兼容变化时升级并处理旧版本兼容 |
| `context` / `validateContext` | 生成并严格校验必要的有限上下文；不能放入整篇正文、全表或媒体字节 |
| `sameIdentity` / `identityError` | 检查资源或容器归属，例如单元格所属表格及合并跨度 |
| `location` / `menu` | 位置说明和必要的菜单文案，例如逻辑行列、所在单元格 |
| `thumbnail` | 从已校验上下文取得预览图地址 |
| `dom.boundsSelector` | NodeView 包装下的真实标注边界；默认直接使用 ProseMirror 节点 DOM |
| `dom.excludeSelector` | 排除不应由该对象接管的区域，例如独立图片题注 |
| `dom.touchSurfaceSelector` | 图片等可完整长按的画面区域；默认仅接管留白 |

图片、单元格适配器与注册项放在同一模块，通用遍历、定位和签名流程不依赖具体节点名称。图片原图读取继续经过 PAT、项目、文档和实际引用检查；注册标注能力不会绕过资源权限，也不会自动赋予 Agent 视频/图表数据读取能力。

## 协议与兼容

正文仍是 schema 3；节点标注接入不增加迁移或再次提高 editEpoch。`node_annotations` 自 Agent capabilitiesVersion 8 提供，当前能力版本与新增节点能力见 [Agent 文档](agent-editing.md#格式与图片)；`annotationNodes` 从注册表自动导出每种整体目标的名称和能力版本。

新整体标注仍采用 `rb-annotations/v2`，目标字段为：

```ts
{
  type: 'node',
  nodeType: 'callout',
  version: 1,
  blockId, topLevelId, signature, summary,
  // context 仅在适配器需要时提供
}
```

目标的 nodeType、version 与本机注册能力及服务端 annotationNodes 同时核验。CLI 缺少某个节点定义时更新 Skill；来源站点缺少能力时停止，不降级伪装。增加普通节点会自动扩展 manifest，不需要再增加协议目标类型或修改核心解析器。

旧 v1 文字、旧 v2 image/table/cell 继续解析。旧对象保留原目标字段和冻结的签名算法，不在加载、定位、预览或重新复制时转成 node；可以与新节点标注混用。完成摘要始终基于复制时的目标和要求。升级网页不能使旧回执失配，也不能仅因内容变化就清理标注。

持久化规则、原文编辑保护及回执确认顺序见 [Agent 文档](agent-editing.md#从网页传递-ai-标注) 和 [编辑器文档](editor-and-diff.md#ai-标注与正文隔离)。

## 验证

- `tests/diff/annotation-nodes.test.ts` 在隔离注册表中新增未出现在生产注册表的 `futureCard`，配上最小 ProseMirror 节点后，直接复用 DOM/键盘命中、菜单展示、文字提取、协议序列化、定位及能力检查。未修改标注核心。
- `annotation-storage.test.ts` 覆盖旧 v2 对象的本机恢复、混合复制和原摘要回执消费；原 v1 回归继续保留。
- `tests/api/annotation-objects.cases.ts` 验证提示块真实快照、通用定位、草稿写入和回执，保留其他正文及旧正式版本。
- `BROWSER_TEST_SCENARIO=object-annotations pnpm test:browser:workspace` 无头验证提示块整块与文字、鼠标/键盘/触屏、边框定位、输入保护及回执，同时回归图片、表格和单元格；原文字流程使用 `annotations` 场景。
