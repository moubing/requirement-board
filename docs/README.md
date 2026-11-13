# 文档索引

本文档集供开发和维护使用；应用内使用手册的源文件在 [server/db/seeds](../server/db/seeds/README.md)。当前行为以代码、测试和配置为准。

## 当前实现

| 要处理的事情 | 阅读入口 |
| --- | --- |
| 启动、环境变量、数据库、迁移和测试 | [本地开发与验证](development.md) |
| 模块边界、数据模型、API、图片生命周期 | [应用架构](architecture.md) |
| UI 组件版本、文档入口和联动修改 | [bing-ui 接入](bing-ui.md) |
| 页面布局、排版、侧栏与编辑器辅助面板 | [UI 规则](ui-rules.md) |
| 注册、邀请、成员角色和账号管理 | [账号与成员管理](accounts.md) |
| 登录页布局、产品场景预览、表单反馈与动效约束 | [登录页交互与视觉](login-experience.md) |
| 固定示例的游客编辑、比较、资源与请求隔离 | [游客体验](demo.md) |
| 四种文档类型、状态流程和模板 | [文档类型与模板](document-types-and-templates.md) |
| 文档分页服务、分组、搜索和批量摘要 | [文档查询](requirement-queries.md) |
| 首页工作流、拖拽改状态、项目动态、团队负载和完成节奏 | [首页工作台](workbench-home.md) |
| 里程碑事实、历史覆盖和个人周期统计 | [工作台统计](workbench-statistics.md) |
| 正文模型、编辑交互、Diff 和选区历史 | [编辑器与 Diff](editor-and-diff.md) |
| Yjs 持久化、在线成员和节点修改人 | [共同编辑](collaboration.md) |
| 本地备份、图片任务、恢复和切页保护 | [草稿备份与恢复](drafts.md) |
| 本机 AI 的凭证、快照、编辑锁和 API | [Agent 文档管理](agent-editing.md) |
| 侧栏搜索、最近浏览和阅读位置 | [快速切换](requirement-quick-switch.md) |
| 审计写入、属性历史和查询权限 | [操作日志](audit-log-plan.md) |
| 服务器配置、发布与故障恢复 | [部署说明](../deploy/README.md) |

## 未完成设计与测量记录

- [待办](todo.md)：记录待验证的问题，当前包括编辑器正文更新时的全量遍历性能风险。
- [子任务与状态汇总设计](accounts-and-workflow-plan.md)：尚未实现，不代表现有权限或状态规则。
- [操作日志的时间线扩展](audit-log-plan.md#后续完整时间线)：统一时间线尚未实现。
- [编辑器滚动性能评估](editor-scroll-performance-assessment.md)：保留测量条件、最终结果和待复测项，不作为当前性能保证。

## 维护方式

同一契约只在所属专题展开，其他文档链接引用。更新功能时直接修订当前说明；已完成计划、逐次测试数量和临时排查过程不继续累积。未完成设计须标明状态，性能结论须附测量条件与局限。删除文档前确认有效内容已有去处，并检查引用。
