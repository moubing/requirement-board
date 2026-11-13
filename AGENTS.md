# AGENTS.md

本文件是 AI 在 `requirement-board` 仓库内工作的入口规则，作用域覆盖整个仓库。详细知识放在 `docs/`；不要把会快速过期的实现清单重复堆在这里。

## 开始任何任务前

1. 运行 `git status --short`，识别并保留用户已有改动。
2. 根据下方任务路由完整阅读相关文档，再查看目标代码及邻近测试。
3. 以代码、测试和配置为最终事实来源。文档与实现不一致时，先核实实现，并在同一任务中更新文档。
4. 选择能解决问题的最小改动范围；不要顺手重构无关代码。
5. 涉及 UI、`bing-ui` 或其文档的任务，先运行 `pnpm ui:check`，只使用 `dev-repos.local.json` 中配置的仓库路径。缺失或无效时，中断相关工作并提示用户按 [`docs/bing-ui.md`](docs/bing-ui.md) 配置；不得猜测同级目录或静默回退。

## 协作与安全

- 不主动执行 `git commit`、推送或创建 PR；只有用户明确要求时才执行。
- 不还原用户改动，不使用 `git reset --hard`、`git checkout -- .` 等破坏性命令。
- 手动编辑使用 `apply_patch`。不要编辑 `.nuxt/`、`.output/`、`node_modules/`、`public/uploads/` 等生成或运行时内容。
- 不提交 `.env`、上传文件、数据库数据或密钥；新增环境变量时同步更新安全的 `.env.example`。
- 并行分支的迁移按 [`docs/development.md`](docs/development.md#并行开发与迁移合并) 处理。后续迁移使用时间戳前缀；不得为解决冲突重写已经执行的 SQL 或执行时间，合并前运行 `pnpm db:check:migrations --base <目标分支>`。

## 不可破坏的项目约束

- 正式正文快照使用 Tiptap JSON，HTML 只用于渲染，`contentText` 必须由 JSON 派生。实时共同编辑额外持久化 Yjs 状态，并在同一事务中派生共同正文 JSON；不能在重连时从 JSON 重建 Yjs 历史。详见 `docs/collaboration.md`。
- 可参与版本对齐的块必须拥有稳定且唯一的 `diffId`。修改节点模型时，要同时检查编辑器、服务端校验、纯文本提取、Diff、只读渲染和测试。
- Revision 是历史快照。资源引用检查必须覆盖所有历史 revision，不能只看当前正文。
- 当前应用保持固定项目；账号、系统管理、项目业务分别使用对应请求上下文。注册不授予项目访问权，审批或接受邀请才写入 `project_members`；启用的 `admin` 有显式全权分支。项目角色可以多选，普通成员仍可编辑需求正文，子任务流程尚未实现。不要擅自引入多租户、项目切换或通用权限平台。
- UI 优先复用 npm 依赖 `@moubing/bing-ui`。修改前按 [`docs/bing-ui.md`](docs/bing-ui.md) 核对已安装版本的组件、类型和事件语义，不能凭其他组件库的经验猜 API。确认问题属于组件库时，不在本项目加入兼容层；说明根因，并在用户把 `bing-ui` 纳入修改范围后修复源组件。修改 `bing-ui` 必须在同一任务中同步配置的 `bing-ui-docs`（正文、API、示例、版本及 AI 导出），验证后再更新本项目的发布包依赖；不能只改组件库而遗漏文档。

## 任务路由

| 任务类型 | 必须先读 | 重点入口 |
| --- | --- | --- |
| 本地启动、环境变量、命令、测试选择 | [`docs/development.md`](docs/development.md) | `package.json`、`docker-compose.yml`、`vitest.config.ts` |
| 数据模型、API、迁移、种子、当前用户/项目 | [`docs/architecture.md`](docs/architecture.md) 与 [`docs/development.md`](docs/development.md) | `server/db/`、`server/api/`、`drizzle/` |
| 图片上传、文件目录、资源清理 | [`docs/architecture.md`](docs/architecture.md) 与 [`docs/development.md`](docs/development.md) | `server/api/assets/`、`server/services/asset-gc.ts` |
| Tiptap 节点、粘贴、链接、图片、编辑器交互 | [`docs/editor-and-diff.md`](docs/editor-and-diff.md) | `shared/editor/`、`app/components/editor/` |
| 版本 Diff、格式变化、表格、草稿撤销、Diff UI | [`docs/editor-and-diff.md`](docs/editor-and-diff.md) | `shared/diff/`、`app/components/diff/` |
| 页面或工具型 UI | [`docs/architecture.md`](docs/architecture.md) 与 [`docs/bing-ui.md`](docs/bing-ui.md)；涉及正文时再读编辑器文档 | `app/pages/`、`app/assets/css/main.css` |

跨多个领域的改动要阅读所有相关文档，不要只读其中一个。

## 项目边界速览

- `app/`：Nuxt 页面、编辑器与 Diff 组件。
- `shared/`：前后端共享的编辑器数据模型、校验辅助和 Diff 纯逻辑。
- `server/`：Nitro API、Drizzle 数据访问、上传及资源清理。
- `drizzle/`：生成的数据库迁移 SQL 与快照。
- `tests/diff/`：Diff、编辑器纯逻辑及显式 `happy-dom` 测试。
- `tests/api/`：使用独立 PostgreSQL 测试库的接口集成测试。

## 完成标准

- 检查最终 diff，确认没有无关格式化或生成文件。
- 按 [`docs/development.md`](docs/development.md) 的验证矩阵执行与风险相称的最小测试；不能执行时说明原因。
- 若改动改变了持久化格式、API 契约、运行方式或跨模块约束，同步更新对应 `docs/` 文档。
