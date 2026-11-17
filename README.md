<p align="center">
  <img src="public/requirement-board-logo.png" width="88" alt="Requirement Board 标识">
</p>

<h1 align="center">Requirement Board · 文档看板</h1>

<p align="center"><strong>共同编辑一份文档，保存正式版本，看清每一次变化。</strong></p>
<p align="center">Nuxt 4 · Vue 3 · Tiptap · Yjs · PostgreSQL · Drizzle · Better Auth · Bing UI</p>

**[在线体验](https://101.35.217.21/demo/)** · [宣传片](https://101.35.217.21/promo.html) · [Yjs 原理动画](https://101.35.217.21/crdt.html) · [Hocuspocus 接入动画](https://101.35.217.21/hocuspocus.html) · [AI 接口动画](https://101.35.217.21/agent.html) · [性能优化动画](https://101.35.217.21/perf.html) · [表结构动画](https://101.35.217.21/schema.html) · [功能与界面](#功能与界面) · [技术亮点](#技术亮点) · [本地运行](#本地运行) · [开发文档](docs/README.md) · [相关项目](#相关项目)

Requirement Board 面向小团队，把需求、缺陷、说明和待办放进统一的文档工作流。成员可以实时编辑同一篇富文本，按需保存正式版本，比较文字、格式、表格和图片的变化，并从选中文字追溯历史；AI 助手也可以通过配套 Skill 读取文档、处理标注和提交修改。

项目由我独立设计和开发，覆盖界面、服务端、数据库、实时协作与 AI Agent 接口。它也是我自己的日常工具：本仓库和 Bing UI 的需求、缺陷与发布准备都在生产环境中管理。

> **在线体验**无需注册：使用虚构示例，可以编辑正文、比较预置版本、局部恢复和重置，刷新或离开后还原。多人协作、保存正式版本、图片上传、AI 标注和选区历史需要登录正式应用，范围见[游客体验说明](docs/demo.md)。
>
> **宣传片**[《谁动了开饭时间？》](https://101.35.217.21/promo.html)（96 秒）用一桩“猫粮失踪案”演示共同编辑、版本比较、选区历史、局部恢复和 AI 独占编辑锁。它是单个 HTML 文件 [`public/promo.html`](public/promo.html)，画面和配乐都在浏览器里实时生成，不依赖外部资源，也可以下载后直接打开。
>
> **原理动画**[《拆开 Yjs》](https://101.35.217.21/crdt.html)（4 分 32 秒）讲共同编辑底下的 Yjs 是怎么实现的：Item 链表、ID、插入与并发插入、合并存储、StructStore、删除和同步。同样是单个 HTML 文件 [`public/crdt.html`](public/crdt.html)，画面和配乐在浏览器里实时生成，可以下载后直接打开。
>
> **续集**[《Yjs × Hocuspocus》](https://101.35.217.21/hocuspocus.html)（4 分 12 秒）讲 Yjs 的更新怎么送到别人那里，以及这个项目怎么接上它们：同步握手、房间、钩子、二进制落库、编辑副本与确认副本、`POST /edits` 上行与 WebSocket 下行、AI 编辑锁。单个 HTML 文件 [`public/hocuspocus.html`](public/hocuspocus.html)，同样可以下载后直接打开。
>
> **第三集**[《AI 改文档：怎么不覆盖人的修改？》](https://101.35.217.21/agent.html)（4 分 52 秒）讲 AI 通过接口和 Skill 修改文档的过程：读取快照与编辑锁、幂等与基线、执行修改、旧页面处理、AI 标注的定位与完成回执、凭证与安装。单个 HTML 文件 [`public/agent.html`](public/agent.html)。
>
> **第四集**[《长文档：打一个字为什么要等？》](https://101.35.217.21/perf.html)（3 分 58 秒）讲长文档的性能优化：先量清楚，再分析打字为什么慢、少做与晚做、滚动时先读后写、比较视图、离开再回来，最后说明这些数字的边界。单个 HTML 文件 [`public/perf.html`](public/perf.html)。
>
> **第五集**[《31 张表：它们是怎么连起来的？》](https://101.35.217.21/schema.html)（4 分 22 秒）讲数据库表结构与表间关系：七组表、1:N / 1:1 / N:M 三种连法、正文的三种形态、复合外键、无向关系、删除策略、软引用与回收任务、唯一约束与 CHECK，以及新建文档的事务。单个 HTML 文件 [`public/schema.html`](public/schema.html)。

[![生产工作台：个人工作流、项目动态、团队负载与完成节奏](docs/images/workbench-production.png)](docs/images/workbench-production.png)

*生产环境的工作台：待处理事项、近期动态和团队统计放在同一页。本文截图均取自生产环境（2026-11-14），点击可查看原图。*

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

当前为固定的单个项目，项目角色可以多选；多租户、项目切换及[子任务与状态汇总](docs/accounts-and-workflow-plan.md)尚未实现。

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

选中文字或节点即可填写 AI 标注，复制给自己的 AI 助手后，由配套的 [requirement-board Skill](skills/requirement-board/SKILL.md) 读取标注和上下文并修改文档。应用本身不内置大模型，AI 能力通过受限 API 接入。

[![生产编辑器中的 AI 标注草稿：在选中标题旁填写修改要求](docs/images/ai-annotation-production.jpg)](docs/images/ai-annotation-production.jpg)

Skill 是一个无需安装依赖的 Node CLI，一次修改分四步：

```text
snapshot   读取正文，取得不可变快照和独占编辑锁（默认 30 分钟）
new        基于快照生成请求文件，填写正文操作与属性修改
validate   只计算候选结果，不写入
submit     核对快照基线后写入共同草稿；同一 requestId 重试返回原结果
```

是否保存正式版本由使用者明确决定；执行成功后，网页自动清除已完成的标注。除了修改，Agent 还可以查找和新建文档、上传图片、比较版本、查询文本历史。

## 技术亮点

- **富文本语义 Diff**：可比较的块都有稳定且唯一的 `diffId`。比较时优先按 ID 对齐块并识别增删，块内按 Unicode 字符做 LCS，格式单独比较，表格按单元格、图片按属性和题注处理；两侧字符数乘积超过 50,000 时改用前后缀算法，控制长段落的计算成本。编辑器、只读渲染与选区历史共用同一套正文模型。[编辑器与 Diff](docs/editor-and-diff.md)
- **共同编辑不丢、不重复**：正式版本保存 Tiptap JSON，共同草稿另外持久化 Yjs 状态。客户端分开维护编辑副本和服务端确认副本，本地编辑约 16 ms 合批提交；Yjs 状态、派生的 JSON、节点修改人与去重收据在同一事务写入。重连沿用已保存的 Yjs 历史，不从 JSON 重建，避免同一段文字被当成两次插入。[共同编辑](docs/collaboration.md)
- **AI 修改可校验、可重试**：Agent 使用个人访问凭证调用受限 API。修改前取得不可变快照和独占编辑锁，其他凭证此时收到 `423 REQUIREMENT_LOCKED`；提交时核对标题与正文签名，不一致返回 `409 STALE_BASE`；同一 `requestId` 重试返回原结果。凭证在库中只保存 SHA-256，默认 30 天有效，可以撤销。[Agent 文档管理](docs/agent-editing.md)
- **图片清理保护全部历史**：资源回收检查全部历史版本、模板、共同正文和有效草稿，支持先预览再执行，无引用的图片默认保留 7 天宽限期。[资源生命周期](docs/architecture.md#图片与资源生命周期)
- **长文档性能有测量记录**：以一篇约 4.9 万字符、37 张图片、16 张表格的真实文档为样本，输入事件处理的 P95 从 52.3 ms 降到 5.8 ms，浏览器呈现反馈的 P95 从 63.5 ms 降到 26.4 ms，全文滚动时的样式重算减少约 81%。数据来自本机无头 Chromium，测量条件和未达标项见[输入与切换测量](docs/req-12-performance-validation.md)、[滚动测量](docs/req-10-performance-validation.md)。
- **测试接入发布流程**：706 项纯逻辑测试和 46 项认证测试（2026-11-14 运行通过），API 集成测试使用独立的 PostgreSQL，另有无头浏览器场景。Jenkins 流水线依次运行测试、构建镜像、迁移数据库并部署，健康检查失败时回退到上一个兼容的健康镜像。[开发与验证](docs/development.md)

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

日常开发与 AI 编程代理协作完成：[AGENTS.md](AGENTS.md) 规定任务路由、不可破坏的约束和完成标准，`docs/` 是人和代理共用的事实来源，功能与性能验证都留有记录。

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

三个仓库构成一条完整的链路：组件库发布到 npm，文档站说明并验证用法，本项目在真实产品中使用它。

| 项目 | 职责 | 在线入口 |
| --- | --- | --- |
| [Bing UI](https://github.com/moubing/bing-ui) | 本项目实际使用的 Vue 3 组件库 | [Storybook 组件演示](https://101.35.217.21:6007/?path=/docs/components-binganimatedtext--docs) |
| [Bing UI Docs](https://github.com/moubing/bing-ui-docs) | 组件说明、交互示例、完整源码及 AI 可读文档 | [使用文档](https://101.35.217.21:6008/docs) |

公开发布范围、排除项及第三方许可说明见[公开发布说明](docs/publication.md)。
