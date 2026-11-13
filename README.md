<p align="center">
  <img src="public/requirement-board-logo.png" width="88" alt="Requirement Board 标识">
</p>

<h1 align="center">Requirement Board · 文档看板</h1>

<p align="center"><strong>共同编辑一份文档，保存正式版本，看清每一次变化。</strong></p>
<p align="center">Nuxt 4 · Vue 3 · Tiptap · Yjs · PostgreSQL · Drizzle · Better Auth · Bing UI</p>

**[在线体验](https://101.35.217.21/demo/)** · [功能与界面](#功能与界面) · [技术设计](#技术设计) · [本地运行](#本地运行) · [开发文档](docs/README.md) · [相关项目](#相关项目)

Requirement Board 面向小团队，把需求、缺陷、说明和待办放进统一的文档工作流。成员可以实时编辑同一篇富文本，按需保存正式版本，比较文字、格式、表格和图片的变化，并从选中文字追溯历史；AI 助手也可以通过配套 Skill 读取文档、处理标注和提交修改。

> 在线体验无需注册，使用虚构示例，支持本页编辑、预置版本比较、局部恢复和重置。修改在刷新或离开后恢复。多人协作、正式版本保存、图片上传、AI 标注和选区历史等完整能力需进入正式应用使用。详见[游客体验范围](docs/demo.md)。

[![生产工作台：个人工作流、项目动态、团队负载与完成节奏](docs/images/workbench-production.png)](docs/images/workbench-production.png)

*生产工作台：将待处理事项、近期动态和团队统计放在同一页。界面截图来自生产环境，更新于 2026-11-14，展示正式应用的能力；不代表游客入口开放了全部功能。点击图片可查看原图。*

## 功能与界面

| 场景 | 当前能力 |
| --- | --- |
| 文档管理 | 需求、缺陷、说明、待办四种类型；正文模板、多人负责人、优先级、状态流转、双向关联和分页搜索 |
| 富文本编辑 | 表格与列宽、图片与题注、代码高亮、任务清单、提示块、折叠块与斜杠命令 |
| 实时协作 | Yjs 共同编辑、在线成员、持久化状态、断线恢复与个人草稿检查点 |
| 版本与历史 | 主动保存正式版本、并排 / 统一语义 Diff、草稿变更标记、选区历史与局部恢复 |
| AI 文档操作 | 网页文字及节点标注、Node CLI Skill、不可变快照、独占编辑锁、基线检查与幂等收据 |
| 团队工作台 | 我的工作流、拖拽改状态、项目动态、团队负载与完成节奏 |
| 账号权限 | 用户名或邮箱登录、注册审批、邀请、管理员开户与固定项目成员校验 |

四类文档均支持多人负责。当前系统使用固定项目，项目角色可以多选；多租户、项目切换及[子任务与状态汇总](docs/accounts-and-workflow-plan.md)尚未实现。

### 正文编辑与共同草稿

正文、目录和常用属性集中在文档工作区。共同编辑自动同步草稿，点击“保存版本”才生成正式快照；在线成员和节点修改人帮助团队理解协作状态。

[![生产编辑器：文档标题、状态与负责人、富文本工具栏、提示块和目录](docs/images/editor-production.jpg)](docs/images/editor-production.jpg)

### 富文本版本比较

比较保留正文的排版和节点语义，区分新增、删除及修改，支持差异导航、并排和统一布局。下面展示同一篇生产文档 v3 与 v4 的真实历史差异。

[![生产版本比较：v3 与 v4 的文字、段落和提示块变化](docs/images/diff-production.jpg)](docs/images/diff-production.jpg)

### 从选区追溯历史

选中文字后可以查看它在相邻版本间的变化，并按“仅更改”过滤记录或进入完整版本比较。图中追溯标题的首次出现，同时列出没有影响该选区的后续版本。

[![生产选区历史：标题的新增内容、修改人和版本记录](docs/images/selection-history-production.jpg)](docs/images/selection-history-production.jpg)

### 把修改要求标在原文旁

选中文字或节点即可填写 AI 标注，配套 [requirement-board Skill](skills/requirement-board/SKILL.md) 读取标注及上下文后处理文档。AI 编辑使用独占锁和快照基线；是否保存正式版本由使用者明确决定。

[![生产编辑器中的 AI 标注草稿：在选中标题旁填写修改要求](docs/images/ai-annotation-production.jpg)](docs/images/ai-annotation-production.jpg)

*此图展示标注填写状态；用于截图的临时要求已取消，未保存到生产文档。*

## 技术设计

- **正文与版本分开保存**：正式快照使用 Tiptap JSON，纯文本由 JSON 派生；共同草稿额外持久化 Yjs 状态，重连沿用原有历史。[共同编辑](docs/collaboration.md)
- **Diff 保留富文本语义**：通过稳定的 `diffId` 对齐块，分别处理文字、格式、表格单元格和图片属性变化；编辑器、只读渲染与历史追溯共用正文模型。[编辑器与 Diff](docs/editor-and-diff.md)
- **AI 修改可校验、可重试**：编辑前取得快照和独占锁，提交时核对基线，用请求标识和收据避免重复执行。[Agent 文档管理](docs/agent-editing.md)
- **图片清理保护全部历史**：资源回收检查历史版本、模板、共同正文和有效草稿，提供预览与无引用宽限期。[资源生命周期](docs/architecture.md#图片与资源生命周期)
- **围绕长文档减少重复工作**：正文派生结果按编辑代次复用，比较视图按需创建、热切换复用。性能记录保留样本、测量条件与未完成项，不作为跨设备保证。[长文档测量记录](docs/req-12-performance-validation.md)
- **验证按边界拆分**：纯逻辑测试、独立 PostgreSQL API 测试和无头浏览器场景分别覆盖模型、持久化及真实交互。[开发与验证](docs/development.md)

```mermaid
flowchart LR
  Web["Nuxt 页面 · Bing UI · Tiptap"] --> API["Nitro API · 权限校验"]
  Agent["本机 AI · requirement-board Skill"] --> API
  Web <--> Collab["Yjs · Hocuspocus"]
  API --> DB["Drizzle · PostgreSQL"]
  Collab --> DB
  API --> Assets["私有图片存储 · 本地目录或 S3"]
```

数据模型、请求上下文与模块边界见[应用架构](docs/architecture.md)，账号流程见[账号与成员管理](docs/accounts.md)。

## 本地运行

建议使用 Node.js 24，使用 `package.json` 指定的 pnpm 11.7.0，并安装 Docker。普通运行从 npm 安装 Bing UI，无需先下载另外两个源码仓库。

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

访问终端显示的本地地址，通常为 [http://localhost:3000](http://localhost:3000)。使用 `admin` 和交互设置的密码登录；无需账号的本地体验入口为 `/demo`。

本地 PostgreSQL 17 使用 5438 端口，默认连接为 `postgres://requirement:requirement@localhost:5438/requirement_board`。这些值仅用于本地开发。可选配置见 [.env.example](.env.example)，实际环境文件不提交。种子只补缺失的管理员、固定项目、状态和七篇手册，不覆盖已有正文。

修改 UI、组件库或配套文档前，复制 `dev-repos.example.json` 为 `dev-repos.local.json`，填写两个源码仓库路径并运行 `pnpm ui:check`。本机路径不提交，组件库修改需同步文档站。详见 [Bing UI 接入约定](docs/bing-ui.md)。

### 常用验证

| 命令 | 范围 |
| --- | --- |
| `pnpm typecheck` | 前端与服务端类型检查 |
| `pnpm test:auth` | 认证配置、来源与 Cookie 隔离 |
| `pnpm test:unit` | 编辑器、Diff、草稿、协作与 Agent 纯逻辑 |
| `pnpm test:api` | 独立 PostgreSQL 测试库的真实接口 |
| `pnpm test:browser:workspace` | 无头浏览器工作区交互 |

按改动选择最小必要验证，详细环境与场景见[开发文档](docs/development.md)。API 测试会清理测试库，不能指向业务数据库。日常文档修改无需构建应用。

### 代码入口

```text
app/       Nuxt 页面、工作台、编辑器与 Diff 界面
shared/    共享正文模型、校验、Diff 与业务契约
server/    API、协作、认证、存储与资源清理
drizzle/   数据库迁移和快照
skills/    requirement-board CLI Skill
tests/     纯逻辑、API 和无头浏览器验证
docs/      设计说明、验证记录与 README 配图
```

更多设计与维护资料从[文档索引](docs/README.md)进入。

## 相关项目

| 项目 | 职责 | 在线入口 |
| --- | --- | --- |
| [Bing UI](https://github.com/moubing/bing-ui) | 本项目实际使用的 Vue 3 组件库 | [Storybook 组件演示](https://101.35.217.21:6007/?path=/docs/components-binganimatedtext--docs) |
| [Bing UI Docs](https://github.com/moubing/bing-ui-docs) | 组件说明、交互示例、完整源码及 AI 可读文档 | [使用文档](https://101.35.217.21:6008/docs) |

公开发布范围、排除项及第三方许可说明见[公开发布说明](docs/publication.md)。
