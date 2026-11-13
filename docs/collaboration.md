# 共同编辑

正文由有权限的成员共同编辑，标题作为文档属性独立提交。保存版本合并所有已同步正文并记录当时的当前标题，说明由保存人填写；不会清空共同文档或覆盖保存期间的新输入。AI 独占编辑及 editEpoch 恢复另见 [Agent 文档](agent-editing.md)，个人备份见 [drafts.md](drafts.md)。

## 接入方式

- Tiptap Collaboration/CollaborationCaret 与现有 Tiptap 版本一致，使用其实际依赖的 `@tiptap/y-tiptap`，不能混用其他绑定的插件 key；协作撤销替代 StarterKit 历史，只撤销本人输入。
- Hocuspocus 通过 Nitro 的 `/collaboration` 共用应用端口，HTTPS 页面使用 WSS。每需求一个房间，正文为 default 字段的 Y.XmlFragment。保留标题 Y.Text 作为兼容镜像，属性 PATCH 和 AI 改名沿原 Yjs 历史更新它；网页标题输入不再直接写入 Y.Text。落盘时以 `requirements.title` 校正旧客户端携带的标题，正文历史不重建。
- 客户端持有编辑副本和服务端确认副本：Tiptap 绑定前者，Provider 绑定后者，避免握手提前发送尚未记录作者的编辑。光标按 Awareness 的 client ID 排除本会话，不用编辑副本 ID。
- 本地编辑约 16ms 合批经 /edits 落盘，提交后才由 WebSocket 广播。空闲不轮询，同一时刻只发一批；新输入排后续批次。
- 连接检查会话、启用状态、项目与受信 Origin；持续连接约每 5 秒在消息到达时复核。服务端校正在线成员姓名/颜色。
- “正在编辑”按账号去重正文/比较页的在线会话，不要求持续输入；选区历史页不参与。断线隐藏名单并提示不可用，不能显示过期在线数。

`pnpm-workspace.yaml` 对 `@tiptap/y-tiptap@3.0.9` 使用仓库补丁：撤销/重做只用 Yjs 历史相对选区，避免结构恢复越界；插件视图重建时恢复 UndoManager 自身 origin，保留重做。补丁不改持久化格式，Docker 安装依赖前须复制 patches。升级时复验 editor-history 和真实编辑器无头测试，再判断能否移除。

正文结构事务及紧随的 ID 修复共享撤销步骤，修复须继承 addToHistory。块 ID、粘贴和视图边界见 [编辑器文档](editor-and-diff.md)。

## 持久化与恢复

`requirement_collaboration_documents` 每需求一行，保存 Yjs 二进制、同状态派生的标题/JSON、schemaVersion、节点名单、序号和 editEpoch。新编辑批次在同一事务更新正文、名单及去重收据；旧协议保留停止输入约 1 秒、最长 5 秒的落盘兜底，无法追踪的修改标为未知。

### schema 3 单元格身份升级

迁移 `20261107092253_annotation_cell_identity` 将已有共同文档标为 schema 2，新建默认 3。停下目标应用及其他写入进程后运行 `pnpm db:migrate`（部署为 `node tools/migrate.mjs`）：SQL 完成后逐篇事务锁定文档，沿原 Yjs 节点只补缺失的 tableCell/tableHeader diffId，再从同一状态派生 JSON，schemaVersion 改为 3、editEpoch 加一并释放旧 AI 锁。失败可重试，已完成文档不再变化。历史 revisions、修改人、编辑事件和业务更新时间不改写，不新增正式版本。

已有 schema 2 文档的普通读取返回升级提示，不在页面打开时迁移。尚未建立共同草稿的文档仅在初始化时补身份。新网页 WS 参数与 `/edits`、版本保存请求声明 schemaVersion=3；旧客户端请求在合并增量前被拒绝，已有未提交备份仍可导出恢复。旧 snapshot 的 schema/代次不再匹配；已成功操作仍按幂等收据返回，旧回执及本机文字标注保留。恢复备份不能重建或覆盖已存在的共同 Yjs 历史。

Yjs 包含操作身份，必须原样恢复；重连不能从 JSON 新建 Y.Doc，否则可能重复插入。revision 是独立且不可变的 JSON 快照。“草稿已同步”不代表已建正式版本，初始化失败须可重试。

