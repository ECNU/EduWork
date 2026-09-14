# 包名与企业凭据迁移

**简体中文** | [English](EDUWORK-MIGRATION.en.md)

从 `0.1.0-alpha.11` 起，npm 包改用 `@eduwork/dsh-oidc`，替代旧的 `dsh-oidc`；`0.1.0` 是完成该迁移后的首个稳定语义版本。源码位于 EduWork 的 `packages/dsh-oidc`。

## 历史 npm 作用域迁移（0.1.0）

```sh
dsh plugin --profile web add @eduwork/dsh-oidc@0.1.0
```

已有 Profile 先备份 package.json 与 cordis.patch.yml，再更新依赖和 dsh.profile.bundles；手写 patch 的模块路径 name 也需切换。不要同时启用新旧两份插件，切换后重启 Host。旧版本和新作用域版本是不同 npm 包，旧包的更新不会自动迁移安装。

## 数据兼容

保留 `dsh-oidc/v1alpha1`、`oidcAccounts`、凭据引用、Provider 标识和插件行 id；Host 与 Client 的 TYPERT 包归属一起更新。

本次迁移不修改存储目录或用户配置内容。产品管理的 Profile 由产品升级逻辑迁移其受管依赖；社区插件保持原状。

## 0.2.x 企业凭据

默认本地引用为 `EDUWORK_API_KEY`，与学校和 Provider 名称无关。同一 Profile ID 或 Provider ID 派生的旧自动引用（转大写，非字母数字换为 `_`，后接 `_API_KEY`）也会规范化为新默认值。其他显式自定义引用如 `MY_TEST_MODEL_KEY` 保持不变。这只是本地秘密存储名称，不是新的服务端请求字段。

旧 Web/desktop 会话只有在 issuer、client ID、管理 URL、运行 URL、Provider ID 全部一致，仅引用改名时才迁移旧 Key。目标槽必须为空，源引用不能被其他 Profile 声明；已有指纹时必须匹配。不会从任意环境变量导入 Key，不覆盖非空目标，也不接纳其他部署的 Key。已有配置文件按兼容规则读取，不会被覆盖改写。

另一机构完成绑定并写入公共槽后，只有拥有当前指纹的会话才能调用该 Provider。其他会话保留身份但需重新连接资源；它们注销时不能删除新所有者的 Key。用户单独配置的个人模型 Key 不受影响。资源端点改变可保留身份，但必须重新绑定模型凭据；issuer/client ID 改变需重新登录。不要手动复制 Key 绕过归属校验。

两种新桌面壳共用 desktop backend。旧 `native` 账号桥仍由宿主管理凭据存储并返回匹配引用；本插件不改写操作系统凭据库。插件迁移不搬动工作区、历史目录或应用数据；更换桌面壳的数据迁移由产品处理。
