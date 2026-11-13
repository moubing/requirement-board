# 文档操作

正文协议版本 3，能力版本 13。所有命令前缀为 `node <skill-dir>/scripts/rb.mjs`。正文使用原生 Tiptap JSON，不通过 Markdown 或 HTML 往返转换。通用节点标注按 `nodeType` / `version` 与来源 schema.annotationNodes 核对；替换被标注节点时，仍以其所在顶层块执行操作，保留无关子节点及稳定 ID。提示块的文字直接放在 callout.content 内，tone 与文字同属该节点，不包一层 paragraph。

折叠块先检查 `details` 能力。details 内按顺序放 detailsSummary（text*）和 detailsContent（block+），后者可包含列表、表格、图片及嵌套折叠块。保留 details、摘要与内部块的稳定 diffId，新块省略 ID；修改时替换所在顶层块。不要写入 open/hidden，展开状态不属于正文。文字标注使用摘要或内部文字块 ID，整体标注使用 details。最小新建示例：

```json
{
  "type": "details",
  "content": [
    { "type": "detailsSummary", "content": [{ "type": "text", "text": "补充说明" }] },
    { "type": "detailsContent", "content": [
      { "type": "paragraph", "content": [{ "type": "text", "text": "展开后阅读的内容" }] }
    ] }
  ]
}
```

任务清单先检查 `task_lists` 能力。结构为 `taskList.content: taskItem+`、`taskItem.content: paragraph block*`，`taskItem.attrs.checked` 必须是 boolean（省略默认 false）。可嵌套任务或普通列表；只改勾选也属于正文修改，替换所在顶层块时保留各层存活 diffId、文字与 marks。新建节点省略 diffId；不要用字符串 `"true"`、显示标签或 Markdown 文本替代节点属性。文字标注定位到内部段落，不把复选框当文字。最小新建示例：

```json
{ "type": "taskList", "content": [
  { "type": "taskItem", "attrs": { "checked": false }, "content": [
    { "type": "paragraph", "content": [{ "type": "text", "text": "验收通过" }] }
  ] }
] }
```

完整文档链接自动选择对应站点，裸 ID 和无链接命令用 `--site <origin>` 指定。新快照、读取结果和请求文件带有本机路由字段 `siteOrigin`，后续校验、提交及锁操作会自动沿用；文件中的字段与 `--site` 冲突时拒绝操作。下方示例省略此字段，实际编辑生成的文件时应保留，脚本提交前会移除它。旧文件缺少站点信息时显式指定 `--site`。新建图片上传只有 requestId，仍需带上新建请求的目标 `--site`。

## 分页查询

需要 `paginated_search` 能力。`list` 默认返回第一页，显式发送 page=1、pageSize=20；每页 1–100 条，总量不受 100 限制。参数映射如下：

| CLI 参数 | API 参数 / 含义 |
| --- | --- |
| `--query` | q，编号或标题，支持多词、中文及编号规范化 |
| `--page` / `--page-size` | page / pageSize，正整数 |
| `--document-type` | documentType，requirement / defect / instruction / todo |
| `--status-id` | statusId，从 meta 解析 |
| `--assignee` | assignee，me / unassigned / meta 返回的成员 ID；me 是当前 PAT 用户 |
| `--reporter` | reporter，me / meta 返回的成员 ID，按提出人筛选 |
| `--stale` | stale=1，只列停滞文档：处于待处理/进行中/测试中，且超过 14/3/3 天没有正文编辑、状态变化或正式版本（仅改标题、负责人、优先级不算进展）；需要能力版本 10 |
| `--exclude-id` | excludeId，要排除的内部文档 ID |
| `--sort-by` | sortBy：key、title、documentType、status、priority、assignees、reporter、createdAt、updatedAt |
| `--sort-order` | sortOrder：asc / desc；指定方向须同时指定字段，字段单独指定时默认 asc |

```sh
node <skill-dir>/scripts/rb.mjs list --site https://board.example --query "退款 API" --assignee me --page 1 --page-size 20
node <skill-dir>/scripts/rb.mjs list --site https://board.example --query "退款 API" --assignee me --page 2 --page-size 20
```

返回 items、total、page、pageSize、asOf，以及 CLI 派生的 hasMore、nextPage 和 siteOrigin。items 仅为本页摘要；空结果或合法越界页无下一页，nextPage=null，越界仍保留真实 total。未知/重复标量、非法排序、不安全偏移和超过单页上限都会拒绝。

