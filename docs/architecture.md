# 应用架构与服务端契约

本文说明跨模块约束。账号、编辑器、共同编辑、草稿、Agent 等细节从 [文档索引](README.md) 进入对应专题；代码、测试和配置是最终事实来源。

## 系统形态与边界

```text
Nuxt 页面与组件 → Nitro API → Drizzle / postgres-js → PostgreSQL
                      ├─ Better Auth：凭证与数据库会话
                      ├─ Hocuspocus：/collaboration WebSocket
                      └─ asset-storage：本地私有目录或 S3/MinIO
```

- 固定项目为 `project_main`。当前用户来自会话；普通账号须有 `project_members` 关系，启用的 `admin` 有显式全权分支。
- 注册不自动授予项目权限。审批、接受邀请或管理员直接开户才加入项目；项目角色可多选，所有启用成员仍可编辑正文。没有多租户、项目切换或子任务汇总。
- 需求、缺陷、说明、待办共用 `requirements` 表、`/requirements` 路由及 `REQ-*` 编号。类型、流程和模板见 [文档类型与模板](document-types-and-templates.md)。
- 正式快照使用 Tiptap JSON，`contentText` 由 JSON 派生；共同草稿额外保存 Yjs 历史。revision 追加写入，不能原地覆盖。
- `shared/` 不依赖 Nuxt 运行时；网页与 Agent 服务端复用其中的 Diff、校验和历史追溯逻辑。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| `app/pages/` | 工作台、文档、模板、账号和管理页面 |
| `app/components/editor/`、`shared/editor/` | 编辑体验、JSON 模型、规范化与校验 |
| `app/components/diff/`、`shared/diff/` | 只读比较、选区历史、草稿变更撤销 |
| `app/composables/` | 页面状态、协作、草稿、索引与版本缓存 |
| `shared/documents/` | 文档类型、内置模板与各类型可用状态 |
| `shared/auth/`、`shared/audit/`、`shared/agent/` | 账号、审计和 Agent 契约 |
| `server/api/` | HTTP 输入校验、授权与服务调用 |
| `server/services/` | 业务事务、协作队列、存储与资源 GC |
| `server/utils/request-context.ts`、`auth.ts` | 会话、请求权限与 Better Auth 配置 |
| `server/db/`、`drizzle/` | Schema、种子与迁移历史 |

## 数据模型

完整字段、关系和删除策略见 [schema.ts](../server/db/schema.ts)。

| 表 | 作用与关键约束 |
| --- | --- |
| `users`、`auth_accounts` | 用户资料、`admin/user` 与 `banned`；密码哈希属于 credential，不放在 users |
| `auth_sessions`、`auth_verifications`、`auth_rate_limits` | 数据库会话、验证预留数据与限流 |
| `projects`、`project_members`、`project_member_roles` | 项目、成员关系和多角色；成员按项目/用户唯一 |
| `project_access_requests`、`project_invitations` | 每用户每项目一份当前申请；每项目/邮箱最多一份待接受邀请 |
| `requirements`、`requirement_statuses` | 当前元数据及项目内唯一状态代码；文档类型创建后固定 |
| `requirement_assignees` | 四类文档的多人负责人关系；文档/用户联合主键防重，外键保证文档和用户存在 |
| `requirement_milestones`、`requirement_milestone_assignees`、`requirement_statistic_coverage` | 可证明的首次提测/完成、当时完整负责人及按指标历史缺口；不从当前属性反推历史 |
| `requirement_relations` | 双向文档关联；按 ID 的 C 排序保存唯一一对，复合外键保证双方同项目，删除文档时级联清理关系 |
| `document_templates` | 项目正文模板、创建者和递增版本；内置模板由代码定义 |
| `requirement_revisions` | 标题、正文、派生文本、说明、保存人、节点修改人及截止序号；需求内 version 唯一 |
| `requirement_collaboration_documents` | 每需求一份 Yjs 状态、同事务派生 JSON、正文 schemaVersion、节点名单、编辑序号和 editEpoch；受控升级见 collaboration.md |
| `requirement_edit_events` | 原事件 ID、账号、增量摘要、序号及节点 ID；新记录的兼容 changes 字段为 [] |
| `requirement_drafts`、`requirement_draft_assets` | 本人检查点、上传任务与图片引用；结束后保留轻量墓碑 |
| `agent_tokens`、`agent_snapshots` | PAT 哈希及有效期；不可变正文/属性基线与 schemaVersion、editEpoch |
| `agent_suggestions`、`requirement_agent_locks` | 沿用旧表名保存执行收据及历史审核记录；每需求至多一个 AI 编辑锁 |
| `assets`、`agent_asset_uploads` | 文件元数据、需求/模板归属，以及 Agent 暂存上传和幂等回执 |
| `audit_events` | 账号与逐属性业务日志，和业务变更同事务提交 |

