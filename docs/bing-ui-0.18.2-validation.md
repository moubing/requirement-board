# bing-ui 0.18.2 联动验证

日期：2026-11-11。本次业务修改位于 `C:/workspace/requirement-board-main`。本机映射沿用指向主工作区配置的 `dev-repos.local.json` 符号链接；`C:/workspace/requirement-board` 未改动。

## 迁移

- 已精确安装 `@moubing/bing-ui@0.18.2`，同时同步文档站。该版本包含本轮 Slider / Input / Textarea / Table / Button 能力和两处 Table 点击修复。
- 删除 PreferenceNumberInput 的重复草稿、clamp 和 round；业务保留合法范围检查，null 恢复默认。两个宽度滑杆接入同源 `resetValue`，保留原业务范围、步长、颜色和恢复按钮。
- 标题、代码名称和字体输入改用 `enter`，保留原有失焦、取消和去重；邀请密码框关闭重复的内置显隐按钮。
- 标注输入通过 `submitOn="enter"` 和 `resize` 保存与定位，保留组词、Shift+Enter、Esc、外部操作隔离和焦点循环。关闭锚定浮层的高度过渡，避免缩短文本后命中位置移动；不再重复执行 Dialog 已处理的首尾 Tab。
- 选区历史改为 `activeRowKey / row-activate` 和公开活动标记变量；凭证首次加载错误使用 Table 的 `error / retry`，刷新错误保留既有数据。
- 盘点 9 处 Textarea、7 处 Table、密码按钮、函数 rowKey 和 Table 内部 CSS；现有长说明保留默认无清除按钮，没有新增不受后端支持的跨页批量操作。

## 业务回归

下列场景使用真实 Vue 业务组件，接口由工作区 fixture 提供受控响应，不写开发或生产数据库：

- `settings`：双宽度与滑杆、恢复与双击、半成品输入、null、Enter/blur 规整、Cookie 失败重试和刷新恢复、字体设置与弹窗焦点，覆盖 320 / 390 / 960 / 1440px 和亮暗主题。
- `consumer-018`：文档、用户、申请、邀请、AI 凭证、成员、选区历史共 7 处表格，覆盖方向键、End、F2、Esc、嵌套按钮、滚动末端、1440/390px 亮暗主题；另外验证历史行点击/Enter 激活及凭证错误重试。
- `consumer-accounts`：登录、密码显隐选区、保持登录、凭证失败恢复、一次性结果、撤销、邀请角色、改密焦点与 busy、390×500 布局。
- `annotations`：标注创建/编辑、组词、换行、保存/取消、1–4 行与长文本内部滚动、窄屏定位、输入锁、Tab 循环、回执和本机持久化。真实输入法候选窗口不在自动化范围内。
- `code-blocks`：代码名称/语言、正文标注定位、Diff、预览和选区历史；Select 的定位同步使用 combobox 角色。
- `operations`：连续属性选择、响应丢失重试、刷新失败、创建、模板、成员角色、审批和账号停用。
- 单元测试：`pnpm test:unit`，96 个文件、686 项通过。

上述场景均已通过。联调使用发布构建，正式包安装后串行复验 `consumer-018`、`settings`、完整 `annotations`，并重新通过 686 项单测、前后端类型检查和 `pnpm ui:check --check-versions`。两个下游安装的 455 个产物文件均与联调构建逐字节一致；锁文件由 pnpm 生成，没有本地候选包路径。

已检查文档列表桌面亮色与选区历史 390px 暗色截图，确认固定列、末端滚动、焦点轮廓和活动标记。未运行完整构建、视觉快照回归或部署；浏览器均为无头 Chromium。NVDA、真机读屏、密码管理器和系统输入法仍需人工验收。
