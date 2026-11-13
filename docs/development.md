# 本地开发与验证

命令以 [package.json](../package.json) 为准，默认配置见 [.env.example](../.env.example)。部署操作单独维护在 [deploy/README.md](../deploy/README.md)。

## 首次启动

使用 package.json 声明的 pnpm 版本，当前为 11.7.0；本地 PostgreSQL 17 由 Docker Compose 提供，端口 5438。

```powershell
pnpm install
docker compose up -d
docker compose ps
pnpm db:migrate
pnpm db:seed
pnpm auth:set-password admin
pnpm dev
```

`db:seed` 只补缺失的管理员、固定项目、17 种状态和七篇中文手册，不覆盖已有正文。手册固定 ID、站内互链及初始 v1/Yjs 的维护见 [种子说明](../server/db/seeds/README.md)。

seed 不写默认密码。`auth:set-password` 在交互终端隐藏输入，为已有账号建立或更新 credential，并撤销全部会话。密码为 6–128 字符，不作为参数、环境变量或日志传入。日常开户、邀请和本人改密见 [账号管理](accounts.md)。

UI 开发先配置 `dev-repos.local.json` 并运行 `pnpm ui:check`，步骤见 [bing-ui 接入](bing-ui.md)。配置失败须停止相关工作，不猜测同级仓库；应用运行和普通 CI 仍从 npm 安装组件库。

## 环境变量

`.env` 仅作本地覆盖，不提交。新增变量须同步安全示例及读取代码。

| 变量 | 本地默认值 / 约束 |
| --- | --- |
| `DATABASE_URL` | `postgres://requirement:requirement@localhost:5438/requirement_board`；开发、迁移、seed 和 GC |
| `NUXT_DATABASE_URL` | Nitro runtimeConfig 覆盖；设置时须与目标环境的 DATABASE_URL 一致 |
| `TEST_DATABASE_URL` | `postgres://requirement:requirement@localhost:5438/requirement_board_test`；测试会创建、迁移并清空此库 |
| `BETTER_AUTH_SECRET` | 仅本地可用示例值；production 必须使用环境独立、至少 32 字符的随机值，同环境实例一致 |
| `BETTER_AUTH_URL` | 示例 `http://localhost:3000`；本地 `pnpm dev` 自动跟随实际监听地址。部署时配置准确 origin，公网必须 HTTPS，仅 loopback 允许 HTTP |
| `BETTER_AUTH_TRUSTED_ORIGINS` | 本地 `pnpm dev` 自动使用实际端口的 localhost、127.0.0.1 和 [::1]；其他模式为逗号分隔的精确 origin，不用通配符 |
| `BETTER_AUTH_COOKIE_PREFIX` | 本地 `pnpm dev` 自动使用 `rb-dev-<worktree摘要>-<端口>`；其他模式省略时为 `better-auth`。1–48 位字母、数字、下划线或连字符，以字母/数字开头；生产与测试分别用 `rb-prod`、`rb-staging` |
| `NUXT_PUBLIC_DEMO_SOURCE_URL` | 游客页源码 HTTPS 链接；默认 `https://github.com/moubing/requirement-board`，可按需覆盖 |
| `ASSET_STORAGE_DRIVER` | `local` 或 `s3`；开发与测试使用 local |
| `ASSET_UPLOAD_DIR` | `.local-data/uploads`；私有目录，不得放到 public 下；测试必须另用临时目录 |
| `ASSET_GC_GRACE_HOURS` | `168`，即 7 天 |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | 本地示例为 `http://127.0.0.1:9000` / `us-east-1` / `requirement-board-files` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 默认空，只由服务端使用，真实值不提交或打印 |
| `S3_FORCE_PATH_STYLE` | `true`，只接受 true/false |

