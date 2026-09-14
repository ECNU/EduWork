# eduwork npm 作用域迁移

**简体中文** | [English](EDUWORK-MIGRATION.en.md)

从 `0.1.0` 起，npm 包使用 `@eduwork/dsh-mail`，替代旧的 `dsh-mail-assistant`。当前安装示例固定为 `0.1.1`。源码位于 EduWork 的 `packages/dsh-mail`。

## 安装与迁移

```sh
dsh plugin --profile web add @eduwork/dsh-mail@0.1.1
```

已有 Profile 先备份 package.json 与 cordis.patch.yml，再更新依赖和 dsh.profile.bundles；手写 patch 的模块路径 name 也需切换。不要同时启用新旧两份插件，切换后重启 Host。旧版本和新作用域版本是不同 npm 包，旧包的更新不会自动迁移安装。

## 数据兼容

保留 Host 导出名、插件行 id、settings namespace 和安全作用域中的 `dsh-mail-assistant`，保留 `DSH_MAIL_ASSISTANT_PASSWORD` 与 `.dsh-mail-assistant/attachments`；客户端 ModuleLoader 使用新包名。

本次迁移不修改存储目录或用户配置内容。产品管理的 Profile 由产品升级逻辑迁移其受管依赖；社区插件保持原状。
