# 部署说明

公开仓库保留通用的 [Dockerfile.runtime](Dockerfile.runtime) 和 [migrate.ts](migrate.ts)。内部服务器的 Compose、Nginx、证书续期、凭证初始化及 Jenkins 配置未随源码发布。应用本地运行使用根目录的 docker-compose.yml，步骤见 [README](../README.md)。

## 部署前配置

根据自己的环境配置 PostgreSQL、私有上传目录或 S3 兼容存储、HTTPS 反向代理与独立的认证密钥。环境变量和约束见 [开发文档](../docs/development.md#环境变量)；示例密码仅用于本地开发。真实环境文件、私钥、数据库备份和上传目录不能进入 Git。

应用运行使用 NUXT_DATABASE_URL；迁移和 seed 使用 DATABASE_URL，两者须指向同一目标环境。生产与测试使用独立数据库、账号、存储空间、认证来源和 Cookie 前缀。数据库及对象存储不直接暴露公网。

## 构建与启动

Dockerfile.runtime 从锁文件安装依赖、构建 Nuxt/Nitro，并打包迁移、seed 与密码维护工具。可按自己的镜像仓库和运行编排使用：

```sh
docker build --file deploy/Dockerfile.runtime --target runtime --tag requirement-board:local .
```

启动前注入生产配置，并将容器的应用端口接入自己的反向代理。公网使用 HTTPS，配置精确的 BETTER_AUTH_URL 与受信任来源，不使用通配符。上传存储须持久化，并通过应用的授权路由读取。

## 数据库迁移

首次启动执行迁移，再执行 seed 和管理员密码设置。已有环境升级前备份并确认迁移链；涉及共同正文格式升级时先停止写入，再执行迁移工具。SQL 历史和执行时间不可随意修改。详见 [迁移约定](../docs/development.md#数据库迁移规则)。

## 初始化和重设登录密码

本地使用 `pnpm auth:set-password admin`。运行镜像内提供 `node tools/set-user-password.mjs admin`，需要交互终端，密码隐藏输入。此操作撤销该账号的全部会话；密码不能放进命令参数、Git 或日志。

## 日常发布与 Jenkins 的职责

内部 CI/CD 配置不在公开发布范围内。自建流水线应验证依赖、类型、纯逻辑与隔离 API 测试，再构建镜像、备份、迁移、部署和检查健康状态。迁移或正文协议不兼容时，不应只回退应用镜像而忽略数据库版本。

GitHub 使用独立的公开提交历史。内部部署分支与 GitHub 的同步必须先经过脱敏检查，不能直接镜像推送全部分支和标签。
