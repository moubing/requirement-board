# bing-ui 0.16.0 联动验证

日期：2026-11-09。npm 已发布 `0.16.0`，`latest` 校验一致；本项目和文档站已从候选包切换到同一正式精确版本，锁文件由 pnpm 生成。

## 业务接入

- 创建文档、属性、关联、模板、成员及账号弹窗统一使用 busy；保持原有提交成功后程序关闭、失败恢复及自定义 footer 流程。confirmLoading 自带忙碌保护。
- 标注输入框保留业务提醒，显式 rejectFeedback=false 避免重复反馈；抽屉布局和自定义焦点保持既有约束。
- 段落、图片对齐、提示类型和文档状态迁为 radio/checked；列表与高亮使用 checkbox。撤销、重做仍是普通命令。斜杠菜单改用 Group，保留 active、外部键盘和编辑器焦点。
- 链接表单关闭 typeahead；表格与链接 Tooltip 由 aria-expanded 自动抑制。版本卡片打开时抑制全部标记的业务规则仍保留。加粗、斜体提示增加真实快捷键。
- AnimatedText/textSwap 与 CheckboxGroup 新手势均不强行开启；原有按钮文案、角色选择、decorative 任务项和表单模型保持一致。Radio 留给后续独立优化。
- 已检索关闭原因处理，应用没有需要补充 swipe/replaced 分支的穷尽 switch。

## 验证结果

`pnpm typecheck` 通过；`pnpm exec vitest run tests/diff tests/auth` 共 104 个文件、726 项通过。

浏览器使用真实 Vue 页面、编辑器、Yjs 和组件库，Nuxt 数据/协作接口由夹具提供，没有连接生产数据库。以下场景已通过：

| 入口 | 覆盖内容 |
| --- | --- |
| workspace operations | 连续属性变更、关联选择、提交/加载、丢失响应重试、创建、模板、成员角色、审批和用户管理 |
| workspace settings / detail / pages | 设置布局、Cookie/字体失败恢复、320–1440px 亮暗主题、详情抽屉/焦点/属性、工作台状态菜单、触屏、拖放与取消 |
| workspace task-lists / callouts / annotations | 编辑/只读/Diff 任务项、提示类型、标注输入锁、关闭保护、IME、嵌套确认、复制及失效恢复 |
| workspace version-markers | Tooltip/卡片/比较/恢复/撤销、键盘、滚动、隐藏、亮暗与触屏、多 DPR/字号连续笔画像素 |
| editor task-lists / code-blocks | 任务切换与撤销、键盘/IME、双页 Yjs、代码菜单/原文复制/失败恢复及只读布局 |
| editor context-caret / slash-commands | 鼠标右键不抢正文焦点，普通/协作表格光标及撤销；斜杠菜单分组、IME、局部边界、过滤/取消/鼠标/键盘、亮暗窄屏 |
| workspace consumer-accounts | 保持登录空格切换和提交值，凭证创建失败/重试/busy/结果/撤销，邀请角色多选与清空，修改密码焦点与 busy，390×500 亮暗布局 |

新增账号场景仅返回虚构凭证和受控账号响应，不创建真实账号或凭证。可用 `BROWSER_TEST_SCENARIO=consumer-accounts pnpm test:browser:workspace` 复验；其他场景沿用同名环境变量。

同时修正旧测试的字体预览多元素选择器、17 条斜杠命令数量、Dialog 下一帧视口尺寸等待；版本标记只对实际可见线段采样，避免把滚动裁剪区外像素当接缝。未降低有效像素或行为断言。

## 发布收尾与范围

`pnpm ui:check --check-versions` 已通过，应用依赖、安装包、组件库源码、文档依赖和 AI 导出全部为 `0.16.0`，已移除临时 tarball 路径。正式包与候选包 SHA-512 一致；安装正式包后重跑 `consumer-accounts` 和 `context-caret` 均通过。

组件库发布提交：`4df46d1`（`chore(release): 0.16.0`）。两个下游项目的升级代码、依赖和验证记录分别纳入各自仓库的同步提交。

未执行生产部署、数据库变更或真实账号操作。实体手机输入法、系统选字和原生长按菜单仍需实机验收；CDP/触屏模拟和窄屏检查不能冒充实机结果。