新增任务与折叠节点仍使用持久化 schema 3，独立节点能力声明为 `schemaCapabilities: ['task_lists', 'details']`。网页的 `/edits`、版本保存与 WebSocket 握手都声明这些能力，HTTP 也支持 `x-rb-document-capabilities` 逗号分隔值。服务端在合并前拒绝未声明支持的旧页面，提示保留未同步输入后刷新，防止旧编辑器过滤未知节点再回写；已确认编辑的原收据仍可幂等查询。这里不升级已有记录、不增加 editEpoch、不改写 JSON/Yjs/历史版本；发布后旧编辑页须刷新。Agent 使用真实服务端 schema 应用 JSON 操作，能力通过 `/schema` 导出。折叠块的展开状态仅保存在各编辑器会话的 DOM/内存中，不进入 JSON、Yjs、快照或协作消息。

新建共同文档、普通落盘和原始编辑批次在写入前，对非 paragraph 结尾补一个带稳定 ID 的空段，与网页 TrailingNode 规则一致；沿原 Yjs 历史追加节点，同事务更新二进制和派生 JSON。读取已有记录直接复用，不为旧记录缺尾段执行迁移，也不改写旧 revision 或隐藏旧版差异。原始增量确认仍按精确协作状态判断。

本机检查点保存 JSON、Yjs、原始未确认事件、说明和图片文件；按原 ID/顺序补交，即使撤销后正文回到基线仍须保存未确认队列。旧独立草稿没有 Yjs 历史，只可在共同文档首次创建时初始化；共同文档已存在时保留冲突副本，不能整篇替换。

恢复时即使编辑代次相同，也要检查 Yjs 合并是否产生重复块 ID；正文相同不代表协作历史相同。发生冲突时保留原本机状态及事件，暂停编辑与补交，提示导出副本后载入当前草稿，再人工核对需要补回的内容。不能通过给重复正文重分配 ID 来绕过服务端校验。HTTP 拒绝应展示实际错误，不统一提示断网。

内容变化立即使旧保存签名失效，停止输入约 200ms 后计算。HTTP/WS 的重复落盘确认共用同一代次的排队/进行中/已完成计算，不逐条确认重新序列化全文；新事务使旧结果失效。待确认原事件及图片任务仍单独约束“已同步”状态。光标变化不重复发布同一成员名单，目录/预览复用正文快照。16ms 合批仍会随并发输入增加数据库、比较和完整名单广播成本，功能回归不代表容量已通过压力测试。

个人说明和图片任务通过草稿接口备份；正文变化不触发周期整篇 JSON 请求。具体时机、离开保护和失败恢复以 [草稿文档](drafts.md) 为准。

## 节点本版修改人

`shared/collaboration/attribution.ts` 比较服务端接受编辑前后的节点，以稳定 diffId 记录“自上一个正式版本以来参与修改的人”，不读取 Yjs 字符身份、不保存逐字作者或操作全文。

- 文字、格式、链接、图片属性和结构变化统一计入，账号按节点去重；标题用 `$title`。
- 嵌套节点及受影响容器均可计入；前方插入不能误算后方节点。拆分、合并、删除按实际变化记录，删除节点可由上一版展示。
- 修改后撤销仍保留参与记录；单纯保存、重试、同步或光标移动不加入。
- 离线事件按服务端确认时的版本区间归属，不补写已保存版本。旧客户端、接入前数据或无原事件的备份不猜作者。

`requirement_edit_events` 保留事件 ID、序号、认证用户、意图、增量摘要及节点 ID，新 changes 固定 []。clientId 只验证增量来源结构，不作为用户身份。进程内写入队列与数据库行锁保证正文、名单和序号同事务提交。

同步调用栈中的正文和 ID 修复合成一个事件；队列固定原 ID/内容，重试核对账号、需求、摘要和意图。缺依赖返回 409，非法文档整批回滚；每批最多 100 事件、原始增量合计 16 MiB。

原始编辑的内部连接清理必须在释放进程内文档锁后等待。Hocuspocus 即使设置 `unloadImmediately: false`，达到 `maxDebounce` 后仍会同步等待存储钩子；在锁内等待会与钩子再次请求同一把锁形成死锁，使后续输入和撤销无法确认。成功和异常路径都遵循同一清理顺序。

当前 attribution 格式：

```text
{ version: 2, baseRevisionId, baseVersion,
  nodes: [{ id, type, authors: [{ userId, name }], unknown }] }
```

