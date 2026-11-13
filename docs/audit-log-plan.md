# 操作日志与需求历史

账号、AI 操作和需求逐属性日志已实现，共用 audit_events。创建、正式保存、属性及未来子任务尚未汇成统一时间线。

旧审计能否支持首次提测、完成和当时负责人统计，见 [工作台统计核验](workbench-statistics.md)。日志存在不等于历史覆盖完整；新增事实与覆盖表和业务审计同事务提交，旧日志保持原样，统计聚合入口尚未实现。

## 记录边界

| 记录 | 存储 | 含义 |
| --- | --- | --- |
| 账号业务操作、属性变更 | audit_events | 操作者、项目、目标、前后值、来源与时间 |
| 当前申请 / 当前属性 | project_access_requests / requirements、requirement_assignees | 当前状态，不能代替操作历史 |
| AI 操作 | agent_suggestions + audit_events | 冻结请求与执行收据；旧审核记录保留，新请求直接执行 |
| 正文历史 | requirement_revisions | 版本标题、正文、保存人和说明 |
| 共同草稿与编辑确认 | 协作表及 requirement_edit_events | 同步与节点参与者，不作为业务操作时间线 |

状态、负责人和优先级不进入正文 revision，修改它们不自动保存正文，回退正文也不改变属性。运行异常、请求耗时等走运行日志；业务审计不记录逐次敲键、打开页面、密码、令牌、邀请链接或完整请求体。

## 公共审计写入

入口为 `server/services/audit.ts` 的 `writeAudit(tx, event)`；账号服务、注册钩子和需求属性共用。业务调用方验证权限、项目/目标及实际变化，公共方法只生成 ID 并写入传入的事务：

```ts
await writeAudit(tx, {
  projectId: DEFAULT_PROJECT_ID,
  actorId: actor.id,
  targetId: userId,
  subjectUserId: userId,
  action: 'user.disable',
  detail: { reason: input.reason },
})
```

`shared/audit/events.ts` 中 AuditEventDetails 定义动作与详情，AuditEvent 为判别联合，AUDIT_ACTION_LABELS 覆盖所有中文名称。不得传普通 db、客户端自报操作者或任意详情；无详情也显式传 {}。公共方法不另开事务，失败使业务一起回滚。

数据库 action 仍为 text，读取兼容旧/未知动作，新写入受严格类型约束。`pnpm typecheck` 包含服务端及 `tests/types/audit.ts` 的错误调用反例；HTTP 校验、授权与事务回滚另由接口测试验证。

## 属性日志

网页 PATCH 与 Agent 共用 `requirement-properties.ts`。调用方锁定需求行，校验类型流转和负责人，再逐项比较：

- 动作为 requirement.property.change；详情含 field/label、before/after 原值及当时名称、operationId/source。
- 状态、负责人、优先级每个实际变化字段各一条；同次修改共用 operationId，AI 用执行收据 ID，网页生成 ID。无变化、幂等重试不重复记录，创建初始值不伪装成修改。
- assigneeIds 按完整名单记录一次负责人变化；旧单人记录仍可读。标题以 field=title 独立记录前后名称，网页 PATCH 与 AI set_title 都写日志；改名不生成正文版本，历史版本保留其原有标题快照。
- source 为 web 或 agent_takeover；历史 agent_review 标为“AI 审核（历史）”。AI 另含 agentUserId，实际操作者仍记在公共审计列。
- 业务和日志同事务提交。应用只追加，不改删旧日志，不猜测历史缺失值；未来永久删除文档前须明确审计保留策略。

账号审计只经管理员用户详情读取。文档侧栏读取 `GET /api/requirements/:id/property-history?cursor=`，Agent 使用对应 `/api/agent/v1/requirements/:id/property-history?cursor=`；分别验证 Cookie/PAT、项目和文档归属。

属性历史按 created_at、id 倒序，每页 50 条；游标须属于同文档。索引为 (project_id, target_id, action, created_at, id)，不能开放整张审计表。

## 后续完整时间线

尚未实现的统一展示可复用现有数据，按需增加创建与保存版本事件：

| 事件 | 内容 |
| --- | --- |
| 创建文档 | 文档标识、初始属性、初始版本引用 |
| 属性变化 | 复用逐字段前后值与操作者 |
| 保存版本 | revisionId、版本号、说明及查看 Diff 入口，不复制整篇正文 |
| 子任务动作 | 任务、动作、结果及触发父状态变化的关联 |

现阶段不增加通用 targetType、分表或权限平台；跨领域查询、保留期限或规模产生真实需要时再设计。正文差异继续由版本 Diff 解释，Yjs/Awareness 不由审计替代。

API 回归覆盖来源、无变化、幂等、回滚、属性冲突与分页完整性；新增正文事件还须能定位对应 revision。账号申请的旧动作解释见 [账号文档](accounts.md#申请操作记录)。