翻页保持全部站点、关键词、过滤和排序，条件变化从第一页重查。用户只需候选时按需读取；要求“全部”则直到 hasMore=false，按 ID 去重并区分已读数量和 total。失败不能当成空页或完成，重试原页；跨页数据可能变化，每页 asOf 是本页及 total 的一致只读查询时点，不是跨页固定快照。

新版 CLI 不回退旧数组。服务端仅为旧 CLI 的无参数或仅 q 请求保留最多 100 条的裸数组；新协议应显式传 page/pageSize，缺失的一项按默认值补齐。新旧入口共用搜索和排序服务。缺少能力或收到旧数组时按 SKILL.md 更新核验一次，仍不支持则停止，不报告已查全。

## 关联文档

需要 `document_relations` 能力。编号、内部 ID 和完整本站链接均可作为文档参数；所有链接及 --site 必须同站，逐个解析身份，不能根据相似标题或第一条候选建立关系。

```sh
node <skill-dir>/scripts/rb.mjs related REQ-8 --site https://board.example
node <skill-dir>/scripts/rb.mjs link REQ-8 REQ-12 req_target --site https://board.example
node <skill-dir>/scripts/rb.mjs unlink REQ-12 REQ-8 --site https://board.example
```

对应 GET/POST `/api/agent/v1/requirements/:id/related` 及 DELETE `/api/agent/v1/requirements/:id/related/:relatedId`，均使用 Bearer PAT。POST 体为 `{"documentIds":["REQ-12","req_target"]}`；API 接受编号和内部 ID，完整链接由 CLI 先验证同站再解析。响应是当前全部关联摘要数组（编号、标题、类型、状态、documentUrl），无关联时为 []；CLI 把链接补成本站绝对链接。

增量添加保留已有关系；原始输入 1–100 项，先检查上限再去重。解除每次一个目标，保留双方文档和其他关系。重复添加、反向添加和重复解除均幂等。关系独立于正文、Yjs、版本和属性日志，实际变更仅在同一事务更新双方 updatedAt，提交后通知双方页面；无变化不重复更新时间或广播。

单独关联不取得 snapshot。写入按统一顺序锁住涉及文档并检查全部归属及有效 AI 锁，任一侧持锁（包括同 PAT）或目标无效则整批失败。非法输入 400；认证/资格失效 401/403；不存在或不可访问 404；有效锁 423。读取关联不受正文编辑锁影响。

创建/修改后按“确认成功及实际 ID → 自动解锁 → link → related 核对”衔接。新建只有完整初始 v1，普通编辑不额外保存版本。编辑响应丢失用原 operation/requestId 恢复后再关联；关联失败不重复创建或回滚已成功正文。关联没有独立执行回执，响应不明先 related，再按仍有效的授权重试；并发相反变更须重新核对，不能自动重放旧意图。

## 新建

`new --create --out action.json` 生成新的 requestId。填写示例：

```json
{
  "action": "create",
  "documentType": "requirement",
  "requestId": "脚本生成的唯一值",
  "title": "退款申请",
  "contentJson": {
    "type": "doc",
    "content": [
      {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "验收标准"}]},
      {"type": "paragraph", "content": [{"type": "text", "text": "重复提交同一笔退款只产生一次退款申请。"}]}
    ]
  },
  "properties": {"priority": "high"},
  "changeNote": "建立退款申请需求，明确重复提交的处理规则"
}
```

初始版本说明必填，最多 500 字符。类型可选 requirement（需求）、defect（缺陷）、instruction（说明）、todo（待办），默认 requirement；类型创建后固定。需求、缺陷、待办从待处理开始，说明从草稿开始，负责人默认未指派，优先级默认 medium。新增节点省略 diffId。执行时原子创建文档、完整 v1 与初始 Yjs 状态；新建属于初始 v1；后续编辑默认只更新草稿。

## 修改与保存

`snapshot <文档> --out snapshot.json` 写入当前共同草稿的 title、contentJson、contentToken、properties、baseRevisionId、schemaVersion、锁及到期时间。快照提交资格最多 24 小时，编辑锁默认 30 分钟。脚本按站点和凭证缓存正文，并在请求中携带 ifContentToken；服务端返回 notModified 时由脚本补齐本机正文，不重复传输。缓存损坏时重新读取。属性及版本元数据每次刷新；成功 submit/operation 使用服务端冻结并实际执行的正文更新缓存，保留最终分配的 diffId。校验候选不能作为后续编辑缓存。