正文不在 `requirements` 表内。详情的 `currentRevision` 是最新正式版本，共同正文由协作接口读取；状态、负责人和优先级不属于 revision，也不随正文回退。

`GET /api/requirements/:id` 可带 `knownRevisionId`。权限及当前需求检查通过后，若它仍是最新正式版本，只返回当前属性、`currentRevisionId` 和 `currentRevisionUnchanged: true`，省略 `currentRevision`，也不读取该版本 JSON/重新聚合贡献名单。客户端只能与相同 ID 的完整本地版本合并；ID 不匹配视为缓存失效。未传参数或版本变化时仍返回完整 `currentRevision`，无版本为 null。响应禁止共享缓存；此提示不能省略权限、协作锁或 editEpoch 检查。

## 请求权限

| 上下文 | 使用范围 |
| --- | --- |
| `requireAccountContext` | 有效会话及启用账号；本人资料、申请和凭证 |
| `requireSystemAdminContext` | 账号校验后检查最新系统管理员身份 |
| `requireAppContext` | 账号校验后检查固定项目访问权，返回项目角色 |

资源查询必须同时约束项目。跨项目需求、revision 和图片返回 404；前端隐藏入口不能代替服务端授权。账号管理规则、最后一名管理员保护、会话撤销及邀请凭证见 [accounts.md](accounts.md)。

Better Auth 路由采用允许列表，原生 `/api/auth/admin/**` 不开放。业务 Cookie 写请求若带 Origin，必须命中配置的受信 origin；认证路由使用 Better Auth 的校验。`/uploads/...` 也要求会话与项目权限，响应为 private cache。

公开应用入口包括健康检查、邀请预览及无凭证的 Skill 安装说明/下载；它们不开放业务数据。`/api/agent/v1` 每次单独验证 Bearer PAT。

`/demo` 公开展示随代码发布的固定示例，使用独立页面副本及 Header，不读取账号或项目数据，不接入真实草稿、版本、上传、AI 或协作。精确路由放行不扩展业务 API 权限，也不清除已有账号状态；实现边界见 [游客体验](demo.md)。

## 核心写入流程

### 创建文档

`POST /api/requirements` 校验标题、类型、模板、状态和完整负责人名单。新文档只能从本项目的 `draft` 状态开始；报告人和初始版本保存人来自会话。

网页显式 `templateId: null` 创建空白正文；省略时兼容旧请求，使用该类型内置模板。服务端验证模板归属与类型，复制正文并重分配全部 `diffId`，同事务创建文档及完整 v1。网页共同文档按需初始化；Agent 创建直接提供完整正文，同时初始化 Yjs。

网页与 Agent 共用创建服务，在事务 advisory lock 内按现有 `REQ-数字` 的最大值加一，再由唯一约束兜底。不按总条数分配，也不承诺删除最高编号后永不重用。

创建需求/缺陷时同时保存可信初始属性与统计覆盖；状态实际变化时由共享属性服务保存可证明的首次里程碑和最终负责人。历史缺口、旧文档观察边界、迁移以及个人周期统计 HTTP 见 [工作台统计](workbench-statistics.md)；首页工作流、动态、负载与完成节奏见 [首页工作台](workbench-home.md)。

### 保存正式版本