production 缺少必要认证配置时 `/api/health` 返回 503。`BETTER_AUTH_URL` 决定 Secure Cookie；公网验收使用最终 HTTPS origin。更换认证密钥会影响邀请原链接的再次派生，详见 [邀请安全约束](accounts.md#安全与实现)。

旧上传若仍在 `public/uploads`，停服后复制到私有目录，验证受保护的 `/uploads/...` 可读取再清理旧文件；公开目录中的副本会绕过会话校验。

Agent 的 `RB_BASE_URL/RB_TOKEN` 属于本机 Agent 进程配置，不是服务端变量，见 [Agent 文档](agent-editing.md)。

### 多 worktree 本地开发

每个 worktree 可以直接运行 `pnpm dev`；3000 已占用时由 Nuxt 选择可用端口，也可用 `pnpm dev --port 3001` 指定首选端口。开发模式的 `listen` 钩子在端口确定后、Nitro 开发服务启动前设置进程内认证配置，Better Auth、业务写请求和协作 WebSocket 共用同一组精确来源。

自动配置只适用于回环开发地址（监听 0.0.0.0/:: 时也仅信任回环地址），且 `BETTER_AUTH_URL` 未设置或为合法回环 origin。认证来源跟随实际端口；Cookie 前缀包含 worktree 路径摘要和端口，避免同一 localhost 下的实例互相覆盖登录。更换 worktree 或端口后需分别登录，相同 worktree 在相同端口重启保持 Cookie 名称。配置只作用于当前进程，不写 `.env`；自定义域名/反向代理和打包部署继续使用显式配置，不自动信任任意 Origin。

各实例沿用现有 `DATABASE_URL`、上传目录和存储配置。共用数据库意味着文档、账号和会话记录仍共享；Cookie 隔离不等于数据隔离，也不改变当前协作服务的单实例实时同步边界。切换浏览器访问地址时，以启动输出的实际 origin 为准；其他 worktree 需要同步这段启动配置才能获得相同行为。

## 数据库隔离与维护

| 用途 | 数据库 |
| --- | --- |
| 本机开发 | `requirement_board`，Compose 显式创建 |
| API 测试 | `requirement_board_test`，测试工具按需创建并 truncate |
| 无头浏览器集成 | 各脚本专用的 `*_browser_test` |
| 服务器 staging / production | `requirement_board_staging` / `requirement_board_prod`，按部署流程维护 |

运行测试前确认进程中的 `TEST_DATABASE_URL` 和 `NUXT_DATABASE_URL` 没有指向开发库或远程库。不要让开发服务、自动化测试与 staging 共用数据库。

### 清理本机开发数据

`pnpm db:reset` 只说明范围，`pnpm db:reset --confirm` 才执行。先停止开发服务并断开数据库客户端，完成本地迁移。

工具只接受本仓库 Docker Compose 管理的 `localhost/127.0.0.1/[::1]:5438/requirement_board` 与 requirement 角色，拒绝远端 context、隧道、测试库和连接参数覆盖，同时核对 NUXT_DATABASE_URL。读取本地 .env，已有进程环境优先。

执行前用容器内 pg_dump 生成 `.local-data/backups/<时间>/requirement_board.dump`，并用 pg_restore --list 验证；失败或仍有其他连接则不清理。备份含认证数据，不得提交或分享。

事务内保留启用的 admin、密码、会话和 AI 凭证，清除其他账号和业务数据，重建固定项目、成员关系、状态及 REQ-1 至 REQ-7 手册，各有 v1。旧文档/关联/版本/模板/草稿/收据/锁/资源记录/申请/邀请/审计都会移除；物理上传文件、环境配置和浏览器偏好不变，失败整体回滚。

重置推进协作 editEpoch，防止旧页面重新写回清理前的编辑。完成后重启开发服务并刷新页面；旧页若有未确认输入，按恢复提示导出后加载新内容。普通 seed 或重连不会重建已有 Yjs 历史。

### 远程数据库调试配置

仅需联调时使用 `scripts/run-database-profile.mjs`。在独立终端运行 `pnpm db:tunnel`，将本机 15439 转发到服务器回环 5439；已有同端口隧道时复用，避免冲突。

| 命令 | 仓库配置的目标与权限 |
| --- | --- |
| `pnpm db:check:staging` | staging，rb_staging_debug；读写业务表，不能 DDL 或 truncate |
| `pnpm dev:staging` | 本地 Nuxt 连接 staging 数据库及 staging bucket，写入真实影响测试环境 |
| `pnpm db:check:prod:readonly` | production，rb_prod_readonly；仅查询并强制只读事务 |

配置分别在忽略的 `.env.staging.local`、`.env.production-readonly.local`，字段参考同名 example。脚本检查数据库、角色、隧道端口及实际权限；dev:staging 另检查部分必需表，**不能代替确认全部迁移已部署**。production 只读角色不能写登录会话和限流，因此不提供本地 Nuxt 只读启动命令。

不要通过这些 profile 执行迁移、seed、reset、API 测试或 GC。本地 db:migrate 不更新远端；服务器应用、数据库、私有 MinIO 和凭证的同步按 [部署说明](../deploy/README.md) 执行。

### 分支与发布

内部开发流程从 main 创建功能分支，分别合入 dev 验证、合入 main 发布；dev 为单向集成分支，禁止合回 main。GitHub 使用独立的公开历史，内部 Jenkins 配置不随源码发布。公开同步边界见 [发布说明](publication.md)，自建 CI 原则见 [Jenkins 职责](../deploy/README.md#日常发布与-jenkins-的职责)。

### 并行开发与迁移合并

`drizzle.config.ts` 已配置 `migrations.prefix: 'timestamp'`，新迁移及快照使用 UTC `YYYYMMDDHHmmss` 前缀；可以运行 `pnpm db:generate --name <英文用途>`。历史顺序编号文件不改名，新旧名称可共存。时间戳减少并行分支文件撞号；同一秒生成仍可能冲突，journal 与快照父子关系也仍需协调，不能把改名当作合并完成。

Drizzle 执行器依据 journal 的 `when` 与数据库最后一条迁移时间判断后续迁移。调晚已执行迁移的时间会重复执行；较早生成的分支迁移晚合入，又可能被跳过。

1. 开发时并行修改 schema；准备合并时先同步目标分支，再基于最新快照生成尚未发布的迁移。冲突同时核查 SQL、journal、snapshot，不能机械拼接 journal。
2. 已在共享环境执行的 SQL 和 `when` 保持不变，修正通过后续迁移表达。只有确认尚未发布、没有他人依赖的分支迁移才可重生成；使用新的个人隔离测试库验证，不重置共享或业务数据库。
3. 合并前运行 `pnpm db:check:migrations --base <目标分支或提交>`。工具只读取文件和 Git，忽略系统换行差异，检查历史 SQL/时间不变、新迁移晚于基线末尾、journal 连续、名称/快照前缀/时间唯一。它不会改写迁移或数据库。
4. `pnpm db:migrate` 自动执行基本结构检查；历史比对仍须另行指定准确基线。升级验证覆盖全新库和已迁移的库，不用 `ADD COLUMN IF NOT EXISTS` 掩盖账本不一致。

拉取代码或切换到包含新迁移的分支后，本机开发库也须执行 `pnpm db:migrate`。API/浏览器测试只迁移各自的隔离库，Jenkins 只迁移所部署的环境，均不会更新本机 `requirement_board`。交付本地验证前核对实际连接与迁移记录；例如新增防重复提交回执表的迁移未执行时，网页创建文档与保存模板会失败，不能因为隔离测试通过就认为当前开发库已经升级。

schema 3 的单元格身份升级须先暂停指向目标库的应用/写入进程。`pnpm db:migrate` 现在通过 `server/scripts/migrate.ts` 调用与部署相同的入口：先执行 SQL，再幂等升级旧共同文档 Yjs 和派生 JSON、提高 editEpoch 并废弃旧 AI 锁。不能只运行 drizzle-kit migrate 后就启动应用，也不需要 seed/reset；详情见 [共同编辑升级](collaboration.md#schema-3-单元格身份升级)。

历史修复：`0015_agent_annotation_receipts` 合并编号时曾将时间从 `1792161277753` 改成 `1792200614088`，导致已有 `completed_annotations` 的测试库重复添加列。现恢复原时间，SQL 不变；两种时间的库均可继续升级，无须修改数据库账本。以修复前提交为基线时，历史检查会报告这一项有意修复，需核对上述证据与回归，不能泛化为随意改历史的例外。`tests/api/migration-history.test.ts` 使用独立临时库验证两种记录、重复迁移及已有数据保留。

## 常用命令

| 命令 | 用途与边界 |
| --- | --- |
| `pnpm dev` | 本地开发 |
| `pnpm typecheck` | 前端 vue-tsc + 服务端 tsconfig.server.json；含审计类型反例 |
| `pnpm test:auth` / `pnpm test:unit` | 认证纯逻辑 / 编辑器、Diff 及 happy-dom 测试，无数据库 |
| `pnpm test:api` | 真实 API 和独立 PostgreSQL 测试库 |
| `pnpm test` | 全部 Vitest；包含需要数据库的 API 测试 |
| `pnpm ui:check` | 核对组件库和文档路径；升级后加 `--check-versions` |
| `pnpm db:generate` / `pnpm db:migrate` | 生成迁移 / 应用到目标库；先确认连接 |
| `pnpm db:check:migrations --base <目标分支>` | 合并前只读检查迁移顺序与历史不变性 |
| `pnpm db:seed` | 补缺失种子，不覆盖已有手册 |
| `pnpm auth:set-password <用户 ID、用户名或邮箱>` | 交互式设置已有账号密码，撤销其全部会话；不创建账号或成员 |
| `pnpm assets:gc:dry` | 预览资源清理 |
| `pnpm assets:gc` | 删除符合条件的文件及记录；只在任务授权且核对 dry-run 后执行 |
| `pnpm build` | 按需验证 Nuxt/Nitro 打包，不作为日常小改动必跑项 |

本人改密保留当前设备会话、撤销其他设备；紧急改密脚本撤销全部会话。容器内执行方式见 [部署密码维护](../deploy/README.md#初始化和重设登录密码)。

Windows 仅因执行策略拦截 pnpm.ps1 时可使用 pnpm.cmd，不修改系统执行策略。

## 测试环境

Vitest 默认 node，需要 DOM 的文件显式使用 `// @vitest-environment happy-dom`，不全局切换环境。

CLI 回归沿用默认并行度和 5 秒单例超时。Windows 配置/缓存共用进程内 SID 查询，但每次仍执行真实 ACL 设置；`agent-config-permissions.test.ts` 另覆盖并发查询、异常 SID、查询失败重试及权限失败。原生终端参数用完整参数集做一次隐藏窗口验证，默认安装参数由无进程用例检查，避免重复启动 PowerShell。不要用延长全局超时或重试掩盖这类进程启动开销。

`tests/setup/db.ts` 按 TEST_DATABASE_URL 创建、迁移、逐例 truncate 测试库并写 fixture。API 用例通过真实登录取得会话；新增 `*.cases.ts` 复用现有入口，不增加同时清空同库的并行入口。上传测试必须用 local 后端和临时目录。

迁移历史回归为每个用例创建随机命名的临时库，验证后删除。连接只接受本机 `_test` 库，或 `CI=true` 下 Jenkins 一次性网络内的 `postgres:5432/requirement_board_test`（`requirement_ci` 角色）；不允许使用线上或共享数据库地址。

浏览器默认无头。内置 Chromium 不可用时，临时设置 `BROWSER_TEST_CHANNEL=chrome` 或 `msedge`，不提交机器路径。首次安装可用 `pnpm exec playwright install chromium`。测试结束关闭临时浏览器/服务并清理临时文件；不停止已有开发服务。需要截图时用 `BROWSER_TEST_ARTIFACT_DIR`，检查后清理，截图不作像素基线。

### 编辑器的浏览器验证

`BROWSER_TEST_SCENARIO=details pnpm test:browser:editor` 与 `pnpm test:browser:workspace` 验证 REQ-36：创建/取消折叠块、按钮键盘操作、CDP 中文组词、普通/Yjs 撤销、只读展开、双页文字同步及本机展开状态隔离；覆盖目录/章节链接/AI 标注/版本标记定位、嵌套 Diff、回退和选区历史。检查 320/390/960/1440px 亮暗主题与减少动态效果。PowerShell 先设置 `$env:BROWSER_TEST_SCENARIO='details'`。页内查找在无头环境验证 `window.find` 能命中隐藏文字，并发送 `beforematch` 检查嵌套揭示；不模拟浏览器原生查找面板。`tests/diff/details.test.ts` 覆盖严格 schema、ID、纯文本、HTML/Markdown、模板、尾段、标注和历史；`tests/api/details.cases.ts` 覆盖真实 API 创建/修改/保存、非法 JSON、旧客户端能力拦截、Yjs 历史延续和模板复制。双页夹具传递真实 Yjs 更新，不替代 WebSocket 网络测试或系统输入法实机验证。

`BROWSER_TEST_SCENARIO=task-lists pnpm test:browser:editor` 与 `pnpm test:browser:workspace` 验证 REQ-35：工具栏/斜杠/三种输入规则、Enter/Tab/Shift+Tab、GFM、独立撤销、中文组词、只读和双页 Yjs 合并，以及嵌套任务 Diff、文字标注、锁定和选区历史；检查 320/390/960/1440px 亮暗主题、减少动态效果及自定义字号/行高/颜色。PowerShell 先设置 `$env:BROWSER_TEST_SCENARIO='task-lists'`。`tests/diff/task-list.test.ts` 覆盖节点校验、稳定 ID、模板、复制和历史恢复；`tests/api/task-list.cases.ts` 在独立测试库运行真实 Skill 创建/读取/校验/提交、旧客户端写入拦截、历史版本、Yjs 二进制重载及模板创建。浏览器夹具不代替真实协作网络测试。

`BROWSER_TEST_SCENARIO=task-lists pnpm test:browser` 使用真实 Nuxt 服务与独立 `_browser_test` 库，验证 HTTP/WS 双页勾选、远端文字与本地撤销、正式保存、刷新重载、Diff，以及未声明任务节点能力的旧页面被拒绝接入。此验证需要编译隔离测试应用。

`BROWSER_TEST_SCENARIO=chapter-links pnpm test:browser:editor` 与 `pnpm test:browser:workspace` 验证 REQ-32 的标题链接：鼠标/Tab/ContextMenu/Shift+F10、只读和协作无写入、剪贴板失败、正文复制、新页面定位、`view=diff` 优先级、无效参数清理、用户中断、版本比较和选区历史，以及320/390/960/1440px亮暗主题下的 AI 编号与版本竖条避让。工作区增加定位途中字体/宽度变化及滚轮中断回归，检查到达提示消失后仍保持标题位置；另模拟扩展在段落和列表上追加辅助属性，覆盖普通/减少动效下上、下两个标题的真实 DOM 重建，以及到达后再次重绘时的位置、强调区域和正文/选区不变。工作区使用真实页面和滚动实现、固定数据夹具；缓存路由意图和阅读位置竞争另由 `chapter-links.test.ts`、`chapter-reading-position.test.ts`、`editor-geometry.test.ts` 覆盖，不连接业务数据库或修改正文持久化格式。

`BROWSER_TEST_SCENARIO=chapter-links pnpm test:browser` 在隔离数据库运行真实 Nuxt 首屏、登录与协作初始化；390/1440/1920px 分别检查普通/减少动态效果下，新标签页到达提示及提示消失后的持续定位。可用 `BROWSER_TEST_CHAPTER_DOCUMENT` 指向含 `contentJson` 的只读导出样本，`BROWSER_TEST_CHAPTER_ID` 指定标题 ID，`BROWSER_TEST_CHAPTER_IMAGES_DIR` 提供按上传文件名保存的原图目录；图片重新上传至隔离测试服务，不引用业务库资源。`BROWSER_TEST_ARTIFACT_DIR` 可保存到达提示截图。

`BROWSER_TEST_SCENARIO=callouts pnpm test:browser:editor` 与 `pnpm test:browser:workspace` 分别验证 REQ-30 的四种提示块、切换/撤销/协作，以及标注、Diff、设置预览和选区历史；生产只读取值检查和范围见 [REQ-30 验证记录](req-30-callout-validation.md)。`callout-sync` 单独验证首次类型切换与双页 Yjs 同步，`passive-loading` 单独运行既有被动加载矩阵，检查初始化不产生正文修改。

`BROWSER_TEST_SCENARIO=operations pnpm test:browser:workspace`（PowerShell 先设置同名进程环境变量）验证两秒延迟下立即收起弹窗、连续属性选择、跨字段合并、搜索焦点、响应丢失的原请求重试、刷新失败、窄屏属性恢复、模板、成员角色、申请审批和账号停用。属性提示按字段和提交轮次独立：同一字段未完成的连续选择更新同一提示，已完成或失败的结果不被后续操作覆盖。接口幂等性由 `tests/api/documents.cases.ts` 验证，`operation-feedback.test.ts` 覆盖账号隔离、提示关闭、字段队列与不明提交恢复。

`BROWSER_TEST_SCENARIO=operations pnpm test:browser` 使用本机独立 `_browser_test` 数据库和真实 Nuxt、IndexedDB、协作及版本接口，验证正常保存、协作请求挂起后的超时恢复、版本响应丢失后的幂等重试及列表刷新失败；同时检查标题只通过 Toast 展示等待状态、失败和校验可恢复，以及创建后自动跳转不残留结果条、创建期间切页保留入口并在打开目标后清除。此命令需要测试应用编译，不能用替换 `prepareVersion` 的工作区用例代替。

| 命令 | 覆盖与限制 |
| --- | --- |
| `pnpm test:browser:editor` | Vite 挂载真实编辑器，验证普通/协作撤销、ID、输入格式、IME、剪贴板、图片、题注鼠标选区与局部编辑，以及全局 Cursor 的段落稳定性 |
| `pnpm test:browser:workspace` | 真实侧栏、工作台/文档/模板/成员、详情和选区历史页面；验证搜索、筛选、属性/目录切换与抽屉、正文保留、版本按需加载/缓存/重试、比较联动、设置、主题与窄屏。接口用固定数据替代，不写入开发数据库 |

两者替换 Nuxt 数据或部分运行时接入，不连接业务数据库，也不验证真实登录、上传服务或协作网络；无需 Nuxt 构建。接口或持久化变化另跑对应测试。`revision-documents.test.ts` 和 `requirement-outline-visibility.test.ts` 覆盖乱序、取消与隐藏测量等边界。工作区测试还覆盖 AI 标注的布局不变、Bing UI 紧凑横排与中文输入法、编号避让和圆弧摆动、输入框中心晃动、外部点击/滚轮/快捷键拦截、Tab 循环、输入区内部滚动、取消和卸载恢复、折行和跨段整体定位、跨屏选区起点、单行格式区分、亮暗主题、平滑定位后强调、连续点击与用户中断、减少动态效果、窄屏抽屉焦点、选区复制、批量导出到 Skill 定位器、本机恢复、剪贴板拒绝、同步失败与过期标注；共享定位和 CLI 的异常输入由 `ai-annotations.test.ts` 验证。

`BROWSER_TEST_SCENARIO=context-caret pnpm test:browser:editor` 在正常动效下验证普通/协作表格的右键光标：文字、上下留白、空格、表头与合并格均保持有效格内选区和文字高度，且不产生正文更新；分开右键按下与松开，记录选区事件及逐帧光标位置，检查一次手势只定位一次，同时检查继续输入、插行与撤销。完整编辑器测试也包含此场景。

### 需求切换的浏览器验证

`BROWSER_TEST_SCENARIO=object-annotations pnpm test:browser:workspace` 验证提示块整体与文字标注、图片/嵌套图片、整表、合并/空格、鼠标/键盘和触屏取消、水平定位、v2 混合复制、输入保护与回执；`annotations` 单独运行原文字标注全套回归。它们保持无头、不写业务库。`tests/diff/annotation-nodes.test.ts` 通过只注册一个未来普通节点验证扩展，不改标注核心；旧 v1/v2 恢复及回执兼容由 annotation-storage 覆盖。原图读取、提示块真实写入与旧文档升级由 `tests/diff/annotation-objects.test.ts`、`agent-image-reading.test.ts`、`tests/api/annotation-objects.cases.ts` 覆盖。

工作区脚本同时验证固定 Header、导航 224→0、快速反向动画、编辑器实例保留、1000/700px 边界、覆盖导航的焦点循环/恢复及桌面 Cookie。设置 `BROWSER_TEST_SCENARIO=shell` 可单独检查导航外壳、BingButton 路由事件和主题；`pages` 可验证工作台、文档、模板和成员页面，`workbench` 可只验证首页工作台（拖拽、撤销、冲突、菜单、动态、负载、完成节奏与各宽度）；配合截图做布局检查。`board-meta.test.ts` 验证全局创建与列表的元数据请求去重、失败重试和账号隔离。

`BROWSER_TEST_SCENARIO=click-feedback pnpm test:browser:workspace` 在普通动效下验证碎屑原生动画及标签选中态先于重内容挂载、快速反向切换、编辑器与正文保留、侧栏最新导航、卸载取消和减少动态效果。默认验证 npm 正式包；发布前联调可设置 `BROWSER_TEST_UI_CANDIDATE=1`，升级后移除候选开关复验。用例检查执行顺序，不设置依赖机器性能的毫秒阈值；它不把 rAF 采样等同于实际屏幕呈现。`after-paint.test.ts` 另覆盖隐藏页面及 rAF 停止时的兜底与只执行一次。

S5 可用 `BROWSER_TEST_SCENARIO=detail` 检查属性确认/取消/失败、正文样式、面板键鼠拖动/取消、920px工作区边界、阅读段落/选区/实例保留及比较宽度；`settings` 检查固定弹窗、分类恢复、亮暗配色、Cookie失败和窄屏；`layout` 跳过较长的 AI 标注与设置专项，保留工作区、模板和首页工作台布局流程。完整脚本仍包含 AI 标注输入保护等回归。真实账号脚本同时验证改密结果、一次性凭证明文清除和无项目资格不请求凭证。

Nuxt 的 Vite SSR 阶段将 shared 模块留给 Nitro 继续打包。`makeAbsoluteExternalsRelative: false` 保留已解析的源路径，避免原始相对导入被重写为中间产物旁不存在的 shared 路径；不是机器专属路径配置。选项语义见 [Rollup 配置](https://rollupjs.org/configuration-options/#makeabsoluteexternalsrelative)。

下列脚本启动临时 Nuxt 测试服务，通过真实登录/API 使用各自独立库及上传目录；测试工具会在临时目录构建服务。

| 命令 | 默认数据库 / 端口 | 核心覆盖 |
| --- | --- | --- |
| `pnpm test:browser` | `requirement_board_browser_test` / 3137 | 标题独立保存、双标签同步、A → B → A 输入与阅读位置、IME/最近浏览；45 条文档的远程分页排序、失败重试、分组按需加载/共享列设置、首页工作台与列表数量一致、真实拖拽/撤销/冲突，以及跨页搜索/关联 |
| `pnpm test:browser:documents` | `requirement_board_documents_browser_test` / 3139 | 四类文档、模板、负责人、流转、失败恢复、筛选，以及关联的多选、持久化和双向实时解除 |
| `pnpm test:browser:agent` | `requirement_board_agent_browser_test` / 3138 | CLI 下载、凭证真实分页/筛选/撤销确认/失败重试、编辑锁、多标签同步、离线保护、草稿/正式版本与旧入口兼容 |

快速切换和 Agent 脚本支持 BROWSER_TEST_DATABASE_URL 和 BROWSER_TEST_PORT；库必须为本机且以 `_browser_test` 结尾。快速切换默认执行全部场景，设置 `BROWSER_TEST_SCENARIO=pages` 可单独复验文档分页，`workbench` 验证真实登录、创建/流转下首页数字与负载格子和列表一致、拖拽/撤销/冲突/菜单完成与 SSR。其他脚本的环境入口以各自文件为准。验证宽窄视口和亮暗主题，不用内存夹具结果代替真实持久化验证。

`BROWSER_TEST_SCENARIO=search pnpm test:browser` 使用真实 Nuxt 与独立浏览器测试库，挂起详情和元数据响应，验证点击后先进入详情加载框架、首次仅读取一次详情、失败重试、失效目标与缓存返回，以及草稿保留。分别用鼠标和键盘操作每条结果右侧的「在新标签页打开」按钮，核对原页不导航、查询和草稿保留、新页可编辑且没有 opener；点击结果本身和输入框 Enter 继续在当前页跳转。检查320/390/1440px亮暗布局中的逐行按钮与文本避让。接口只对指定读取模拟等待或失败，登录、正文恢复与新标签页直接访问均走真实流程；此验证需要编译隔离测试应用，默认使用 npm 正式包。

`BROWSER_TEST_SCENARIO=performance` 使用真实 Nuxt 路由、协作接口和无头 Chromium，默认执行 20 次正文/比较切换、四个侧栏入口各 20 次往返、三篇文档 LRU 淘汰，以及三段不少于 10 秒的滚动。`BROWSER_TEST_DOCUMENT_V4`、`BROWSER_TEST_DOCUMENT_V5` 指向含 contentJson 的本地样本 JSON，`BROWSER_TEST_IMAGES_DIR` 指向对应原图目录；图片通过本机隔离服务上传，生产数据只用于只读导出。未提供样本时使用内置文字夹具，不将其称为原图测量。

设置 `BROWSER_TEST_ARTIFACT_DIR` 保存 results.json、视图切换、路由往返及三份滚动 Trace；点击计时包含自动化操作及两个 rAF，仅表示 DOM 可用代理值，不是最终呈现时间。滚动按实际 scrollTop 检查顶部至文末往返，再覆盖中段快速反向。样式、布局、脚本 CPU 时间取 Chromium Performance 指标，Trace 供 DevTools 复核；`node tests/browser/analyze-requirement-performance.mjs <目录>` 生成呈现反馈、绘制和交互分位数报告，主帧报告与派生报告分开统计。对照 main 时用 `BROWSER_TEST_APP_ROOT` 指向独立源码副本，并设 `BROWSER_TEST_PERFORMANCE_BASELINE=1` 关闭仅适用于新缓存的实例断言。运行期间避免并行构建或其他性能测试；样本、原图和临时副本不得提交。

性能场景在页面初始化前显式设置 `window.__RB_DETAIL_RETURN_TIMING__=true`，启用 `rb:detail-return:*` User Timing。普通运行不采集、不上报。每次返回按 run 关联账号检查、激活时点、详情/辅助信息/协作读取、协作合并、编辑状态设置、正文导出、阅读位置恢复，以及可编辑/两个 rAF 的累计时间；`results.json.returnStages` 保留原始阶段起点和耗时，分析脚本给出分位数与每轮事件数。阶段可能并行或嵌套，不能直接相加；请求阶段含浏览器调度、响应解析等开销，不等于服务器执行或纯网络耗时。`frames-ready` 是浏览器内部代理值，原 `routesMs.enter` 继续保留自动化观察口径。

经授权修改组件库后，可用 `BROWSER_TEST_UI_CANDIDATE=1` 在上述真实 Nuxt 测试中加载 `dev-repos.local.json` 指定的 `bing-ui/dist`，验证发布前的构建产物。此开关只影响测试，不替换应用的 npm 依赖；发版并升级依赖后应按默认路径复验。

`pnpm test:browser:editor` 也支持同一候选开关。图片缩放回归覆盖四种比例、左中右对齐和普通/Yjs 协作编辑，在同一次角手柄拖拽中跨过横纵位移分界并反向微调，检查实际显示、JSON/Yjs 尺寸、题注与稳定 ID，以及重新加载后的尺寸。该夹具验证编辑器数据更新，不连接业务数据库。

图片缩放光标用例另行开启正常动效，在普通/Yjs 模式下把输入位置留在图片下方，逐帧检查放大、缩小和反向拖动时的光标贴合与常亮，并验证停住指针、松手、Escape、取消、窗口失焦、移出窗口和编辑器隐藏后的恢复。不能只在减少动态效果模式下验证此交互。

图片上传光标用例使用真实剪贴板粘贴并挂起上传响应，在普通/Yjs 模式下覆盖段首、段中、段末、空段、格式边界、段内换行和列表，检查等待时的文字光标坐标与高度、继续输入、失败重试和取消；段首和空段同时验证中文组词及提交。占位不得进入正文 JSON，完成后继续输入，协作正文仍须一致；上传接口由浏览器拦截，不写业务数据。

连续图片上传用例在普通/Yjs 模式下连续粘贴同一张图片两次或三次，逐个放行上传响应，检查每次完成后的图片数量、顺序、唯一 ID、剩余占位、上传计数和备份检查点。覆盖空段、段中、段末、等待时继续输入、两次完成之间的远端更新、首图失败后重试、取消排队图片，以及插入事务被拒绝后复用已上传资源重试。通过挂起响应复现慢网，不依赖 MinIO 或真实业务数据。

测试观察：Windows 无头 Chromium 的 CDP 组词模拟在段内换行后紧邻上传占位时出现过拼音残留，修改前后均有；真实输入法尚未复现，暂不按已确认缺陷处理。该位置目前只覆盖直接输入。

`BROWSER_TEST_SCENARIO=cache-safety` 可独立验证缓存期间远端修改、详情/协作分别延迟时的只读门禁、慢/失败的辅助信息不阻塞、AI 锁/代次、403 淘汰及退出更换账号；不需要重复录制性能 Trace。REQ-10 的基线、逐轮数据和限制见 [验证记录](req-10-performance-validation.md)。

`BROWSER_TEST_SCENARIO=smooth-scroll` 使用独立测试库的长正文，检查首次打开、正文/版本比较切换，以及工作台、文档列表返回详情后的滚轮惯性。显式关闭减少动态效果，模拟 120/80/96 像素输入，并重放线上 110% 缩放的 `deltaY=90.909 / wheelDeltaY=-109`、125% 缩放及反向档位，逐帧验证事件接管、非瞬时位移和最终距离；它不模拟浏览器扩展或所有真实设备，不能替代现场输入的诊断。

标注原文编辑确认由 `annotation-edit-guard.test.ts` 验证事务、撤销与真实 Yjs 同步边界；工作区无头测试中的 `annotation-edit-confirmation.mjs` 覆盖真实打字、删除、粘贴、原生中文组词、取消、确认清除、多标注、持久化及窄屏暗色。取消必须同时保持浏览器正文 DOM 和正文 JSON 不变。

标注完成回执由 `annotation-storage.test.ts` 覆盖摘要匹配、编辑中保护、账号/文档切换、跨标签页变化、本机写入成功后确认及网络失败；`annotation-completion-gc.test.ts` 验证启动/每小时回收、失败重试、不重叠及关闭时清理。`tests/api/agent-suggestions.cases.ts` 验证只有成功操作的原账号可查回执，校验、失败、取消和旧摘要均不清除，并覆盖部分/并发/重复确认、7 天到期、物理回收及操作幂等。工作区无头测试验证复制 → 回执 → 自动清理 → 确认回收，以及关闭页面后重新打开补查。

应用启动后会自动回收超过 7 天的临时标注完成信息，运行期间每小时执行一次；不需要另配定时任务，也不删除 AI 操作记录或本机标注。完整规则见 [Agent 文档](agent-editing.md#从网页传递-ai-标注)。

## 按改动选择验证

REQ-59 使用 `BROWSER_TEST_SCENARIO=demo pnpm test:browser` 验证真实游客路由、编辑与比较、资源/请求/存储隔离、匿名 API/WS 拒绝和登录账号草稿保留。使用本机独立 `_browser_test` 库及临时上传目录，需要编译测试应用；不读取生产样本。范围及单测见 [游客体验](demo.md#验证)。

`pnpm test:browser:auth` 连接已启动的本机 Nuxt 开发服务（默认 `http://localhost:3000`，可设置 `BROWSER_TEST_BASE_URL`），在隔离无头浏览器中验证真实路由、中间件与 App 生命周期。浏览器 API 全部拦截，不创建真实登录会话或写业务数据；权限检查故意延迟 600ms，逐帧检查登录首帧、登出前布局、退出失败、取消导航、会话失效重定向、侧栏收起偏好与待审批账号跳转，并确认手动开合仍有动画、切换不刷新整个页面。`BROWSER_TEST_ARTIFACT_DIR` 可保存帧采样 JSON。认证 API 及 SSR 初始身份/侧栏偏好另用 `pnpm exec vitest run tests/api/requirements-api.test.ts -t authentication` 在本机独立测试库验证；该命令需要编译测试应用。

REQ-52 使用 `BROWSER_TEST_SCENARIO=login pnpm test:browser:workspace` 验证三个 HTML/CSS 产品场景、真实动画暂停续播、登录状态同步、静态 Logo、无 Rive 请求，以及校验/焦点/选区/CapsLock、防重复提交、全部错误映射、Toast 关闭/重试/恢复、成功反馈等待、用户名/邮箱与 redirect。覆盖减少动态效果、触屏、场景模块失败/延迟卸载、320–1440px 亮暗布局、紧凑表单间距及文字对比度；平板和手机不加载场景模块。`BROWSER_TEST_ARTIFACT_DIR` 可保存六份响应式截图、三场景关键帧和提交中/错误 Toast/成功状态截图。接口响应受控，不写业务库，不代替真实会话或生产首屏性能基准；设计与动效说明见 [登录页交互与视觉](login-experience.md)。

AnimatedText、Button、Checkbox、Dialog、DropDown 和 Tooltip 的本轮联动覆盖见 [bing-ui 0.16.0 验证记录](bing-ui-0.16.0-validation.md)。新增 `BROWSER_TEST_SCENARIO=consumer-accounts pnpm test:browser:workspace` 通过真实账号组件与受控接口响应检查登录、角色选择、凭证和修改密码；不连接业务数据库。

REQ-53 使用 `BROWSER_TEST_SCENARIO=account pnpm test:browser:workspace` 验证真实账号页：与工作台一致的全宽面板边界、四张独立卡片且无冗余页内导航、头像和身份复制、三步 AI 引导与本机账号隔离、密码实时校验、完整凭证状态计数/分页/到期/创建/撤销/明文清除、加载失败重试、键盘操作，以及320/390/960/1280/1440px亮暗布局；另在1280×800、1366×768、1440×900、1920×980下检查未完成的完整引导及两条有效凭证能在首屏展示，10条历史记录在表格内滚动，分页入口仍在首屏，表格操作列没有横向溢出。浏览器时钟推进真实 60 秒定时器，覆盖后台不请求、审批拒绝/重申/通过跳转及卸载清理；接口响应受控，不写业务库。`agent-token-page.test.ts` 覆盖分页与摘要原子替换、失败恢复、迟到请求和卸载；`tests/api/accounts.cases.ts` 检查账号接口头像颜色与字段白名单。可用 `BROWSER_TEST_ARTIFACT_DIR` 保存截图，查看后清理。

REQ-34 使用 `tests/diff/slash-commands.test.ts` 验证触发边界、命令可用性、普通/Yjs 撤销、上传分组、远端更新及本机菜单状态隔离。`BROWSER_TEST_SCENARIO=slash-commands pnpm test:browser:editor` 覆盖实际键盘输入、中文名称/英文别名、常用块与 3×3 表格、取消/无匹配、CDP 组词期间保留菜单及提交/取消、候选按键不被菜单拦截、文件选择期间菜单不重开和图片上传、只读/停用及 320/390/960/1440px 亮暗布局。浏览器使用真实组件和 Yjs，上传由受控响应提供，不连接业务数据库，也不代替系统输入法实机验证。组件库发布前需设置 `BROWSER_TEST_UI_CANDIDATE=1`，发布升级后按默认路径复验。

选图回归在交互开始前注册持续的 `filechooser` 监听，并在结束时移除。Playwright 启用文件窗口拦截是异步操作，仅在按 Enter 前调用 `waitForEvent('filechooser')` 可能与按键竞争，导致无头 Chromium 直接取消选图；此问题也能在不含编辑器的原生文件输入框上复现。各用例仍等待真实 `filechooser` 事件，再选择文件并验证上传及撤销，不通过延长超时或直接设置 input 文件跳过触发链路。

`BROWSER_TEST_SCENARIO=slash-layout pnpm test:browser:editor` 可单独验证命令菜单的亮暗窄屏布局、开关前后工具栏与正文之间无额外占位，以及局部边界和向上展开；同样包含在完整斜杠命令回归中。

Windows Chromium 在开启“在键入时隐藏指针”时，部分版本通过键盘打开系统文件窗口会延续隐藏状态；这是 [Chromium 原生窗口缺陷](https://issues.chromium.org/issues/566473053)，网页 CSS 无法可靠恢复系统指针。排查时核对正在运行的浏览器版本及系统设置；无头 filechooser 回归只验证选图事件和上传流程，不能声称已验证系统文件窗口中的指针显示。

REQ-31 通过 `tests/diff/code-highlight.test.ts` 验证语言历史、装饰映射、IME/视口调度、缓存与长度限制；`BROWSER_TEST_SCENARIO=code-blocks` 配合编辑器与工作区两个浏览器入口，覆盖真实语言搜索、原文复制及拒绝、跨块剪贴板、CDP 组词、独立撤销、双页 Yjs、文字标注、只读历史/Diff/选区历史、个人设置与亮暗窄屏。发布前可用 `BROWSER_TEST_UI_CANDIDATE=1`，仅从已通过 `ui:check` 的仓库加载候选构建；Vitest 也支持同一开关。默认仍使用 npm 发布包。

REQ-33 使用 `BROWSER_TEST_SCENARIO=table-columns` 配合 `pnpm test:browser:editor` 和 `pnpm test:browser:workspace`：前者验证实际列宽拖动、80px 下限、单次写入及独立撤销、双击自动宽、取消/锁定/隐藏/卸载、只读/触屏、平滑光标、双页 Yjs 在拖动中插列后的收敛；后者验证整表/单元格标注、修改标记、Diff 比例/说明/无字符增删、设置预览与 320/390/960/1440px 亮暗布局。夹具不连接业务数据库，双页由测试驱动交换真实 Yjs 状态，不代替真实 WebSocket 持久化验证。`table-column-width.test.ts` 另覆盖合并格、远端删除、身份歧义和列宽序列化，原有 annotation-nodes/annotation-objects 覆盖新旧标注签名。

代码块长文性能场景为 `BROWSER_TEST_SCENARIO=code-performance pnpm test:browser:editor`，需显式指定 `BROWSER_TEST_DOCUMENT`、`BROWSER_TEST_IMAGES_DIR` 和 `BROWSER_TEST_ARTIFACT_DIR`。可用 `BROWSER_TEST_CODE_BASELINE=<提交 SHA>` 在测试服务内读取该提交的代码块 NodeView 和正文样式作对照，不修改工作区。使用相同 REQ-8 正文和原图，普通动效、真实输入/滚轮、三轮文首/中段/文末输入及撤销；报告处理时间、两个 rAF 代理值和滚动帧间隔，不代替真实 API/WebSocket 或系统输入法测量。测量时不并行其他测试或构建，结果见 [REQ-31 验证记录](req-31-validation.md)。

REQ-29 的字体设置由 `app-preferences.test.ts`、`editor-geometry.test.ts` 验证旧 Cookie 兼容、非法字体名、首屏 CSS 和阅读锚点；`BROWSER_TEST_SCENARIO=settings pnpm test:browser:workspace` 覆盖实际字体测量、预设/本机列表/手动输入、权限拒绝与不支持、未安装确认、虚拟列表、键盘、保存重试/刷新、标题/Diff/选区历史以及320/390/960/1440px亮暗界面。字体枚举权限分支用受控 API 结果，字体渲染仍使用本机真实字体。`BROWSER_TEST_SCENARIO=fonts pnpm test:browser:editor` 覆盖全节点、只读历史、长文换行后的阅读位置和普通/真实 Yjs 状态及个人撤销；该场景也包含在完整编辑器测试中。使用 `BROWSER_TEST_ARTIFACT_DIR` 保存截图到忽略目录，检查后清理临时产物。

设置场景同时验证本机字体 localStorage 缓存：点击完成后重开、刷新恢复且不重复请求权限、重新读取替换列表、拒绝后保留旧缓存、字体名校验与去重、损坏/未知版本缓存，以及配额不足时的本页内存降级和明确提示。

REQ-27 的正文版本标记使用 `BROWSER_TEST_SCENARIO=version-markers pnpm test:browser:workspace` 验证三类标记、卡片、恢复/撤销、标注确认、比较定位、权限/锁、偏好 Cookie 与四种宽度亮暗主题；也覆盖相邻同类标记跨段落、分隔线、代码和列表连接，删除/未修改块/不同状态断开，段间点击与单块恢复。连续笔画另按1/1.25/1.5设备像素比与16/19/20px字号检查截图像素，避免仅检查 DOM 坐标而漏掉细缝；悬停/键盘正文强调验证范围、普通/减少动效、移开/滚动/隐藏清理及正文和选区不变。300 段连续修改验证滚动裁剪、排版变化和单块 Diff，该长文场景是功能回归，不代替性能测量。同一场景配合 `pnpm test:browser:editor` 验证双页真实 Yjs 修改、恢复和个人撤销。双页通过测试驱动交换 Yjs 状态，不代替真实 WebSocket / 数据库持久化验证。

REQ-28 的全节点视觉回归包含在完整 `pnpm test:browser:editor` 和 `pnpm test:browser:workspace` 中，也可用 `BROWSER_TEST_SCENARIO=node-visuals` 单独运行。编辑器场景覆盖普通/Yjs 模式的标题、列表、引用、提示、代码、表格、高亮、分隔线和图片，检查空段落提示、图片描边、只读历史、正文/Yjs 不变及个人撤销；工作区场景验证真实版本比较与独立亮暗配色的设置预览。设置 `BROWSER_TEST_ARTIFACT_DIR` 可保存320/390/960/1440px亮暗全节点长截图及 Diff 截图；截图保存在忽略目录供评审，不提交。夹具使用真实组件和内存数据，不替代业务数据库或 WebSocket 持久化验证。

长文开关对照使用 `BROWSER_TEST_SCENARIO=version-markers-performance pnpm test:browser:workspace`，并配置 `BROWSER_TEST_DOCUMENT_V5`（含 contentJson 的本地样本）、`BROWSER_TEST_IMAGES_DIR`（对应原图）与 `BROWSER_TEST_ARTIFACT_DIR`（结果目录）。每个开关状态交替执行三轮，记录输入事件处理、两个 rAF 代理值、输入与滚动帧间隔和长任务；两个 rAF 不代表最终呈现时间。单独运行，避免并行构建/测试，样本、原图及原始结果不提交。结果和限制见 [REQ-27 验证记录](req-27-version-markers-validation.md)。PowerShell 用 `$env:BROWSER_TEST_SCENARIO='version-markers'` 设置环境变量后再运行命令。

Agent 关联与分页由 `tests/diff/agent-discovery-cli.test.ts` 和共用 API 入口注册的 `tests/api/agent-discovery.cases.ts` 验证：覆盖同站路由、双向关联及双方编辑锁、版本隔离、失败回滚，250 条/13 页无重漏及筛选排序一致性。API 用例实际启动 CLI 完成创建、恢复收据、修改和关联，在独立测试库及临时 CODEX_HOME 中运行，不读取本机凭证或写业务库；无需可见浏览器。Skill 包沿用 serverAssets 文件清单，业务能力版本为 10（精简状态流程），正文 schema 仍为 3。

REQ-12 性能复测可设置 `BROWSER_TEST_PERFORMANCE_ROUNDS=3`、`BROWSER_TEST_CPU_RATES=1,6`，每个 CPU 条件按轮次分别输出结果。`BROWSER_TEST_INPUT_SECONDS=30` 增加文首/中段/文末连续字符输入，`BROWSER_TEST_IME_SECONDS=30` 另测 CDP 中文组词确认；`BROWSER_TEST_PERFORMANCE_INPUT_ONLY=1` 只运行输入及撤销校验。每种 CPU 条件的第一轮执行三段完整滚动，其余轮只执行切换/导航/输入，避免将录制成本混入其他测试。`BROWSER_TEST_PERFORMANCE_BASELINE=1` 用于旧源码对照，仅跳过新缓存实现专属断言，不跳过正文完整性检查。

原始输入保留 beforeinput、处理结束及两个 rAF 的代理记录；`analyze-requirement-performance.mjs` 从 Trace 中关联 EventTiming，分别输出 Chromium 呈现反馈与代理值、未匹配事件数。CDP IME 只验证浏览器协议，不代表 Windows 搜狗输入法；CPU 降速也不能代替低性能实机。测量时不并行构建或其他测试，样本/原图/Trace 作为本地产物保留，不提交 Git。

只做降速诊断时可另设 `BROWSER_TEST_THROTTLED_ROUNDS=1`，正常速度仍按上述轮数测量；报告必须列明各条件实际轮数，不能把降速一轮当作低性能实机三轮验收。

REQ-12 的样本、对照条件、测量结果和实机边界见 [验证记录](req-12-performance-validation.md)。

| 改动范围 | 最小验证 | 按风险追加 |
| --- | --- | --- |
| Markdown | `git diff --check`、相对链接/锚点和命令检查 | 无需构建 |
| shared/editor 或 shared/diff | `pnpm test:unit`、`pnpm typecheck` | 持久化变化再跑 API |
| Vue 编辑器或 Diff | 相关单测、类型检查、对应无头交互 | 集成或打包疑点再构建 |
| API、数据库、seed、上传/GC | `pnpm test:api`、类型检查 | 跨服务风险再扩大测试 |
| 登录、会话与项目权限 | 认证测试、API 测试、类型检查 | 无头验证登录、刷新、退出和过期 |
| Schema/迁移 | 审查生成 SQL/快照，迁移及 API 测试 | 干净测试库验证迁移链 |
| 跨层功能 | 相关端到端流程、全量 Vitest、类型检查 | 有构建相关风险再跑 build |

按实际改动覆盖关键路径，不机械重复无关套件。只运行 vue-tsc 不包含服务端，不能替代 pnpm typecheck。

## 数据库迁移规则

1. 修改 `server/db/schema.ts`，运行 `pnpm db:generate`。
2. 审查新增 SQL、`drizzle/meta/` 快照和 journal，只包含预期变化。
3. 确认目标库后应用迁移并执行 API 测试。
4. 更新契约及部署说明；通常不需要重新 seed 或 reset。

不手改 snapshot，不因本机状态改写旧迁移。升级须应用当前迁移链，而不是按历史功能逐个挑选。账号停用字段替换等不兼容迁移须同步部署应用；类型/模板的存量映射见 [类型文档](document-types-and-templates.md#升级与验证)。

## 运行时文件与排错

不手改或提交 `.nuxt/`、`.output/`、`dist/`、`node_modules/`、`.local-data/`、`public/uploads/`、真实 .env、日志或测试报告。`drizzle/` 是受版本控制的迁移历史，不是可删除缓存。

网页与 Skill 共用的 `skills/requirement-board/scripts/annotation*.mjs` 由 `nuxt.config.ts` 显式加入 Nitro 内联打包，覆盖协议、对象定位及节点能力注册表；匹配规则兼容 Windows 和 POSIX 路径。不要仅内联入口文件：开发模式外置其重导出模块时，相对路径可能被错误改写到项目外，导致服务报模块不存在。改动共享脚本的引用或打包配置时，须验证实际 `pnpm dev` 服务的页面和 API；单测、生产模式 API 测试及 Vite 组件测试不能覆盖此路径。

启动失败依次检查：锁定依赖能否安装 → Compose 数据库是否 healthy、5438 是否占用 → DATABASE_URL/NUXT_DATABASE_URL → 迁移和 seed → 对应 Nuxt、数据库或浏览器错误。服务端配置与部署故障转到 [deploy/README.md](../deploy/README.md)。
