# Codex 安装、更新与卸载

需要 Node.js 22 或更高版本，不需要 npm install。当前安装向导面向 Codex。

文档正文缓存位于同一 Codex 用户目录的 `requirement-board/cache/`，按站点和凭证摘要隔离，更新 Skill 不删除缓存。缓存不包含 Token，仍是业务文档副本；每次使用先经服务端认证和条件校验，缓存损坏会重新读取。卸载和 --purge-config 不自动清理业务缓存；Skill 自动备份按下方保留规则回收。

## 让 AI 帮你安装

在“我的账号”点击“复制安装链接”，将复制的安装请求和链接一起发给本机 Codex。AI 读取 `/api/agent/setup` 的公开说明，从 `/api/agent/skill` 下载不含凭证的通用包并解压。Windows 下由 AI 运行：

```powershell
node '<解压目录>/requirement-board/install.mjs' --open-terminal --base-url 'https://你的站点'
```

站点 origin 来自用户分享的安装链接，不能替换为别的站点。已有同站点配置时直接复用，**不弹终端、不提问、不改写配置文件**。添加尚未配置的站点时才打开独立终端；用户回到对应站点的账号页创建、复制凭证，再到终端输入 Token。新配置与已有站点并存，保留原默认站点。输入输出不会转发给 AI；AI 的父命令等待窗口结束，退出码 0 才表示成功。完成后按回车关闭终端；失败或取消保留非零退出码，不要提前删除解压目录。

不要让用户把 Token 发到聊天中，不读剪贴板，不把 Token 放到链接、命令参数或工具调用里。macOS/Linux 先运行 `node <解压目录>/requirement-board/install.mjs --non-interactive --base-url <origin>`；已有配置时成功，退出码 2 表示需要用户配置，再打开用户可直接输入的终端，去掉 `--non-interactive` 重试。无法打开这样的终端时提供手动命令，不能改为让 AI 代输凭证。云端 AI 无法操作用户本机或访问本机 localhost 时，应转到本机 Codex。

## 更新

用户可以在账号页复制“更新链接”发给 AI。AI 下载、检查并解压最新包后运行：

```sh
node <解压目录>/requirement-board/install.mjs update --from-bundle --base-url <origin>
```

这也适用于没有 `update` 命令的旧版 Skill，不需要先卸载。已经装上新版后，AI 可以直接运行：

```sh
node <已安装 Skill 目录>/install.mjs update
```

更新器从默认站点下载公开包，也可用 `--base-url` 选择另一个已配置站点；使用内置解包器核验文件，备份原目录后替换 Skill。所有站点的 URL、Token、配置文件时间和权限保持不变；不会验证 Token 或弹出终端，凭证过期也能先更新。没有配置时可提供 `--base-url` 只更新文件，使用前再配置。已有配置但更新链接不属于其中任何站点时会停止；添加站点用 `configure`，不能发送旧 Token 给未知站点。

下载失败、损坏、重定向、越界条目或链接均中止，保留原安装与配置。原 Skill 的自定义文件保存在 Codex 用户目录的 `requirement-board/backups/`。更新后重新阅读已安装的 `SKILL.md`，再按新文档继续任务；用户仅要求更新时，不读取或修改需求。不要启动定时更新或修改 Codex 自身。

安装器负责备份，无需 AI 另建副本。安装、更新或卸载成功后，只保留最近 3 份自动备份（包含本次恢复点），清理更早的自动备份；操作失败时不清理。仅处理 backups 目录中符合安装器时间戳/UUID 命名且 SKILL.md 标识为 requirement-board 的普通目录，手动命名的备份、其他文件和链接不纳入清理。备份内的自定义文件也受此保留上限约束。清理失败只提示并在下次成功操作后重试，不回滚已经完成的更新。

## 卸载

用户在账号页复制“卸载链接”给 AI，或让 AI 执行：

