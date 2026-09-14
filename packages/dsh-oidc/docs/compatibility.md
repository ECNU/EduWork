# 兼容性与发布策略

**简体中文** | [English](compatibility.en.md)

## 运行环境

0.2.x 源码面向 DSH `0.1.5-rc.1`、Cordis `4.0.2` 和 pi-ai `0.85.1`。开发使用 Node.js 22 或 24 及本模块的依赖锁。宿主中的 DSH 包必须保持一致；保留的 peer 范围不代表任意部署组合均受支持。

旧稳定包 0.1.0 对应 DSH 0.1.2-rc.1，升级前先检查宿主。依赖和接入检查见[开发说明](development.md)。

## 契约版本

- Enterprise Profile：`dsh-oidc/v1alpha1`
- Key Binding Profile 配置名称：`worker-user-center-v1` 或 `eduwork-resources-v1`；Bootstrap wire 兼容名称：`worker.user-center.v1`、`worker-user-center/v1`、`eduwork-resources/v1`
- Typert 包/命名空间：`@eduwork/dsh-oidc` / `oidcAccounts`
- 浏览器管理投影：`dsh-oidc/management/v1alpha1`
- 回调路径：`/oauth/callback`
- Provider 转换服务：`enterpriseTransforms`
- 兼容旧版的 Provider 设置命名空间：`provider-enterprise`

修改上述任一项都必须进行兼容性分析；涉及网络可见契约时，必须发布新的契约版本。

## 项目语义化版本

在 `1.0.0` 之前，minor 版本可以包含不兼容的 alpha 契约变更，但必须提供发布说明和迁移指引。同一已记录契约版本中的 patch 版本必须向后兼容。

在 `1.0.0` 之后：

- 新增可选 Profile 字段和错误码可以作为 minor 版本发布；
- 删除或重命名字段、修改固定路径、回调路径、默认凭据派生或身份规则，需要 major 版本或单独版本化的契约；
- 因安全加固而拒绝此前接受的不安全输入，可以在醒目说明后作为 minor 或 patch 版本发布。

## 发布门槛

以下项目全部通过前，不得创建公开 tag 或发布 npm 包：

- 在干净 checkout 中执行 `npm ci`；
- Windows 和 Linux 上执行 `npm run check`；
- CodeQL 或等效静态分析；
- 依赖、许可证和安装脚本审查；
- 密钥与生产地址扫描；
- npm tarball 内容审查；
- 纯 Web 端到端验收；
- native 桌面无回退验收；
- OIDC 反向测试和 Key Binding 授权测试；
- 文档、版本和变更日志更新；
- 对认证、凭据、构建或发布流程变更完成独立技术复核、CI/专项回归并记录维护者决定；增加第二位维护者后再加入独立人工批准。

操作检查项见[公开发布检查表](release-checklist.md)。
