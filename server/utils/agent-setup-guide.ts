import { normalizeOrigin } from '~~/skills/requirement-board/scripts/config.mjs'

export function agentSetupGuide(baseUrl: string, action: 'install' | 'update' | 'uninstall' = 'install') {
  const origin = normalizeOrigin(baseUrl)
  // 地址会出现在 Markdown 与命令示例中；只接受规范域名、IP 和回环地址。
  if (!/^[a-z0-9.:[\]_-]+$/i.test(new URL(origin).hostname)) throw new Error('站点域名格式无效')
  const label = { install: '安装', update: '更新', uninstall: '卸载' }[action]
  const command = action === 'install' ? `--open-terminal --base-url '${origin}'`
    : action === 'update' ? `update --from-bundle --base-url '${origin}'` : 'uninstall'
  return `# 为用户${label} Requirement Board Codex Skill

这是用户分享给本机 AI 的${label}说明。只在用户要求${label}时执行；若用户只要求阅读或解释，先说明用途，不自行操作。

- 目标站点：${origin}
- Skill 下载地址：${origin}/api/agent/skill
- 用户创建凭证的位置：${origin}/account
- 目标 Agent：Codex；需要在用户本机执行命令，Node.js 22 或更高版本。

## 由 AI 完成

1. 检查本机 Node.js 版本。下载上面的 tar.gz 到本次新建的临时目录；下载无需 Cookie 或 Token。先检查压缩包条目均在 requirement-board/ 下、没有绝对路径、.. 或链接，再解压。不要覆盖工作区文件，不需要 npm install。
2. 阅读解压后的 install.mjs 及相关脚本，再执行以下命令，将占位路径替换为刚才解压的真实路径。下载最新版安装器也能处理尚无更新命令的旧 Skill：

\`\`\`powershell
node '<解压目录>/requirement-board/install.mjs' ${command}
\`\`\`

3. 安装时优先复用已有同站点配置，仅缺少该站点配置时打开用户终端输入 Token；新配置与其他站点并存，保留原默认站点。更新只替换 Skill 文件，不验证、不改写凭证，也不弹终端；凭证过期仍可更新。卸载只移除 Codex 中的 Skill，默认保留所有站点配置和原文件备份，重装时可以复用。
4. 默认使用用户家目录的 .codex/skills/requirement-board；若设置了 CODEX_HOME，使用该目录。用户已明确请求更新时直接执行，安装器会自动备份原 Skill，成功后只保留最近 3 份自动备份，无需 AI 另建副本；失败不清理旧备份。更新链接不属于任何已配置站点时会停止，不能把原 Token 发给未知站点。
5. 等待命令退出，退出码 0 才表示操作成功。需要交互时，Token 由用户在独立终端输入；不要因为工具返回正在运行就宣布成功或删除临时目录。不要读取或打印配置文件里的 Token。
6. 安装或更新成功后重新读取已安装的 SKILL.md，可以运行 scripts/rb.mjs schema --site '${origin}' 做只读验证；凭证失效时提示重新配置，不把验证失败当作更新失败。若旧的环境变量干扰验证，只在验证子进程中移除 RB_BASE_URL/RB_TOKEN，不修改全局环境变量。卸载后不要运行已移除的脚本，也不要修改网站凭证。
7. 清理本次临时下载目录；Skill 备份由安装器按保留规则管理，本机配置保持不变。若 Codex 尚未发现文件变化，可重启 Codex。此流程仅安装或更新 Skill，不执行文档操作。

## 后续维护

- 已安装新版时，用户可直接让 AI 执行 node '<已安装 Skill 目录>/install.mjs' update；脚本从已配置站点下载最新版，不需要 Token 输入。
- 用户要求添加站点或凭证到期时，运行 node '<已安装 Skill 目录>/install.mjs' configure --open-terminal --base-url '${origin}'，由用户在终端输入；无需重新安装，其他站点保持不变。用户确认本地多个 worktree 共用数据库时，可对回环站点追加 --local-ports 一次启用本地通用配置，之后无需逐个关联端口；也可按 Skill 配置说明用 alias 关联指定端口。
- 用户要求卸载时，运行 node '<已安装 Skill 目录>/install.mjs' uninstall。只有用户明确要求同时清除本机配置，才追加 --purge-config；线上凭证仍需在账号页撤销。

## 交互与凭证边界

- Token 只能由用户在安装终端隐藏输入。不要让用户把 Token 发到聊天中，不读取剪贴板，不把 Token 放进链接、命令参数、脚本、工具输入或日志，也不要代用户创建凭证。
- Windows 的 --open-terminal 仅在需要配置时独立打开窗口，不将终端输入输出转发给 AI。用户完成后按回车关闭，关闭前保留结果供用户查看。
- macOS/Linux 安装时先运行 node '<解压目录>/requirement-board/install.mjs' --non-interactive --base-url '${origin}'；已有配置时直接成功，退出码 2 表示需要配置。此时由 AI 的可用工具或用户打开可直接输入的终端，去掉 --non-interactive 再运行。更新和卸载在所有平台都不需要交互终端。不要在只能由 AI 写入的 PTY 中索取 Token。
- 若 AI 运行在云端，无法访问用户的 localhost 或启动本机终端，请告知需要在本机 Codex 中继续；不要索取 Token 来绕过这个限制。
- URL 和 Token 验证成功后才写入本机配置；连接失败可重试，Ctrl+C 取消。已有配置不会因验证失败被覆盖。
`
}
