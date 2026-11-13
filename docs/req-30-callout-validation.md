# REQ-30 提示块验证记录

## 生产数据审计

2026-11-08 21:49 CST，使用 production-readonly 配置与 `rb_prod_readonly`，核验 `requirement_board_prod` 和 `transaction_read_only=on`。在 repeatable read / read only 事务中递归展开全部 content_json 的 content 数组，仅返回按来源与 tone 分组的数量，不导出正文，不修改线上数据。

| 来源 | 全部记录数 | 提示块数 | tone 分布 |
| --- | ---: | ---: | --- |
| requirement_collaboration_documents | 38 | 18 | 全部 note |
| requirement_drafts | 19 | 1 | 全部 note |
| requirement_revisions（全部历史） | 66 | 22 | 全部 note |
| document_templates | 0 | 0 | 无数据 |

没有未知或缺失 tone，允许将后续写入收紧至 note/tip/warning/danger；没有执行数据迁移，没有改写 revision 或重建 Yjs。此结论对应审计时点，发布前若有其他客户端新写入，应再次核对未知值。

## 验证范围

单元测试覆盖四种取值、非法/缺失值、展示回退不改数据、HTML 往返、纯文本、插入语义、语气 Diff/草稿恢复、行内格式与真实换行、普通及协作独立撤销、整体标注取消/确认。API 测试使用本机独立 requirement_board_test，覆盖模板、网页版本和 AI 输入边界。

`BROWSER_TEST_SCENARIO=callouts pnpm test:browser:editor` 覆盖真实插入和菜单、光标、复制粘贴与新块唯一 ID、普通/Yjs 撤销、只读、320/390/960/1440 宽度、亮暗主题及正文对比度 ≥ 4.5、双页二进制状态合并。普通模式检查正常动画和方向键操作，协作模式检查减少动态效果。`callout-sync` 可单独验证首次操作及同步。

`BROWSER_TEST_SCENARIO=callouts pnpm test:browser:workspace` 覆盖整体标注确认、语气 Diff 提示、文字换行、个人阅读偏好、设置预览独立配色、选区历史。浏览器均无头，双页 Yjs 测试不替代真实 WebSocket 部署验证。截图仅人工检查，不作为像素基线。

## 本次结果

2026-11-08 验证通过：

- `pnpm ui:check`、`pnpm typecheck`。
- 9 个相关单元测试文件、119 项测试：callout、editor-history、editor-clipboard、agent-suggestions、version-marker-restore、annotation-nodes、selection-history、document、rich-text-diff。
- `requirements-api.test.ts -t '提示块|accepts editor table'`：4 项接口测试。网页版本和模板非法语气返回 400，AI 操作按原接口契约返回 422，拒绝后数据库内容保持不变。
- 编辑器与工作区的 `callouts` 无头场景，以及编辑器 `callout-sync`、`passive-loading` 场景。被动加载检查确认插件初始化同步不会改变正文、触发多余保存或重建共同编辑历史。
- 人工检查编辑器和 Diff 的亮暗截图；提示块图标对齐首行，正文颜色保持独立，只有实际修改语气的块计入版本变化。

发现并修复了提示块行内文字节点之间被错误添加换行、首次菜单插件初始化导致首个协作操作被旧状态覆盖，以及模板更新的非法输入误报 500。临时浏览器、测试服务与审计/截图文件在验证后关闭和清理；未修改线上数据。