`POST /api/requirements/:id/revisions` 的顺序为 schema 校验 → `ensureBlockIds` → 按网页规则补齐非 paragraph 结尾所需的空段 → 服务端派生 `contentText`。文档创建、模板保存和 AI 候选也在存储前补齐尾段；已有普通文字段落不追加。相同保存请求重试时允许本次保存自动补入的尾段，仍检查请求原正文及块 ID；版本比较不忽略已有的尾段差异。块 ID 修复不是非法 JSON 的兼容入口，旧图片须在加载时规范化。

详情页先完成标题属性提交并等待原始正文编辑确认，再提交 `draftId`、`clientSaveId`、`collaborationUpdate` 和编辑代次。服务端在需求行锁内合并 Yjs、检查本人草稿与上传任务、分配最大版本号 + 1，固化正文和本版修改人，并读取当前标题写入版本快照、结束个人检查点。相同保存请求重试不重复建版本；保存期间的新编辑仍保留。

`requirements.title` 是当前标题的唯一来源，通过属性 PATCH 独立保存；`revision.title` 为保存正文版本当时的标题，历史不改写。版本接口兼容接收旧 `title` 参数，但不用于更新当前标题，旧页面或保存重试不能撤销之后的改名。

升级迁移 `0016_independent_document_title` 保留旧系统已同步但尚未存版的改名：仅当当前标题仍等于最新正式版时，把有效共同草稿标题提升为当前属性；已独立改名或空白草稿标题不覆盖。迁移不修改历史版本、正文或 Yjs 状态。

### 更新属性

`PATCH /api/requirements/:id` 接受 title、statusId、assigneeIds、priority；`assigneeIds` 替换完整名单，空数组清空，旧 `assigneeId` 不再接受。四类文档均支持多人，关系保存到 `requirement_assignees`，与属性日志同事务更新。文档类型创建后不可改。状态须为项目内启用状态且属于该文档类型，同类型内可任意切换，否则返回 409；可选 `expectedStatusId` 与当前状态不一致时返回 409 `STATUS_CONFLICT`，不写入任何属性；提交的负责人名单须全部为同项目启用成员。

网页与 Agent 共用 `requirement-properties.ts`。每个实际变化的标题、状态、负责人或优先级各写一条审计，与业务同事务提交；属性不生成正文版本。标题 PATCH 在现有 Yjs 历史上同步兼容标题字段、修改人和收据，不替换正文。网页按 Enter 或失焦提交，非空且最多 240 字，IME 确认不误提交，失败保留输入并可重试或取消。

提交后广播 `properties`。网页 PATCH 可带 `mutationId`，通知回传该标识；发起页面使用保存响应更新本次提交的字段，避免标题与属性请求交错返回时互相覆盖，只刷新一次索引，并跳过自己操作的通知回声。其他页面合并同轮刷新；请求途中到达的新变更在完成后补读，不取消正在执行的请求。版本通知使用 `clientSaveId` 作为对应标识。字段与分页规则见 [操作日志](audit-log-plan.md)。

AI 锁有效时，普通标题、属性、正文、版本及图片写入受服务端锁检查，返回 423。锁、执行事务和离线恢复见 [Agent 文档管理](agent-editing.md)。

### 关联文档

四类文档均可关联同项目内的其他文档，不能关联自身。关系独立于正文、Yjs 和 revision，不创建正文版本，也不随版本回退。读取时返回对方当前的编号、标题、类型和状态；关联本身不写入状态、负责人、优先级的逐属性历史。

`POST /api/requirements/:id/related` 接受 `documentIds`（单次 1–100 个），去重后增量添加；不会替换已有关系。`DELETE /api/requirements/:id/related/:relatedId` 从任意一侧解除同一条关系，不删除文档。重复添加、反向添加和重复解除均幂等。整批先按统一顺序取得双方文档行锁，验证全部文档归属及 AI 锁；任一文档不可访问或持有有效锁时，整批失败。实际变更和双方更新时间同事务提交，之后向双方共同编辑房间广播 `properties`。