```sh
node <已安装 Skill 目录>/install.mjs uninstall
```

卸载把此 Skill 移出 `skills` 目录并保留备份，其他 Skill 不受影响。**默认保留本机 URL 和 Token**，再次安装自动复用；不需要联网、输入凭证或打开终端。旧版没有卸载命令时，从卸载链接下载新版安装器并执行同一命令，不必先安装新版。

只有用户明确要求同时清除本机配置时才使用 `uninstall --purge-config`，它仅额外删除此 Skill 的 `config.json`，不扩大备份清理范围；其他文件保留。不改用户环境变量，不撤销服务器凭证；需要停用凭证时，由用户在账号页撤销。不要仅删除 Skill 目录后声称凭证已撤销。

## 手动安装或重新配置

1. 在网站“我的账号”创建并复制 AI 凭证。
2. 下载并解压 Skill，在解压后的父目录打开终端，运行：

   ```sh
   node requirement-board/install.mjs
   ```

3. 已有配置直接复用。首次安装按提示输入站点 URL 和 Token，URL 默认 `http://localhost:3000`；Token 输入显示为星号，连接验证成功后才保存。输入错误可重试，按 Ctrl+C 取消。
4. 在 Codex 中调用 `$requirement-board`，附上需求链接和修改要求。若新 Skill 尚未出现，重启 Codex 后再试。

可追加 `--base-url <站点 origin>` 带入站点地址；仅在缺少同站点配置时询问 Token。需要添加站点或更换凭证时运行 `node <已安装 Skill 目录>/install.mjs configure --base-url <origin>`，Windows 下 AI 可追加 `--open-terminal`；同站点的 Token 可回车保留。configure 只更新目标配置，不替换已安装的 Skill，也不删除其他站点。未配置的新站点不能沿用另一个站点的 Token；本地共享数据库的端口按下方方式显式关联。

默认安装目录为 `~/.codex/skills/requirement-board`，例如 Windows 上的 `C:/Users/<user>/.codex\skills\requirement-board`。如果已设置 `CODEX_HOME`，安装和命令读取配置都使用该目录；安装终端与 Codex 应使用相同的 `CODEX_HOME`。

向导将 URL 和 Token 保存到 `~/.codex/requirement-board/config.json`，不修改系统环境变量或 Codex 的 `config.toml`。命令每次运行都会直接读取配置，无需从特定终端启动 Codex。配置与 Skill 文件分开存放，Token 不会进入下载包、任务文件或命令参数。配置文件包含凭证，不要分享；Windows 下向导为专用配置目录设置用户访问权限，macOS/Linux 使用目录 700、文件 600 权限。

配置 v2 保存多套站点、显式本地别名和可选 localPorts 开关，首次配置的站点作为默认站点，添加配置不会改变它。旧 v1 单站点配置继续可读；只有添加或更新配置时才迁移，单纯运行命令或更新 Skill 不改配置文件。写入使用互斥锁与原子替换，避免多个 worktree 同时配置时丢失其他站点；损坏的已有配置不会被直接覆盖。

重复安装自动备份原目录并复用配置；更新文件和重新配置是独立操作。退出码 0 表示操作成功，2 表示无交互安装需要配置，130 表示用户取消，其他非零表示失败。

