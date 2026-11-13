# 文档分页与查询

查询契约定义在 `shared/requirements/query.ts`，SQL 实现在 `server/services/requirement-queries.ts`。网页入口使用 `requireAppContext`，Agent 使用 `requireAgentContext` 验证 PAT，均限定当前账号的固定项目，响应禁止缓存；调用方不能传入 projectId 或其他账号来扩大范围。两者共用过滤、搜索规范化、排序和只读分页服务。

## 当前接入状态

S3 已将 `GET /api/requirements` 切换为分页对象，并同步迁移文档列表/分组、快速搜索、最近浏览、关联候选、创建和详情失效逻辑。旧的 `useRequirementIndex` 与 `useRequirementBoard` 已移除，没有保留全量入口。REQ-26 起首页改为个人工作台，使用专用聚合接口，其数字与本文的列表筛选保持一致，详见 [首页工作台](workbench-home.md)。

## HTTP 入口

| 路径 | 参数 | 响应 |
| --- | --- | --- |
| `GET /api/requirements` | 公共过滤条件、page、pageSize、sortBy、sortOrder | items、total、page、pageSize、asOf |
| `GET /api/agent/v1/requirements` | 同上，PAT；新客户端显式传 page/pageSize | 同上；无参数或仅 q 时保留旧 CLI 的最多 100 条数组 |
| `GET /api/requirements/groups` | 公共过滤条件 | groups、total、asOf；包含项目内计数为 0 的状态 |
| `GET /api/requirements/search` | q，limit 默认 20、范围 1–20；recentIds 最多 20 个 | items、hasMore、asOf；空白查询返回空集合 |
| `GET /api/requirements/summaries` | ids，1–20 个；可用重复查询参数或逗号分隔 | items、requestedIds、unavailableIds、complete=true、asOf |

未知参数、重复标量、非法类型或越界值返回 400。q 最多 240 字；ID 最多 160 字，不能是空字符串。ID 列表按输入顺序去重，数量限制在去重前检查。摘要只返回编号、当前标题、类型、优先级、时间、状态、报告人和完整负责人名单，不返回正文、邮箱或其他账号字段。

summaries 保留请求顺序；unavailableIds 只说明本次请求中哪些 ID 不可访问，不区分不存在和跨项目。只有一次成功响应的 complete 和 requestedIds 能证明这批 ID 已完整核验，不能用搜索页、列表页或请求失败来清除最近浏览。

## 分页服务契约

`requirementPageQuerySchema` 接受公共过滤条件，以及 page（默认 1）、pageSize（默认 20，范围 1–100）、sortBy 和 sortOrder（asc/desc，省略按 asc）。page 必须是正整数且计算出的 offset 是安全整数；sortOrder 不能单独传入。返回 `{ items, total, page, pageSize, asOf }`，合法越界页返回空 items 和真实 total。

