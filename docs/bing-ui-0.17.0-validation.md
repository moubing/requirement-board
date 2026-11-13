# bing-ui 0.17.0 联动验证

日期：2026-11-10。npm 已发布 `@moubing/bing-ui@0.17.0`，`latest` 与目标版本一致。看板、组件库源码、文档站依赖及 AI 导出均为 `0.17.0`，`pnpm ui:check --check-versions` 通过。

## 升级内容

- 精确升级 npm 依赖，锁文件由 pnpm 生成；增加的传递依赖 `pinyin-pro` 来自组件库的拼音匹配能力。
- 在原有 `minimumReleaseAgeExclude` 的同一条 bing-ui 精确版本规则中追加 `0.17.0`。
- Select 触发器新增 `combobox` 角色，更新属性、负责人、模板筛选、配色、字体与凭证状态的测试定位。按钮、下拉菜单及业务操作断言保持各自语义。
- 看板业务组件继续使用公开 API，无需增加内部 DOM 兼容处理。面板冻结与底部占位方案已经回退，正式包保留自然收缩。

## 正式包验证

以下浏览器验证未设置 `BROWSER_TEST_UI_CANDIDATE`，使用已安装的 npm 正式包；系统 Chrome 仅通过进程环境变量启用无头模式。

- `pnpm typecheck`：前端与服务端类型检查通过。
- `pnpm test:unit`：96 个文件、686 项用例通过。
- `pnpm test:browser:workspace`，`BROWSER_TEST_SCENARIO=pages`：列表筛选与分组、模板编辑/复制、成员角色入口、工作台排序/拖放/撤销、320–1440px 明暗主题通过。
- `BROWSER_TEST_SCENARIO=operations`：负责人和优先级连续选择、响应丢失重试、窄屏属性确认、创建、模板、成员角色及账号操作反馈通过。
- `BROWSER_TEST_SCENARIO=detail`：长姓名多选、属性保存失败恢复、桌面操作栏、320–560px 面板、停靠边界及编辑器/阅读锚点保留通过。
- `BROWSER_TEST_SCENARIO=settings`：配色、宽度与滑杆、存储失败、字体选择与虚拟列表键盘操作、重开/刷新缓存，以及 320 / 390 / 960 / 1440px 明暗主题通过。
- Node 直接导入正式包并读取 `BingSelect / BingTreeSelect` 成功；已检查窄屏详情与字体设置截图。

设置场景首次执行仍按 `button` 查找“编辑文字配色”，因此等待超时；更新为实际的 `combobox` 后，设置及字体场景完整复测通过。相关测试没有扩大超时时间或删除交互断言。

本轮使用受控浏览器数据验证真实组件和页面，不连接生产数据库。需要真实后端的文档/元数据/凭证集成测试只同步了 Select 角色定位，未执行其全链路；未运行应用完整构建或视觉快照回归，未修改视觉快照。
