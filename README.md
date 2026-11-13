<p align="center">
  <img src="public/requirement-board-logo.png" width="88" alt="Requirement Board 标识">
</p>

<h1 align="center">Requirement Board · 文档看板</h1>

<p align="center"><strong>让团队文档可以共同编辑、正式存版、比较变化，也可以交给 AI 处理。</strong></p>
<p align="center">Nuxt 4 · Vue 3 · Tiptap · Yjs · PostgreSQL · Drizzle · Better Auth · Bing UI</p>

Requirement Board 面向小团队，把需求、缺陷、说明和待办放进统一的文档工作流。成员可以实时编辑同一篇富文本，按需保存正式版本，比较文字、格式、表格和图片的变化，并从选中文字追溯历史。

## 功能概览

| 场景 | 当前能力 |
| --- | --- |
| 文档管理 | 四类文档、正文模板、多人负责人、优先级、状态流转、双向关联和分页搜索 |
| 富文本编辑 | 表格与列宽、图片与题注、代码高亮、任务清单、提示块、折叠块与斜杠命令 |
| 实时协作 | Yjs 共同编辑、在线成员、持久化状态、断线恢复与个人草稿检查点 |
| 版本与历史 | 主动保存正式版本、并排语义 Diff、草稿变更标记、选区历史与局部恢复 |
| AI 文档操作 | Node CLI Skill、网页标注、不可变快照、独占编辑锁、基线检查与幂等收据 |
| 团队工作台 | 我的工作流、拖拽改状态、项目动态、团队负载与完成节奏 |
| 账号权限 | 用户名或邮箱登录、注册审批、邀请、管理员开户与固定项目成员校验 |
| 游客体验 | `/demo` 提供虚构示例，支持本页编辑、预置版本比较和重置 |

当前系统使用固定项目，不提供多租户或项目切换。项目角色可以多选；子任务与状态汇总仍是设计方案，尚未实现。游客体验不连接真实协作或业务数据。

## 界面展示

![游客体验中的富文本编辑器，展示虚构的团队文档与目录](docs/images/demo-editor.png)

![游客体验中的版本比较，展示预置文档的文字与结构差异](docs/images/demo-diff.png)

以上截图来自本地匿名游客页面，仅含随源码发布的虚构数据。

## 技术取舍

- **正文与版本分开保存**：正式快照使用 Tiptap JSON，纯文本由 JSON 派生；共同草稿额外持久化 Yjs 状态，重连继续原有历史。[共同编辑](docs/collaboration.md)
- **比较保留富文本语义**：使用稳定的 `diffId` 对齐块，分别处理文字、格式、表格单元格和图片属性变化。[编辑器与 Diff](docs/editor-and-diff.md)
- **AI 修改有明确边界**：读取不加锁；编辑先取得快照和独占锁，提交核对基线，并用请求标识避免重复执行。[Agent 文档管理](docs/agent-editing.md)
- **历史资源仍受保护**：图片清理检查全部历史版本、模板、共同正文与有效草稿，提供预览与宽限期。[资源生命周期](docs/architecture.md#图片与资源生命周期)
- **验证覆盖实际边界**：纯逻辑、隔离 PostgreSQL API 和无头浏览器场景分别验证；性能报告保留测量条件与局限。[开发与验证](docs/development.md)

## 本地运行

建议使用 Node.js 24，使用 `package.json` 指定的 pnpm 11.7.0，并安装 Docker。普通运行只从 npm 安装 Bing UI，不需要先下载另外两个源码仓库。

```powershell
git clone https://github.com/moubing/requirement-board.git
cd requirement-board
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm auth:set-password admin
pnpm dev
```

访问终端显示的本地地址，通常为 `http://localhost:3000`。使用 `admin` 和交互设置的密码登录；无需账号的体验入口为 `/demo`。

本地 PostgreSQL 17 使用 5438 端口，默认连接为 `postgres://requirement:requirement@localhost:5438/requirement_board`。这些值仅用于本地开发。可选配置见 [.env.example](.env.example)；实际环境文件不提交。种子只补缺失的管理员、固定项目、状态和七篇手册，不覆盖已有正文。

修改组件库或进行跨仓库 UI 联调时，再复制 `dev-repos.example.json` 为 `dev-repos.local.json` 并配置路径，执行 `pnpm ui:check`。[接入约定](docs/bing-ui.md)

## 常用验证

| 命令 | 范围 |
| --- | --- |
| `pnpm typecheck` | 前端与服务端类型检查 |
| `pnpm test:auth` | 认证配置、来源与 Cookie 隔离 |
| `pnpm test:unit` | 编辑器、Diff、草稿、协作与 Agent 纯逻辑 |
| `pnpm test:api` | 独立 PostgreSQL 测试库的真实接口 |
| `pnpm test:browser:workspace` | 无头浏览器工作区交互 |

按改动选择最小必要验证，详细环境与场景见 [开发文档](docs/development.md)。API 测试会清理测试库，不能指向业务数据库。日常文档修改无需构建应用。

## 代码入口

```text
app/       Nuxt 页面、工作台、编辑器与 Diff 界面
shared/    共享正文模型、校验、Diff 与业务契约
server/    API、协作、认证、存储与资源清理
drizzle/   数据库迁移和快照
skills/    requirement-board CLI Skill
tests/     纯逻辑、API 和无头浏览器验证
docs/      设计说明与验证记录
```

公开部署边界见 [部署说明](deploy/README.md)，发布内容与排除项见 [公开发布说明](docs/publication.md)。更多设计从 [文档索引](docs/README.md) 进入。

## 相关项目

- [Bing UI](https://github.com/moubing/bing-ui)：本项目实际使用的 Vue 3 组件库。
- [Bing UI Docs](https://github.com/moubing/bing-ui-docs)：组件使用说明、交互示例及 AI 可读文档。