公共过滤条件采用交集：documentType 匹配文档类型，statusId 匹配状态，assignee 可为当前账号 `me`、未指派 `unassigned` 或指定用户 ID，reporter 可为 `me` 或指定用户 ID，`stale=1` 只保留停滞文档（规则与首页共用，见 [首页工作台](workbench-home.md#停滞)），excludeId 排除一个文档。负责人使用 EXISTS 筛选，多人不会重复计数。组计数复用相同过滤，不从当前页推算。

每次查询在只读 REPEATABLE READ 事务中计算总数、条目和负责人，以事务时间提供 ISO 格式 asOf；同一响应不会混合不同提交时点的数据。不同请求各有独立快照，不承诺跨页锁住整个数据集。

Agent 的 paginated_search 能力在 schema 的能力版本 9 声明。新版 CLI `list` 默认显式传 page=1、pageSize=20，并从响应派生 hasMore/nextPage；空结果和合法越界页无下一页。旧无参数/仅 q 请求的数组也使用同一服务，但不作为“已查全”的证据。完整命令和失败恢复见 [Agent 文档](agent-editing.md#关联与分页查询)。

## 搜索和排序

搜索仅匹配编号和标题。`shared/requirements/search.ts` 统一 NFKC、Unicode 小写、ECMAScript 空白字符、多词均命中及编号空白/下划线/连字符兼容；SQL 使用绑定参数并转义 LIKE 的百分号、下划线和反斜杠，用户输入不成为通配模式。

数据库要求 UTF-8，并提供 ICU 根语言排序规则 `und-x-icu`，用于与 JavaScript 一致的小写转换；仓库配置的 PostgreSQL 17 Alpine 提供此规则。其他部署镜像须先核验，不能退回数据库默认语言规则而悄悄改变搜索结果。

无查询词且未指定排序时，按更新时间降序、编号数字降序、ID 升序。有查询词时，按编号完全匹配、编号前缀、标题前缀、其他匹配排序，再按更新时间降序和 ID 升序。快速搜索在相同相关度下优先 recentIds 的输入顺序；这些 ID 只影响排序，不扩大读取权限。

sortBy 白名单为 key、title、documentType、status、priority、assignees、reporter、createdAt、updatedAt。编号按数字，优先级按低/中/高，日期按时间。其余按显示文本的 Unicode 码点顺序（数据库 `COLLATE "C"`），与用户语言环境无关；相同值始终按文档 ID 升序。类型使用中文标签，状态和报告人使用名称。负责人先按姓名、用户 ID 排序，再以全部姓名用“、”连接；未指派为空字符串，不能只取第一人。

## 前端请求和视图状态

`useRequirementCache` 按当前账号与固定项目隔离摘要、查询缓存和当前标签页状态。查询键包含视图/组、完整过滤、排序、页码、条数，最多保存 100 个查询结果及 1000 条摘要，结果缓存 60 秒；收到新服务端摘要才清除该 ID 的旧标题覆盖，命中旧查询缓存不会倒灌覆盖较新摘要。注销、换账号或失去权限清空；普通请求失败保留成功数据。

`useRequirementQuery` 将 target/pending 与 committed 分开，行、页码、排序标记和 total 都来自成功结果。相同条件的在途请求合并；操作成功后的多次失效在请求结束后顺序补读，不取消原请求。切换条件用 AbortController 和序号丢弃旧结果。`usePagedRequirements` 对合法越界最多补查一次最后有效页，空集合保持第一页。错误提示保留重试失败条件的入口。

`PagedRequirementTable` 只监听 `page-change` 发分页请求，排序/筛选/条数变化回第一页；`RequirementTable` 同时启用 remotePagination 与 remoteSort，传真实 total，不再次切片或排序。文档及各组默认 10 条、可选 10/20/50，七列，标题可换行。URL 带任一筛选参数（q、documentType、statusId、assignee、reporter、stale）打开列表时以 URL 为准替换已保存的筛选；提出人和停滞以可移除的标签显示。筛选、视图、各表页码/排序及列设置保留在账号隔离的会话状态中，前进后退滚动沿用 AppPageScrollbar。

分组先加载完整计数，首次只打开第一个非空组；其他组展开时才请求，收起取消未完成请求并保留已成功页。所有组及列表共用一份列偏好，分组视图只显示一个独立 `BingTableColumnControls`，全部折叠时仍可设置。关联弹窗每页 8 条，由服务端排除当前文档，选择集合与页数据分离。

创建、标题/属性、版本及关联成功后失效相关查询；当前挂载且可见的查询按既有操作通知及窗口重新聚焦更新。没有增加全站通知或轮询。Header 不请求全量文档；快速搜索按输入按需查询，最近浏览在打开时最多核验 20 个 ID。

## 验证入口

- `tests/diff/requirement-query.test.ts`：参数边界、规范化、文本及完整负责人排序。
- `tests/api/requirement-queries.cases.ts`：真实数据库分页、完整过滤计数、跨页顺序、特殊字符与 Unicode 搜索、摘要确认范围、权限和独立标题更新。
- `tests/diff/requirement-navigation-state.test.ts`：失败保留/重试、越界、乱序、账号隔离、同条件去重、最近浏览完整核验。
- `tests/browser/requirement-pages.ts`：45 条真实文档下的跨页排序、分组按需读取、共享列设置、首页独立分页及跨页搜索/关联/最近浏览；由快速切换脚本运行。
