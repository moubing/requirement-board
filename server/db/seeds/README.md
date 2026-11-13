# 使用手册种子

七篇正文最初提取自 2026-10-04 的正式版本，随后随功能变化维护。当前已同步四种文档类型、正文模板、分支流程、多人负责人，以及 AI 默认直接编辑、草稿与版本状态、按明确要求保存版本的流程。新手册以「说明 / 已发布」创建；更新种子不会覆盖已有手册。JSON 只包含文档 ID、标题与 Tiptap 正文，不包含账号、会话、凭证、编辑流水或数据库备份。

| 文件 | 主题 | 最初提取版本 |
| --- | --- | --- |
| `01-quick-start.json` | 快速入门 | v3 |
| `02-requirement-management.json` | 文档创建与日常管理 | v3 |
| `03-editor.json` | 富文本编辑器指南 | v3 |
| `04-collaboration.json` | 共同编辑与草稿恢复 | v3 |
| `05-versions.json` | 版本管理与差异追踪 | v3 |
| `06-ai-collaboration.json` | AI 协作使用指南 | v3 |
| `07-accounts.json` | 账号、成员与权限管理 | v2 |

每篇“继续阅读”包含其他六篇的相对链接，共 42 个；正文另有两个手册链接。固定需求 ID 与已有 `diffId` 保持不变，部署到其他域名仍可跳转。当前正文不依赖上传图片。

修改功能时同步维护对应手册 JSON，保留已有稳定块 ID 并检查引用关系；也可从已确认的正式版本更新，不能导入整张业务表。`validateSeedManuals()` 在写入前校验正文、ID、链接与资源依赖。验证运行 `pnpm exec vitest run tests/diff/seed-manuals.test.ts`、`pnpm test:api` 和 `pnpm typecheck`；API 测试覆盖管理员认证保留、清理回滚、Yjs 与正式版本一致、过期编辑拒绝及重复播种。

`pnpm db:seed` 对已有手册直接跳过，不能用它覆盖正在编辑的文档。需要重置本机数据时参见 [开发文档](../../../docs/development.md#清理本机开发数据)，不要在远程环境执行本机重置工具。