read/snapshot 缓存命中时，默认终端输出仅省略 contentJson，并带 contentOmitted 和取回正文的提示；标题及最新快照、属性、版本、锁信息仍返回。`--json` 不改变该行为；`--full` 强制输出完整 JSON，仍通过条件请求复用缓存，不重复下载正文。`--out` 的文件始终完整，终端只提示写入结果。初次读取或正文变化时默认输出全文。命中缓存只说明本机副本与服务端一致，新会话或上下文不足时应读取完整结果中的相关内容。

`new --snapshot snapshot.json --out action.json` 生成更新文件。下面示例用于用户明确要求“修改并保存版本”的任务；普通修改必须省略 `saveRevision`：

```json
{
  "snapshotId": "snap_来自读取结果",
  "requestId": "脚本生成的唯一值",
  "changeNote": "补充退款失败处理，调整优先级并保存",
  "operations": [
    {"op": "set_title", "title": "退款申请与异常处理"},
    {"op": "insert_blocks", "anchorDiffId": "原有顶层块ID", "position": "after", "nodes": [
      {"type": "paragraph", "content": [{"type": "text", "text": "退款失败后显示原因，并允许用户重试。"}]}
    ]}
  ],
  "properties": {"priority": "high", "assigneeIds": []},
  "saveRevision": {"changeNote": "增加退款失败提示和重试规则，完善退款申请标题"}
}
```

- operations 允许为空：可以只改属性，或只保存当前草稿。
- set_title 会立即保存当前文档标题，不依赖 saveRevision；仅改标题不会把正文标记为未保存。正式版本记录保存时的标题，已有版本的标题保持不变。
- properties 可省略；仅填写需要修改的字段，不能发送整份旧属性覆盖他人修改。支持 statusId、assigneeIds、priority；状态和人员 ID 从 meta 解析。meta 同时提供状态 code 和 workflows（各类型的 initial、states，transitions=any）；同类型内可直接切换到任一状态，其他类型的状态返回 409。四类文档均可多人负责；assigneeIds 替换完整名单，空数组清空分配，不接受旧 assigneeId。优先级为 low / medium / high。
- 只有用户明确要求保存正式版本时才填写 saveRevision；其他修改一律省略。填写时 changeNote 必填、最多 500 字符，版本号和保存人由服务端决定。
- 保存内容是当前共同草稿加本次正文操作，包含已经同步的人工修改。用 diff 获取已有变更，需要全文时用 show 或 revision。read 的 latestRevision 只提供摘要，避免重复传输正文。
- 标题、状态、负责人、优先级独立保存；每个实际变化单独记录日志，记录前后值与名称、操作者、时间、来源和同次操作编号。无变化不记日志。历史正文版本不会恢复当前属性；其中仅标题保留当时的快照。
- 目标属性变化、标题/正文变化或保存基准版本变化会导致冲突。不要重新提交旧快照来覆盖变化。

## 四种正文操作

```json
[
  {"op": "set_title", "title": "新的文档名称"},
  {"op": "replace_block", "targetDiffId": "existing-id", "node": {"type": "paragraph", "attrs": {"diffId": "existing-id"}, "content": [{"type": "text", "text": "替换后的段落"}]}},
  {"op": "insert_blocks", "anchorDiffId": "another-id", "position": "before", "nodes": [{"type": "paragraph", "content": [{"type": "text", "text": "新段落"}]}]},
  {"op": "delete_block", "targetDiffId": "obsolete-id"}
]
```

示例中的 ID 必须替换为本次快照真实值。最多 100 条正文操作，请求和候选文档最多 4 MiB。