Codex 会自动检测 Skill 文件变化；若未显示，可重启 Codex。参见 [OpenAI 官方说明](https://learn.chatgpt.com/docs/build-skills)。

凭证以当前账号权限读取、新建和修改文档、属性及版本。文档操作默认直接执行，普通修改更新草稿；只有用户明确要求保存版本时才生成新的正式版本。有效期默认 30 天，可在账号页设置 1–90 天，并可随时撤销。向导只调用读取 schema 的接口验证连接，不修改需求。

## 多个站点与本地 worktree

一份 Skill 可同时服务生产、本地开发和其他已配置站点。先用 `node <skill-dir>/scripts/rb.mjs sites` 查看已配置 origin、默认站点、本地别名和 localPorts 开关；该命令不输出 Token，也不需要 AI 阅读配置文件。

用户确认本地 worktree 共用数据库时，只需在任一运行中的本地账号页创建一次凭证，再通过已有安装器添加一次本地通用配置：

```sh
node <skill-dir>/install.mjs configure --base-url http://localhost:3000 --local-ports --open-terminal
```

`--local-ports` 只用于 configure，验证所选本地站点后启用。后续直接提供 localhost、127.0.0.1 或 IPv6 回环地址的任意端口链接，无需再运行配置或 alias 命令；请求仍发往链接中的实际端口。此模式只自动匹配回环地址，每次请求仍经过目标服务的凭证认证，不扫描端口、不探测其他凭证，也不跟随重定向。仅允许一份本地通用配置，远程配置不能启用。

某个端口需要使用独立数据库时，单独 configure 该 origin 且不加 `--local-ports`；精确站点或显式别名优先于本地通用配置。更新通用凭证时使用最初配置的 origin（上例为 3000），原 localPorts 开关会保留。

不启用通用配置、只希望关联指定本地端口时，仍可使用：

```sh
node <skill-dir>/install.mjs alias --from http://localhost:3001 --base-url http://localhost:3002
```

alias 先用来源配置的凭证读取目标端口 schema，验证通过才保存；不重装、不询问 Token、不改默认站点。只支持两端均为 localhost、127.0.0.1 或 IPv6 回环 origin，不把生产凭证关联到本地。目标已有独立配置时拒绝覆盖；两个 worktree 使用不同数据库时应分别 configure。关联后的端口共用一份凭证，更新其中任一地址的凭证会同步适用于同组别名；其他站点保持原样。

使用文档完整链接时自动选配置，例如 `read http://localhost:3002/requirements/req_...`。`schema`、`meta`、`list`、`new --create`、`operation` 等无链接命令或裸 `REQ-编号`，加 `--site http://localhost:3002`。未提供站点线索时使用默认站点，不记忆上一次命令的站点，避免并发会话互相切换。不匹配精确配置或已启用本地通用配置的 origin 会在发送请求前拒绝，不尝试其他 Token。

新 read/snapshot 结果及 new 请求文件带有 `siteOrigin`；后续命令按文件选择站点，并在提交服务端前移除此本机字段。显式 `--site`、文档链接、标注来源、文件站点必须一致。旧文件缺少该字段时显式指定 `--site`，不要把同一个快照或请求文件改到其他站点提交。

调试 Skill 脚本本身时，直接在对应 worktree 运行 `node skills/requirement-board/scripts/rb.mjs ...`，它与已安装 Skill 共用本机站点配置，每次改脚本都能立即验证，无需重装。需要让后续对话使用该 worktree 的新版时，运行 `node skills/requirement-board/install.mjs update --from-bundle` 同步一次文件；全部站点配置保持不变。

## 已有环境变量配置

已配置环境变量的使用方式继续有效。`RB_BASE_URL` 和 `RB_TOKEN` 必须成对设置，且优先于向导保存的配置；不会将一个来源的 URL 与另一个来源的 Token 混用。存在环境覆盖时，文档链接或 `--site` 指向其他站点会拒绝，不回退读取文件中的凭证。使用多站点向导配置时，移除以前设置的这两个环境变量。若修改的是桌面应用启动时继承的用户环境变量，需要重启应用。

站点 URL 必须是 origin，不含路径、账号或查询参数。公网使用 HTTPS；本机开发允许 `http://localhost:端口`、`http://127.0.0.1:端口` 或 IPv6 回环地址。脚本拒绝不匹配任何配置的站点、相互矛盾的站点线索和 HTTP 重定向。

你可以调整 Skill 中的写作流程。块结构、权限、编辑锁、版本冲突与幂等性仍由服务端校验。
