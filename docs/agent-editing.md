# 本机 Agent 管理文档

用户自己的 Agent 通过 Skill 和受限 HTTP API 查找、读取、新建、修改文档、上传图片、比较版本及追溯文本。应用不内置模型或 MCP。安装与凭证入口在个人账号页；实际命令、JSON 示例分别见 [配置](../skills/requirement-board/references/setup.md)、[操作](../skills/requirement-board/references/operations.md)、[历史查询](../skills/requirement-board/references/history.md)。

## 执行与版本语义

`$requirement-board <任务>` 默认直接执行，无网页审核。普通修改更新共同草稿；**只有用户明确要求保存正式版本，才填写 saveRevision.changeNote**。只读分析不写入，修改/补充文档不等于保存版本。版本说明须概括相对最近正式版本的全部变化，包括已有人工草稿。

新建可选 requirement/defect/instruction/todo，默认 requirement；需求、缺陷、待办从待处理开始，说明从草稿开始；一次创建完整正文、属性、v1 和持久化 Yjs。属性修改走共享服务，标题/状态/负责人/优先级独立记日志；`set_title` 即使不带 saveRevision 也更新当前标题和兼容 Yjs 字段，不生成正文版本。历史版本保留保存当时的标题快照。

## 页面行为

人工与 AI 的变化统一在正文和版本比较中查看。“已修改”只依据当前正文与最新正式版的语义比较，初始化显示核对中；标题改名和其他属性不影响该标记。同步和个人检查点不等于正式保存。比较规则见 [编辑器文档](editor-and-diff.md#详情工作区与版本选择)。

仅持锁时显示 AI 编辑人、到期时间和取消入口，桌面在侧栏、窄屏用弹窗，不挤占正文。旧 `/requirements/:id/suggestions/:suggestionId?` 转到需求页，`/agent-suggestions/:id?` 转到列表；旧待审核记录保留且不自动执行。

## 安装、配置和凭证

### 从网页传递 AI 标注

正文选中文字后可「添加 AI 标注」，在选区旁的紧凑浮动输入框填写要求，右侧按钮用于取消和保存；填写期间先保存或取消，再操作页面。多行选区的输入框位于整块上方，编号位于左侧页边。右侧 AI 标注页签支持编辑、删除、定位、整体要求、批量复制和预览。点击标注会平滑滚动到原文并短暂强调目标，多行定位到选区起点。标注只存本浏览器 localStorage，按账号与文档隔离，不进入正文 JSON、Yjs、undo、正式版本或普通正文复制。编号及高亮为正文外的浮层，不改变正文布局；侧栏关闭时添加标注不自动展开侧栏。

列表顶部的「清除全部」经确认后清除当前账号、当前文档的全部本机标注，包括已失效的标注；同步移除编号、高亮和旧复制预览，刷新后仍保持清空。正文和整体要求保留，其他文档及账号的标注不受影响；取消不作修改。没有标注或正在准备复制时按钮禁用。

「复制给 AI」先提交待同步编辑并核验连接与 editEpoch，再计算 contentToken，生成 `rb-annotations/v2`，声明 schema 3、capabilities 8、image_read 和 node_annotations。新目标为 text 文字范围或 node 节点整体；nodeType/version 与共享注册表及 schema.annotationNodes 核对，旧 image/table/cell 目标保持兼容。剪贴板只保留 Skill 入口与代码块。文字保留 diffId/topLevelId、Unicode 范围和上下文；节点携带身份、内容签名和最多 256 码点摘要，适配器 context 保存资源或所属表及逻辑跨度。全表和图片字节不进入请求。网页、schema 与 Skill 共用 annotation-node-capabilities.mjs 注册表及 annotations.mjs、annotation-objects.mjs 核心；每篇最多 30 条、每项/整体要求最多 2000 字符、实际 JSON 最多 1 MiB，超限保留标注并提示。失败提供预览和手动复制。新增节点接入见 [节点标注能力](annotation-nodes.md)。

对象入口、失效规则和浮层行为见 [编辑器文档](editor-and-diff.md#ai-标注与正文隔离)。v2 completion 绑定复制时原始 target、范围、签名和要求，不使用重定位或修改后的正文。旧本机文字标注继续按原 v1 摘要核对，重新复制才转为 v2；旧 v1 请求可在新版快照重新定位，不清空存储。旧 v2 对象保留原 target 与冻结签名规则，重新复制也不转换为 node，可与新标注混用并消费原回执。

手动输入、删除或粘贴若会使标注失效，网页先提示「如果继续输入会清除这个标注，你确认吗？」。确认清除受影响的标注并执行本次修改；取消保留原文和标注。中文输入在开始组词时先确认，确认后继续输入。没有成功回执的外部更新仍保留失效提示，不能把原文变化当作任务完成。

Agent 按 [标注流程](../skills/requirement-board/references/annotations.md) 获取最新快照，运行 `annotations --file annotations.md --snapshot snapshot.json --out resolved.json`，仅 ready 为 true 时继续。`new --snapshot snapshot.json --annotations annotations.md --out action.json` 再次校验定位并携带 completedAnnotations；按 comment / overall 修改共同草稿，不默认保存版本。旧格式仍可读取，没有 completion 的复制内容不会自动清除。

completedAnnotations 只包含标注 ID 和摘要，随执行请求冻结在 `agent_suggestions.completed_annotations`；只有 applied 收据可用于清理。网页通过 Cookie 身份向 `/api/requirements/:id/annotation-completions` 提交当前标注摘要，服务端限定当前项目、文档、发起人和执行成功状态，返回匹配项。页面打开、回到前台、网络/协作连接恢复、editEpoch/锁变化和标注要求变化时核对；不做空闲轮询。刷新或关闭再打开可补查，查询失败保留标注。网页核对返回摘要后只清除仍相同且未正在编辑的标注，同时清理高亮和编号、保留正文与整体要求；后来编辑的要求、整体要求或新增标注不受旧回执影响。查询中切换账号/文档或卸载会丢弃响应，多标签变化先同步再核对。

标注用于本次人与 AI 的临时沟通，继续只保存在本机，不引入共享标注或已解决事项。网页先把过滤后的标注列表成功写入并回读 localStorage，再更新页面并向 `POST /api/requirements/:id/annotation-completions/ack` 确认；本机写入失败时保留标注和回执。确认仅移除当前账号、文档中成功操作的匹配 ID/摘要，部分确认保留其他条目，全部确认后字段置 NULL；单条原子更新保证并发和重复确认安全。确认网络失败不恢复已清除的标注，也不新增本机任务队列，由服务端有效期兜底。

完成信息从成功时间 reviewedAt 起保留 7 天，兼容缺少成功时间的旧行时使用 createdAt；查询和 Agent 操作返回立即过滤已过期条目。Nitro 的 annotation-completions 插件在启动和运行期间每小时回收过期字段，慢任务不重叠，失败记录错误并于下一周期重试，关闭时停止定时器并等待当前任务。失败、取消或长期未完成操作的临时字段也按 reviewedAt / createdAt 回收。服务停止期间不运行，重启后补清；实际物理回收可能晚于过期时间一个扫描周期。原有操作行、请求哈希、正文、历史版本和审计记录保留；过期后网页残留的标注可手动清除。

### 安装边界

- Node.js 22+，无需 npm install。账号页提供安装/更新/卸载链接及通用 Skill 包；包不含配置或凭证。
- Skill 在 Codex 用户目录的 `skills/requirement-board`，配置独立放在 `requirement-board/config.json`，支持 CODEX_HOME。多站点配置 v2 兼容旧 v1，读取或更新 Skill 不触发迁移；添加配置保留原默认站点和其他凭证。已有同站点配置自动复用，configure 只配置站点、不替换已安装文件；Windows 可由安装器打开独立终端。
- 更新只替换 Skill 并备份旧目录，保留 URL/Token；成功安装、更新或卸载后自动保留最近 3 份备份，始终保留本次恢复点。仅回收符合安装器命名及 Skill 身份的普通备份目录，手动备份和链接不处理；操作失败不清理，清理失败提示并于下次成功操作重试。卸载默认保留配置，明确要求才使用 --purge-config。更换站点/Token 用 configure，不借更新静默切换。
- 安装器校验包边界、拒绝链接/越界/损坏/超限包；下载不携带 Token、不跟随重定向。退出码 0 成功、2 需配置、130 取消；更新后重读 SKILL.md。
- PAT 为 32 字节随机值，库中只存 SHA-256，创建成功仅显示一次。默认有效 30 天，可选 1–90 天，每人最多 10 个有效凭证。
- 本人凭证列表采用服务端分页：page 默认 1，limit 默认 10（1–100），status 为 all/active/expired/revoked；未知参数返回 400。返回 items、total、page、limit、activeCount、asOf，同一只读快照计算本页、筛选总数和全部有效数，按创建时间与 ID 倒序。列表仅返回 id/name/createdAt/expiresAt/revokedAt，不能读明文或哈希。
- 状态以响应 asOf 判断：撤销优先，否则 expiresAt 小于等于 asOf 为过期。网页默认显示有效凭证，每页可选 10/20/50，仅总数超过一页时展示分页与条数选择，筛选或条数变化回第一页。三个状态标签的数量来自各状态分页响应的 total，另两个历史状态只请求 1 条以取总数；有效项最多读取 10 条用于全范围到期提示，不下载全部历史。单轮列表和摘要全部成功才一起替换，失败保留旧结果并可重试，迟到请求不覆盖新条件。不同状态请求各自保持服务端快照，不承诺多请求间严格一致的数据库时点。
- 创建后返回有效列表第一页；只有有效凭证显示撤销入口，确认成功后刷新，筛选页越界时最多补查一次末页，零条保持第一页。有效数不随筛选变化，未加载成功时显示未知。前台空闲每 60 秒重新读取，弹窗操作时暂停，卸载停止；日期旁展示剩余天数，7 天内到期显示提醒。≤640px 使用卡片及相同服务端分页，权限、数量上限、一次性明文和接口均不变。引导本机进度及账号隔离见 [个人账号页](accounts.md#使用入口)。
- 每次 PAT 请求检查过期、撤销、账号启用和当前项目权限，以凭证用户记实际操作者、节点名单和执行收据。
- CLI 按完整文档链接或 `--site` 选择精确配置，未匹配时仅回环 origin 可使用显式开启的 localPorts 本地配置；其他未知站点拒绝，不尝试默认凭证。无站点线索才使用默认站点，不维护可变的“当前站点”。公网 HTTPS、loopback 可 HTTP，不跟随重定向。`RB_BASE_URL/RB_TOKEN` 必须成对覆盖，不混用配置来源；与目标 origin 冲突时拒绝。
- `sites` 只显示站点、别名和 localPorts 开关。用户确认本地 worktree 共用数据库时，configure 追加 --local-ports 一次启用本地通用配置，随后任意回环端口无需逐个关联；精确站点和别名优先，不自动改写配置文件。通用配置最多一份且来源必须为回环地址，生产凭证不能启用。不同数据库单独 configure。仍支持 `install.mjs alias --from <已有本地 origin> --base-url <新本地 origin>` 显式关联指定端口，先验证目标 schema，拒绝覆盖独立配置。
- read/snapshot 和新请求文件带有 CLI 专用的 siteOrigin；new、validate、submit、renew、release 按文件继续路由，与显式站点或标注来源冲突时拒绝。提交时移除此字段，不改变服务端严格 API 或幂等摘要；旧文件仍可显式指定 --site。
- Token 仅在终端隐藏输入，不作命令参数或进入聊天/日志。配置验证后加锁合并并原子保存，Windows 用目录 ACL，其他系统目录 700/文件 600；取消或失败不覆盖原配置，不修改全局环境和 Codex config.toml。调试 Skill 可直接运行 worktree 中的 rb.mjs，共用本机配置；验证后用 update --from-bundle 同步已安装文件。

Windows 通过 `whoami.exe /user /fo csv /nh` 获取用户 SID，同一进程的并发与后续写入复用成功的身份查询，查询失败后允许重试。每次配置或缓存写入前仍执行目录 ACL 设置；不缓存“目录已安全”的结论，权限设置失败继续中止写入。这样可避免连续 CLI 操作反复启动 PowerShell。

## 读取与编辑流程

会话首次使用或更新后读 schema。list/related/read/status/meta/log/show/diff/history/property-history 均不加锁。修改已有文档直接 snapshot，在加锁请求内条件读取，避免先 read 再全量读取；新建用 new --create。

validate 只计算候选，不落盘文档或冻结新 ID；submit 冻结后直接执行，返回 applied、documentUrl 及可选 revision。**只有返回 revision 才能报告已保存正式版本**。未执行而结束任务时释放锁；响应丢失用原 requestId 和原文件重试。

### 快照与锁

`agent_snapshots` 保存不可变标题、JSON、签名、schemaVersion、editEpoch、属性和最近正式版本 ID。客户端只给 snapshotId，不能自报基线。read 使用已持久化草稿；尚未初始化协作时读最新 revision，不创建 Yjs。

快照和锁在单需求写入队列、同一事务内取得。每需求最多一锁，绑定快照、凭证和执行请求，重启仍有效；默认 30 分钟，续期不能超过凭证/快照有效期，快照最多 24 小时。同一凭证重复 snapshot 复用基线、不续期；其他凭证返回 423 REQUIREMENT_LOCKED。

持锁期间所有网页成员（包括发起人和管理员）只读；edits、保存版本、PATCH、网页图片上传均检查锁，WebSocket 不能绕过。持锁 PAT 可上传图片，其他 PAT 返回 423。已确认收据可重试确认，个人检查点仍可备份。

发起人或系统管理员可取消；Agent 只能用本凭证续期/释放。成功、取消、过期、凭证失效或失去权限都会使锁失效；页面每 10 秒及到期时复核，其他变化通过 WebSocket。取消同时终止本轮待执行请求。

### 执行、幂等和冲突

执行收据沿用 `agent_suggestions`，新请求固定 takeover；pending 表示已持久化但未完成，不表示待审核。创建请求执行前 requirementId/snapshotId 可空，完成后回填。

- 同一用户/requestId 加请求哈希保证幂等：相同请求返回原结果，不同内容返回 409 IDEMPOTENCY_CONFLICT；旧 review 记录不能重放为直接操作。
- 更新时锁需求、共同文档和请求行，避让其他有效 AI 锁；核对标题/正文签名及 schemaVersion，属性只比较本次写入字段，保存版本另核对最新版本基线。不符返回 409 STALE_BASE。
- 中断的冻结请求允许原锁过期后按上述条件恢复；新提交、validate 和续期仍须原锁有效。
- 从持久化 Yjs 复制并通过 ProseMirror/Yjs 映射应用操作，结果须等于冻结候选；不能从候选 JSON 重建 Yjs。
- 同事务写 Yjs、派生 JSON、修改人、编辑收据、属性与日志、可选 revision 和执行状态，提交后广播。失败整体回滚但保留执行收据供重试。
- 重试不重复修改、日志、epoch 或版本，只删除对应快照的锁；回执描述当次结果，下轮仍重新读取当前状态。completedAnnotations 是可消费的临时信息，确认或到期后可为空，重试不能恢复它；操作是否成功仍以 status 为准。

### 旧页面和离线输入

取得新锁及执行更新时推进 editEpoch；普通编辑、续期、解锁不推进。edits 和共同保存携带 epoch，缺失视为 0；先识别已确认收据，再拒绝未知旧代次。

无未确认输入的页面自动跟随新草稿。锁前未确认输入或来源不明的旧备份保留本机副本，不自动补交旧 CRDT；导出包含正文、Yjs、原事件和图片字节，标为 recoveryOnly 继续保存，再加载最新状态。恢复边界见 [草稿文档](drafts.md)。

## 格式与图片

`shared/agent/suggestions.ts` 定义请求，`/schema` 当前 schemaVersion=3、capabilitiesVersion=13，复用真实编辑器 schema。13 新增 `details`，在 nodes、rules.details 和 examples.details 导出折叠块结构与约束：details 按顺序包含 detailsSummary（text*）和 detailsContent（block+）；details 与摘要都有稳定 diffId，内部修改替换所在顶层块并保留各层 ID。展开状态是本机视图状态，open/hidden 属性拒绝写入；整块标注支持 details，文字标注支持摘要与内部文字块。12 新增 `task_lists`，在 nodes、rules.taskLists 和 examples.taskList 中导出 taskList/taskItem 结构、boolean checked、稳定 ID、嵌套和文字标注规则。勾选属于正文语义，省略 checked 默认 false，不回写历史版本。11 新增 `callout_tones`，在节点 attrs 和 rules.callouts 中导出 note/说明、tip/建议、warning/注意、danger/风险的枚举及用途；未知值拒绝，省略默认 note，不改变历史 JSON、正文 schema 或节点标注版本。10 精简状态流程：`workflows` 改为各类型的 `initial`、`states` 与 `transitions: 'any'`，同类型内任意切换；9 新增的 document_relations、paginated_search 及其输入契约保留，另保留类型、image_upload、image_read、conditional_read、diff、text_history、annotation_completion、node_annotations 及 v1/v2 目标类型声明。annotationNodes 从共享注册表导出各节点能力版本。缺失本次所需能力时 Skill 更新一次并重查，不自动降级；旧 capabilities 7/8 的对象与节点标注请求继续按原要求检查，业务能力增加不改变正文节点协议或网页标注要求。

正文操作为改标题、替换/插入/删除顶层块；嵌套修改替换所在顶层块。替换保留目标及存活子块 ID，新增省略 ID 由服务端分配；挪用/重复 ID、未知节点属性、非法嵌套或图片归属均拒绝。最多 100 条正文操作，请求和候选各不超过 4 MiB；operations 可空，用于只改属性或只保存版本。不支持跨文档原子批量、普通文件附件或自动冲突合并。

AI 创建和修改候选在冻结/执行前与网页统一尾段规则：末尾是图片、表格、代码块、列表等非 paragraph 时，由服务端补一个带 ID 的空 paragraph；已有普通段落、文字和额外空段原样保留。可选正式版本与共同正文使用同一规范化结果，打开网页不再补出新的版本差异；删除唯一必需尾段后会按规则补回。历史快照和已有尾段差异保持原样，不为旧数据增加比较兼容。

assigneeIds 为完整名单，四类文档均可多人，空数组清空分配；不再接受旧 assigneeId。分配保存在关联表，读取、快照及冲突检查使用完整名单，状态只能使用该类型的可用状态，规则见 [类型文档](document-types-and-templates.md#状态流程)。

PAT 图片上传使用 multipart file，query 为 uploadId 加 requirementId/createRequestId（二选一）；文件头限 PNG/JPEG/GIF/WebP、最大 5 MiB。返回可插入 image 节点，上传本身不改正文或建版本。

上传回执绑定用户、项目、目标及字节 SHA-256；相同 uploadId/内容/目标返回同资源，不同则 409。上传任务有 Agent 命名空间，与网页任务隔离；数据库登记失败回删文件。

创建前图片暂存 24 小时，只有同用户、项目和 createRequestId 可引用。validate 不绑定，创建事务绑定冻结候选引用；已提交请求不能追加上传。冻结候选持续保护资源，未使用暂存图在到期加宽限期后才可 GC。全部历史版本及其他保护源见 [资源生命周期](architecture.md#图片与资源生命周期)。

## 关联与分页查询

`related`、`link`、`unlink` 使用 PAT 专属入口，内部复用 [双向关联服务](architecture.md#关联文档)。CLI 在任何请求前检查源、所有目标链接与 --site 同站，API 按项目逐个将编号解析为真实 ID。增量添加的 1–100 上限在去重前检查；共享事务按统一顺序取得全部文档行锁，再次验证归属及 AI 锁。任何一侧有效锁（包括当前 PAT 的锁）均返回 423，不预先申请正文编辑锁。失败整批回滚；无实际变更不更新时间或广播。响应提供当前关联摘要和 documentUrl，不读写正文、Yjs 或版本，也不写属性日志。

创建/修改先恢复并确认原操作成功及实际文档 ID、自动解锁，再关联并核对。关联失败保留已成功正文，只处理失败关系；响应不明先只读核对，按仍有效的用户意图重试，不自动重放并发相反操作。关系沿用状态幂等性，不新增回执表。标题歧义需要消歧，正文引用不自动触发关系。

新版 `list` 要求 paginated_search，始终显式发送 page/pageSize（默认 1/20），与网页共用 [查询契约](requirement-queries.md)。筛选支持 q、documentType、statusId、assignee、excludeId，me 使用验证后的 PAT 用户，不能传入账号或项目来扩大范围。items、total、page、pageSize、asOf 来自同一只读事务；CLI 派生 hasMore/nextPage，空结果及越界页没有下一页。用户要求全部时逐页读取并按 ID 去重，中途失败明确尚未查全；跨页不承诺固定数据库快照。

兼容旧 CLI：仅 q 或无查询参数仍返回最多 100 条裸数组，但数据改用同一查询服务、规范化与排序。携带分页、筛选或排序参数时返回分页对象，缺省 page/pageSize 为 1/20；未知及重复标量参数全部拒绝。新版 CLI 检查能力且拒绝旧数组，不静默降级。参数、示例和恢复说明见 [Skill 操作说明](../skills/requirement-board/references/operations.md#分页查询)。

## 条件读取与本机缓存

read/snapshot 接受 ifContentToken，标识由 schemaVersion 与共同标题/正文签名构成，包含 diffId；块身份变化也使编辑缓存失效。read 用 repeatable-read 取得一致内容、属性和版本摘要，snapshot 在锁事务中检查命中。

| 请求/选项 | 行为 |
| --- | --- |
| read/snapshot 命中 | 服务端 notModified=true，省略 title/contentJson，元数据仍更新 |
| status | 永远不返回正文；modified 对比最新正式版，属性不影响该标记 |
| CLI 默认（含 --json） | 命中缓存时省略 contentJson，返回 contentOmitted 与读取提示 |
| --full | 条件请求后用缓存补齐完整输出 |
| --out | 始终写完整正文，终端只报告写入结果 |
| log/revisions | 只返回摘要，无 contentJson/contentText/节点 attribution |
| show/revision | 按需读取正式版本全文 |

CLI 缓存在 Codex 专用目录 `requirement-board/cache`，按站点和凭证摘要隔离、原子替换并校验完整性；损坏回退完整读取，每次仍认证。submit/operation 只用实际冻结执行结果更新缓存，包括最终 ID，validate 候选不能写缓存。

快照 ID、锁、属性和版本基线始终取最新响应。缓存可跨会话，命中不代表模型已读；上下文不足时须读相关正文，不能用省略内容的摘要替换全文。缓存写失败不能把已成功的服务端操作报成失败。服务端签名仍读取持久化内容，这项优化不代表无需扫描正文。

## Diff 与文本历史

diff 默认 latest → draft，可用 vN、revision ID、latest、draft。复用 buildRichTextDiff，输出标题、统计、章节、节点、格式与表格变化；默认每页 30 个变化块、最多 100。翻页携带 offset/comparisonToken，内容变化返回 409 DIFF_CHANGED；stat=true 只返回摘要。

history 用准确文本或块 ID 沿相邻链追溯；重复文本返回候选与 Unicode start，可用 block/start 消歧，at 指定旧版本。最多 200 个相邻正式版，超限明确 truncated/history_boundary；不能将查询边界当首次出现。

记录包含 explanation、comparedTo 和 exact/inferred/lost 置信度；保存人与节点参与者分开，不提供逐字作者或输入时间。introduced+lost 映射为 tracking_lost；introduced+exact 仅表示最早可查记录，不能证明创作时间。CLI 对旧服务端同样解释，不给不确定边界加确定新增的“+”。

## HTTP 入口

账号和公开安装入口使用完整路径：

| 入口 | 认证 / 用途 |
| --- | --- |
| GET/POST `/api/account/agent-tokens` | Cookie 与项目访问权；本人凭证分页/创建 |
| POST `/api/account/agent-tokens/:id/revoke` | Cookie；撤销 |
| GET `/api/account/agent-skill` | Cookie；通用 Skill 包 |
| GET `/api/agent/setup?action=install\|update\|uninstall`、`/api/agent/skill` | 公开；操作说明/无凭证下载 |
| GET/POST `/api/requirements/:id/agent-lock` | Cookie；读锁/发起人或系统管理员取消 |
| POST `/api/requirements/:id/annotation-completions` | Cookie；只读查询本人当前文档中已执行成功、摘要匹配且未过期的标注回执 |
| POST `/api/requirements/:id/annotation-completions/ack` | Cookie；网页持久化清除后确认，按 ID/摘要回收本人当前文档中的完成信息；可重复确认 |

以下路径统一加前缀 `/api/agent/v1`，每次请求验证 Bearer PAT：

| 方法与相对路径 | 用途 |
| --- | --- |
| GET `/schema`、`/meta` | 协议 / 已授权选项 |
| GET `/requirements?page=1&pageSize=20&q=` | 全授权范围的分页、筛选与排序；仅 q 或无参数保留旧数组兼容 |
| GET/POST `/requirements/:id/related` | 当前关联摘要 / 增量添加 1–100 个输入目标 |
| DELETE `/requirements/:id/related/:relatedId` | 从任意一侧解除指定关系 |
| GET `/requirements/:id`、`/requirements/:id/status` | 条件读取 / 无正文状态 |
| GET `/requirements/:id/revisions`、`/requirements/:id/show?version=` | 版本摘要 / 指定快照 |
| GET `/revisions/:id` | 完整正式版本 |
| GET `/requirements/:id/diff`、`/requirements/:id/history` | 比较 / 文本历史 |
| GET `/requirements/:id/property-history?cursor=` | 属性日志，每页 50 条 |
| POST `/assets/upload` | 图片上传 |
| GET `/requirements/:id/images/:diffId?snapshotId=` | 按文档实际引用只读获取站内原图；snapshotId 可选，须为本人有效锁快照 |
| POST `/requirements/:id/snapshot` | 锁定并条件读取 |
| POST `/requirements/:id/lock` | snapshotId + renew/release |
| POST `/operations/validate`、`/operations` | 验证候选 / 直接执行 |
| GET `/operations/:id` | 本人执行收据 |

需求读取及 snapshot 接受内部 ID 或 REQ-编号，锁操作使用快照内部 ID。精确参数见共享 schema 和 [Skill 操作说明](../skills/requirement-board/references/operations.md)。

旧 suggestions 系列接口认证后统一返回 410 AGENT_REVIEW_REMOVED，不静默转写入。新 operations 不需 X-RB-Mode；旧 takeover 头和 CLI -t/--takeover 仅兼容直接语义，其他模式返回 400。

## 部署与验证

原图读取重新校验 PAT、成员/项目和真实文档引用，再检查资源归属；不创建快照或锁，不写正文、版本、编辑事件和属性日志。使用真实解码验证 PNG/JPEG/GIF/WebP，限制 5 MiB及 4000 万像素，拒绝外链、SVG、损坏和超大文件；不向外站发 PAT。CLI read-image 返回绝对路径、实际 MIME/字节数和动图首帧限制，任务结束清理。视觉依赖任务须实际打开图片，文字明确的说明或资源替换可直接执行。

schema 3 的停写、逐篇 Yjs 原位升级和旧页面隔离见 [共同编辑](collaboration.md#schema-3-单元格身份升级)。正文先到导致对象失效时，网页先显示核对中；查询完成或 15 秒超时/失败后恢复真实失效原因并提供重试。原回执保留期和先持久化再确认规则不变。

按 [开发文档](development.md#数据库迁移规则) 应用当前迁移链，再升级应用；`0015_agent_annotation_receipts` 在关联文档迁移 `0014_zippy_molten_man` 之后，为执行收据新增可空的 completed_annotations JSONB，不迁移或上传本机标注。Skill 从账号页更新并保留配置，不需重新 seed。包由 Nitro serverAssets 与 [Skill 文件清单](../skills/requirement-board/scripts/files.mjs) 生成；安装说明只使用请求 origin 和白名单 action，不信转发主机头。

| 测试入口 | 覆盖 |
| --- | --- |
| `tests/diff/agent-suggestions.test.ts`、`content-equality.test.ts` | schema、ID、Yjs 保留、版本状态 |
| `tests/diff/agent-cli.test.ts`、`agent-sites.test.ts`、`agent-installer.test.ts`、`agent-installer-backups.test.ts` | CLI、多站点/本地端口、origin/重定向、配置、安装失败恢复及备份保留与清理边界 |
| `tests/diff/ai-annotations.test.ts`、`annotation-storage.test.ts`、`annotation-completion-gc.test.ts`、`pnpm test:browser:workspace` | 标注格式、严格定位、完成摘要、本机持久化后确认、定时回收及新要求保护 |
| `tests/diff/agent-tools.test.ts`、`tests/api/agent-tools.cases.ts` | 上传/绑定/GC、缓存、摘要与全文、Diff 分页、追溯边界 |
| `tests/diff/agent-discovery-cli.test.ts`、`tests/api/agent-discovery.cases.ts` | 关联同站路由/双方锁/幂等/回滚、真实 CLI 创建编辑衔接、250 条完整分页及筛选排序、旧数组兼容和权限 |
| `tests/api/agent-suggestions.cases.ts`、`agent-management.cases.ts` | 凭证、锁、幂等、冲突、回滚、版本、完成回执隔离/并发确认/到期及旧接口 |
| `pnpm test:browser:agent` | CLI 下载、多标签、离线保护、版本状态及窄屏 |

API 用例共用隔离测试入口，不触碰开发或远程数据库；历史执行/审核收据不因文档整理或普通 GC 自动删除。