只存本版修改过的节点；有名单快照但节点不在其中，表示本版未改。正式保存固化名单和截止序号，同事务重置共同名单基线；clientSaveId 重试不再重置。客户端以序号和基准版本拒绝过期名单。

旧 version 1 JSON 保留，读取历史时按相邻版本截止序号间的收据还原参与者，不从文字作者反推。缺历史记录显示未记录；author/authorId 始终表示版本保存人。展示见 [选区历史](editor-and-diff.md#选区历史-diff)。

## 图片与外部变更

图片字节不进入 Yjs，上传完成才插入正式 URL。任务和 Blob 属于上传人，位置使用 Yjs 相对坐标；远端整树事务不能误删占位。远端节点保留 ID，本地追加节点仍补 ID，旧检查点修复不进入撤销且保留原事件。

AI 持锁时网页上传和异步插入受保护，已上传任务保留到解锁重试。Diff 撤销只应用实际变化范围并同步给其他人，不修改旧 revision。共同文档 JSON 是 GC 保护源，移除引用后重算宽限期；完整范围见 [资源生命周期](architecture.md#图片与资源生命周期)。

标题、状态、负责人、优先级和文档关联独立于正文版本；属性事务提交后广播 properties。标题在事务中更新兼容 Y.Text、节点名单和编辑收据；仅改名不令正文显示“已修改”。发起页面用 mutationId 跳过自己的通知回声，其他页面合并刷新；途中到达的新变更顺序补读。关联新增或解除会同时通知双方房间，页面刷新属性、关联列表和文档索引；窗口重新获得焦点时也重读关联列表。AI 可选正式保存仍沿原 Yjs 历史生成快照。

## 接口

| 接口 | 行为 |
| --- | --- |
| `POST /api/requirements/:id/collaboration` | 授权后按需初始化，返回 Yjs、名单、序号和签名；initial 只在首次创建生效 |
| `POST /api/requirements/:id/edits` | 原始增量及可选向量；返回确认 ID、服务端增量、名单和签名 |
| `GET /api/requirements/:id/attribution` | 当前区间的 snapshot/sequence，无操作流水；历史名单随完整 revision 返回 |
| `WS /collaboration` | Hocuspocus 协议，同步正文、标题、在线成员和保存通知 |
| `POST /api/requirements/:id/revisions` | 等待原事件确认后合并状态，行锁内固化正文/名单并开启下一区间；不把未追踪修改归给保存人 |

## 运行与验证

详情页被 KeepAlive 停用时，先收束编辑记录并补存检查点，清除 Awareness 本人状态、断开 provider、停止发送及锁轮询；保留原来的工作 Y.Doc、已确认 Y.Doc 和撤销历史。重新激活在路由账号检查通过后，并行预取详情和 POST collaboration 的授权状态；预取不合并正文、不连接 provider，也不开放编辑。详情确认可访问并激活后，协作钩子只消费本轮未取消的响应，核对锁及 editEpoch，再向原已确认文档合并 Yjs 增量并重连。预取只属于当前激活尝试，不跨次缓存；失败维持只读，重试重新请求。旧代次尚未确认的编辑仍走冻结和导出恢复流程，不能通过重新激活绕过代次校验，也不能从 JSON 重建协作历史。失效的异步恢复响应由激活序号和 AbortController 丢弃。

应用当前迁移链后使用原启动命令。旧来源到节点名单复用 JSONB、只读兼容，不重写旧 revision。反向代理须转发 WebSocket Upgrade 到同一实例；当前每环境单实例，多实例前须引入共享广播或固定文档路由，数据库合并不能代替实时广播。

| 测试入口 | 重点 |
| --- | --- |
| tests/diff/collaboration.test.ts | 并发合并、个人撤销、持久化、ID 和图片位置 |
| collaboration-signature / lifecycle / caret 测试 | 签名失效、初始化与离开清理、双副本光标身份 |
| collaboration-edit-queue / attribution 测试 | 原事件重试、跨批次 ID、名单与版本边界 |
| tests/api/collaboration.cases.ts | 权限、旧协议、同时保存、幂等及非法内容 |
| tests/api/attribution.cases.ts | 多人、离线跨版、旧数据转换、身份/依赖及回滚 |

简写测试名均位于 tests/diff，后缀为 .test.ts。无头端到端另覆盖共同输入、断线重开、节点名单、选区历史及正式快照；测试选择见 [development.md](development.md#按改动选择验证)。