- 目标和插入锚点必须是原快照的顶层块。修改列表项、表格单元格或图片题注时，替换所在顶层块，保留无关子节点。
- 替换保留根块 diffId，存活子块保留自己的 ID。新节点省略 diffId，由服务端分配。不能挪用其他子树 ID，或把 ID 改成 null。
- 同一块最多替换或删除一次；同一锚点的插入合为一条，不能同时删除该锚点。set_title 最多一次。
- 根文档至少保留一个合法块；标题层级 1–3。未知节点、marks、属性及非法嵌套会被拒绝。
- 保留未要求修改的文字格式、链接、列表编号、表格布局和图片属性。tableCell/tableHeader 及内部段落各自有稳定 diffId，tableRow 没有。合并、拆分或类型/跨度改变的单元格省略旧 ID，其余存活单元格保留；副本整个子树省略 ID。同表多项标注必须从完整快照合成一次顶层 replace_block。
- 图片包含 imageCaption 子节点，使用 upload-image 返回的节点或已有项目图片地址，不使用 blob:、data: 或本地文件路径作为 src。
- validate 返回完整候选但不保留新分配 ID；正式候选以 submit 冻结的内容为准，提交后不能修改。
- 修改在原持久化 Yjs 状态上执行，不重建协作历史；正式版本保存 Tiptap JSON，纯文本由服务端派生。

## 执行与重试

`validate --file action.json --out preview.json` 只校验并返回候选、属性差异和版本说明，不写入文档。

`submit --file action.json` 调用 `POST /api/agent/v1/operations`，直接执行整组操作。成功返回 applied、documentUrl 和可选 revision（id、version、changeNote）。普通修改不生成 revision；仅在用户明确要求保存版本时提供 saveRevision。

网页标注任务通过 `new --snapshot snapshot.json --annotations annotations.md --out action.json` 携带 completedAnnotations（最多 30 个唯一 ID 与 fingerprint）。只保留本次完整处理的条目；成功后回执返回尚未回收且未过期的完成信息，网页自动清理匹配项并确认回收，未确认信息成功后保留 7 天。验证和失败不生效，重试沿用同一请求；completedAnnotations 被消费或到期后为空不代表执行失败，以 status 为准。具体定位及数据边界见 [AI 标注](annotations.md)。

相同用户/requestId 的相同请求重试返回原结果，不重复写入；内容变化返回 IDEMPOTENCY_CONFLICT。失败时正文、属性日志和正式版本整体回滚，执行收据可保留用于查询和重试。

`operation <id>` 调用 `GET /api/agent/v1/operations/:id`，返回本人操作状态及执行结果；旧 status 加操作 ID 仍兼容。status 加文档标识则查询草稿状态。没有审核页面或建议列表。旧 suggestions API 返回 410，不能在升级后自动执行旧的待审核内容。旧 -t/--takeover 参数仅兼容原命令，已不再需要。

校验或新提交要求有效编辑锁。release 主动取消本轮未执行的请求；执行成功自动解锁。属性、正式版本和完整草稿基线仍须匹配，历史收据和版本都不可改写。

## 图片上传

```sh
node <skill-dir>/scripts/rb.mjs upload-image REQ-8 --file <聊天附件绝对路径> --out image.json
node <skill-dir>/scripts/rb.mjs upload-image --create-request <action.json中的requestId> --file <图片路径> --out image.json
```

支持 PNG、JPEG、GIF、WebP，每张不超过 5 MiB，通过 multipart 上传原始字节，服务端按文件头确定类型。响应含资源 ID、url、大小、MIME 和可直接插入的 node：

```json
{"type":"image","attrs":{"src":"/uploads/asset_服务端生成.png","alt":"截图说明","align":"center"},"content":[{"type":"imageCaption","content":[{"type":"text","text":"图片题注"}]}]}
```

- 上传只建立资源，不会自动插入正文或保存版本。把返回 node 放入 insert_blocks 或新建 contentJson，必要时另加段落解释图片内容；新节点省略 diffId。
- 编辑已有需求时，持锁的同一凭证允许上传；其他凭证持锁返回 423。新建前上传必须使用即将提交的创建 requestId，只能由同一用户在同一项目的该请求使用；24 小时内提交。创建事务会把已引用图片绑定到新需求，未使用图片按资源宽限期清理。
- 脚本默认按目标和文件字节生成稳定 uploadId；相同文件、相同目标重试不重复上传。显式 `--upload-id <12至100位字母数字下划线或连字符>` 可区分独立上传任务，同 ID 改文件或目标会返回 409。
- 临时资源过期返回 410 或校验失败时，换一个 uploadId 重新上传并更新尚未提交的正文。已提交请求响应丢失时先恢复原请求，不能修改其内容或 requestId。
- 同站点已绑定图片可复用。未绑定图片不能借另一创建请求使用；图片进入历史版本后即使当前草稿删除也不会被 GC 清理。