Agent 在 `/api/agent/v1/requirements/:id/related` 提供同样的 GET/POST/DELETE 能力，使用 `requireAgentContext` 并复用关系服务；编号先解析为本项目的真实 ID，同 PAT 持锁也不能绕过。CLI 先核验所有链接同站，独立关系操作不申请正文锁、不新增版本；输入上限在去重前检查，无实际关系变化不更新时间或广播。查询同样复用网页分页服务，协议兼容和编写后的衔接见 [Agent 文档](agent-editing.md#关联与分页查询)。

关系表依赖迁移 `0014_zippy_molten_man.sql`，本次 Agent 扩展无需新迁移。该迁移先建立文档的 `(project_id, id)` 唯一索引，再建立关联表的复合外键；迁移不改写现有正文或版本。

### 比较与撤销

版本列表默认只返回摘要及去重编辑人。详情页复用最新 revision，比较时按 ID 加载缺少的正文，在页面内缓存、支持失败重试；切页取消未完成请求，实例淘汰或销毁时释放缓存。旧版来源记录为还原名单可能仍需服务端读取对应正文，不改写历史。

选区历史在本机上下文有效后，显式使用 `includeContent=true` 读取完整相邻版本链；不能省略中间版本破坏范围投影。网页 Diff 在客户端计算；撤销只改变共同草稿，保存后才产生新 revision。算法和界面见 [编辑器与 Diff](editor-and-diff.md)。

## 核心 API

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/health` | 公开检查认证配置和认证表是否可用 |
| `GET /api/meta` | 当前项目、会话用户、可见成员和状态 |
| `GET /api/workbench/my-work?period=&date=` | 本人五项周期产出、逐日数据、覆盖与当前工作；上海自然周/月 |
| `GET / POST /api/requirements` | 服务端过滤、排序、分页摘要 / 创建文档 |
| `GET /api/requirements/groups` | 按同一过滤条件汇总各状态完整计数 |
| `GET /api/requirements/search` | 全授权范围的编号/标题检索，最多 20 条摘要 |
| `GET /api/requirements/summaries` | 核验最多 20 个指定 ID，返回摘要及不可访问 ID |
| `GET / PATCH /api/requirements/:id` | 当前元数据及最新 revision / 更新元数据 |
| `GET / POST /api/requirements/:id/related` | 读取双向关联文档摘要 / 批量增量添加关联 |
| `DELETE /api/requirements/:id/related/:relatedId` | 从任意一侧解除关联，保留双方文档 |
| `GET / POST /api/document-templates` | 模板列表 / 新建项目模板 |
| `PUT /api/document-templates/:id` | 按 version 更新模板 |
| `GET /api/requirements/:id/revisions` | 按 version 降序的摘要，含 editors/editorsIncomplete；当前未分页 |
| `GET /api/requirements/:id/revisions?includeContent=true` | 显式读取完整历史正文链；权限与摘要相同 |
| `POST /api/requirements/:id/revisions` | 保存正式快照 |
| `GET /api/revisions/:id` | 单个正式版本完整内容 |
| `GET /api/revisions/compare?baseId=&targetId=` | 返回同一需求的两个版本，不生成 Diff |
| `GET /api/requirements/:id/property-history?cursor=` | 逐属性日志，每页 50 条 |
| `POST /api/assets/upload?requirementId=` | 网页图片上传 |
| `GET /uploads/:fileName` | 授权后流式返回私有图片 |

专题接口分别见 [文档查询](requirement-queries.md)、[工作台统计](workbench-statistics.md)、[账号](accounts.md#api)、[共同编辑](collaboration.md#接口)、[草稿](drafts.md#接口与保存)、[Agent](agent-editing.md#http-入口)。HTTP 边界使用 Zod 或明确白名单，返回适当的 4xx/5xx，不透传数据库异常。分页服务及其全部前端消费者已同步切换。

文档创建与模板新建/更新支持可选 `Idempotency-Key`（12–100 位字母、数字、下划线或连字符）。迁移 `20261019132544_document_write_receipts` 新增回执表，按项目、用户、请求 ID 唯一记录操作、规范化输入摘要、资源 ID，与业务写入同事务提交，事务咨询锁合并并发重试。同键同输入领取已有结果，不增加文档或模板版本；不同操作/输入复用键返回 409。失败整体回滚，不留成功回执；未传头的旧客户端保持兼容。回执不保存正文、不增加资源 GC 引用，本机重置一并清理。

回执访问遇到缺表时返回 503 / `DATABASE_MIGRATION_REQUIRED`，其他数据库异常返回 503 / `DOCUMENT_WRITE_UNAVAILABLE`，响应只含可理解的说明，不透传 SQL 和请求参数。客户端保留原提交标识与输入，数据库修复后可继续重试；不能跳过回执逻辑来绕开缺失迁移。

模板重试返回资源当前状态；若内容已被后续修改，前端提示该次已成功但模板随后更新，保留输入并要求重新载入。超时或响应不明时客户端保留原键与输入，提供恢复上次提交内容；确认结果或明确拒绝后才开始新的提交。正式版本继续使用 `clientSaveId`。

## 图片与资源生命周期

网页上传接受 multipart `file`，MIME 须以 `image/` 开头，上限 5 MB；Agent 使用独立 PAT 入口，按文件头识别 PNG/JPEG/GIF/WebP，上限 5 MiB。两者校验方式不同，不能把 Agent 的检查描述成网页已具备。

`asset-storage` 用生成 ID 命名，本地写入私有 `ASSET_UPLOAD_DIR`，S3 写入 bucket 的 `uploads/` 前缀。数据库写入失败回删文件；正文统一引用 `/uploads/...`，切换后端无需改历史 URL。浏览器不直接访问 MinIO，由 Nitro 验证资源归属后代理。

`asset-gc.ts` 的保护范围：

- 项目模板、**全部历史 revision**、有效草稿及上传关联、当前共同文档。
- Agent 执行收据和历史建议的候选/基线、未清理快照、仍在保护期内的暂存上传。
- 默认无引用宽限期 7 天；释放引用重新计时，旧资源回退到创建时间。Agent 暂存到期后还须经过宽限期，冻结候选继续保护其引用。

引用写入与 GC 使用共享/独占事务咨询锁。dry-run 只报告候选；实际模式先删除存储对象，再删除资源记录。改 URL、节点或引用来源时同步检查 GC。实际清理前按 [开发文档](development.md#常用命令) 核对预览和任务授权。

## 全局界面与主题

- 认证中间件使用本次 `/api/account/access` 结果完成路由授权和重定向，将通过校验的结果放在目标路由的 `meta.accountAccess`。`app.vue` 在 Vue Router 确认 `currentRoute` 时同步写入全局账号/会话状态，SSR 初始渲染也使用同一结果；取消或被后续导航取代的候选结果不更新当前身份。身份及页面缓存边界与目标页面在同一轮渲染提交，避免旧页在登出跳转前重建；服务端 API 继续独立校验权限。
- `NuxtPage` 只缓存显式命名的 `RequirementDetailPage`，LRU 上限为两篇；路由键固定文档 ID，正文/比较 query 不重建实例。账号、全局角色、项目访问资格或项目角色变化会销毁缓存边界。普通业务页面仍按原路由生命周期运行。
- 详情路由外层负责初始详情/元数据的懒加载与失败重试，客户端导航不等待这些请求；SSR 仍读取初始数据。两者成功后才挂载 `RequirementDetailWorkspace`，以完整身份和文档初始化协作与草稿。加载中离开取消初始请求，返回重新读取；已初始化的工作区继续随页面缓存，沿用原来的停用/恢复保护。
- 缓存页停用后释放全局 workspace 导航锁，暂停视觉监听与协作网络。返回先由路由中间件重查账号权限，再并行读取详情与本轮协作状态；详情通过后才允许协作钩子应用响应，锁和 editEpoch 核对完成前保持只读。版本列表、关联信息在后台刷新，沿用各自的加载/错误/重试反馈，不阻塞恢复编辑；离页取消本轮请求。确认无权访问或文档不存在时，在确保未同步修改可恢复后退出并清空详情缓存；必要检查失败保留只读内容和重试入口。草稿与 Yjs 的具体约束见对应专题。
- `AppShell` 组合固定 64px 的 `AppHeader`、可从 224px 收至 0 的 `AppSidebar` 和页面滚动区；≤700px 使用覆盖导航。侧栏宽度由 `--app-sidebar-width` 统一控制，导航用 NuxtLink custom 插槽接入 BingButton。全局新建只在 Header 挂载，`useBoardMeta` 按账号及固定项目共用元数据并合并并发请求。布局、偏好与焦点规则见 [UI 规则](ui-rules.md)。
- S3 已将文档列表/分组、搜索、最近浏览和关联候选迁移到服务端分页或受限摘要接口。`useRequirementCache` 只保存按范围读取的结果，不再维护全量索引；请求、失效和组内页码规则见 [文档查询](requirement-queries.md)。首页工作台的四个区块各自从只读事务聚合，数字与列表筛选同口径，不使用图表库，见 [首页工作台](workbench-home.md)。
- 界面、正文和代码统一优先 Maple Mono NF CN，`main.css` 声明 400/700/800 字重，本机字体缺失时加载仓库 WOFF2，使用 font-display: swap；保留 `public/licenses/MapleMono-OFL.txt`。
- `AppPageScrollbar` 是侧栏右侧（简化页为 Header 下方）的页面滚动视口，html/body 不滚动。sticky top 相对该视口，编辑器高度计算包含其 scrollTop；`pageScrollViewportKey` 提供 viewport，路由处理回顶、锚点及会话内历史位置。
- `useAppTheme` 提供 light/dark/system，`rb-theme` Cookie 有效一年，SSR 输出 `data-bing-theme`；无效值回到 system。`--rb-*` 映射组件语义色，浮层继承根主题。
- “设置”通过 `useAppPreferences` 保存指针开关、正文/代码字体、字号、亮暗颜色、行高、正文宽度和辅助面板宽度；`rb-preferences` Cookie 仍为版本1、有效一年，旧值缺少 `editor.panelWidth` 时补360，缺少 `editor.fonts` 时补 `{ body: null, code: null }`，其余有效偏好保留。正文默认880px，面板320–560px；写入后读回确认，失败保留当前效果并提供重试。外观/阅读分类分别恢复默认，仅改显示，不改正文、Yjs 或版本。
- 字体 `null` 表示默认 Maple Mono NF CN。字体名最长64字符，仅允许中英文字母、数字、空格、短横线、下划线和点，非法整串回退默认。`appPreferenceHtmlAttrs` 在 SSR 首屏输出带引号的 `--rb-editor-font-body/code`，后接 `--font-main` 字形回退链；不改全局界面字体。本机字体系列列表经校验、去重后缓存到当前站点的 localStorage（`rb-local-fonts`，版本1），关闭设置及刷新后恢复，不上传、不写 Cookie；Cookie 只保存选中的系列名。重新读取成功时替换缓存，拒绝权限不清空旧列表；缓存损坏时忽略，存储失败时保留本页内存结果并提示刷新后需重读。
- 全站只挂载一个 BingCursor，使用纯黑主体、白色描边，默认关闭；关闭时通过公开 disabled 属性恢复原生指针。已有 Cookie 中明确保存的开启/关闭值继续生效，不迁移或重写历史偏好；新默认值用于未保存该选项的浏览器及主动恢复外观默认值。正文插入光标属于编辑器扩展。
- 各滚动区复用 BingScrollbar，固定预留轨道空间，居中页面左右对称。控件接入见 [bing-ui](bing-ui.md)，工作区断点和版本交互见 [编辑器与 Diff](editor-and-diff.md#详情工作区与版本选择)。

## Schema 与契约变更检查

检查 relations、外键/索引/删除策略、seed 与测试 fixture、API DTO、迁移 SQL/snapshot/journal；认证变更还检查 Better Auth 映射和请求上下文。

持久化正文变化须同时覆盖旧 JSON 兼容、纯文本提取、编辑器、Diff、只读渲染、草稿撤销和资源引用。按 [验证矩阵](development.md#按改动选择验证) 执行相关测试，同步所属专题文档。
