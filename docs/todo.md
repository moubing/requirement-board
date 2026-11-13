# 待办

记录开发讨论中尚未验证的问题。性能疑问须经测量后再决定是否优化，不作为已确认的瓶颈。

## 编辑器正文更新时的全量遍历开销

- [ ] 验证大文档持续输入时，多次全量遍历是否影响输入响应。
- 记录日期：2026-10-07。
- 当前状态：已核对代码，尚未测量输入性能，未实施优化。

### 疑问与代码依据

[RichRequirementEditor.vue](../app/components/editor/RichRequirementEditor.vue) 的 `onUpdate` 中执行：

```ts
const value = ensureBlockIds(editor.getJSON() as RichTextDocument)
```

即使只修改一个段落，`getJSON()` 仍导出整篇正文，[ensureBlockIds](../shared/editor/document.ts) 随后递归检查全部节点。普通本地正文修改还会触发 [BlockId 插件](../app/components/editor/block-id-extension.ts) 的文档扫描，存在重叠的全量 ID 检查。

单次检查的时间复杂度大致为 O(N)，N 为正文节点数量；多次线性遍历仍为 O(N)，但同步耗时、对象分配与垃圾回收成本会累加。需验证节点较多、表格或格式片段较密集、持续输入或收到远端修改时的实际影响。

### 后续验证

1. 使用不同节点规模和结构的文档，在无头浏览器中验证持续输入、删除、格式修改、粘贴与远端更新；记录文档规模、运行环境及重复测量条件。
2. 分别测量 `BlockId` 扫描、`getJSON()`、`ensureBlockIds()` 的调用次数和耗时，并观察完整输入链路的响应延迟与主线程长任务。
3. 核对 `onUpdate` 的实际触发来源，区分正文变化与切换可编辑状态等额外触发，避免把单纯光标移动或滚动计入正文更新。
4. 若确认值得优化，再评估按事务变更范围维护块 ID、减少导出阶段的重复校验，以及全文 JSON 导出频率。保留全局 ID 唯一性、图片规范化、协作撤销、保存与切页备份的正确性，不直接删除兜底或给整个更新回调加防抖。

现有[编辑器滚动性能评估](editor-scroll-performance-assessment.md)不覆盖上述输入链路，不能代替本项验证。验证后在此补充测量结果和处理结论。
