# 第三方组件声明

**简体中文** | [English](THIRD_PARTY_NOTICES.en.md)

`dsh-mail-assistant` 自身使用 MIT 许可证。构建产物包含或使用以下直接依赖：

- [ImapFlow](https://github.com/postalsys/imapflow) — MIT License — IMAP 客户端；
- [Nodemailer](https://github.com/nodemailer/nodemailer) — MIT-0 License — SMTP 邮件提交；
- [MailParser](https://github.com/nodemailer/mailparser) — MIT License — MIME 解析；
- [`@deepseek-ai/schemastery`](https://github.com/deepseek-ai/deepseek-harness/tree/main/vendor/schemastery) — MIT License — DSH 的设置 Schema 实现；
- [React](https://github.com/facebook/react) — MIT License — DSH Client 设置界面（peer dependency）。

项目参考了 MIT 许可的社区项目 [`STARDUSTLC666/dsh-email`](https://github.com/STARDUSTLC666/dsh-email) 在 ImapFlow、Nodemailer、MailParser 与 DSH 之间的组合思路，但重新设计了权限、凭据、只读 IMAP、工作区、邮件不可信内容和审批边界。没有任何第三方项目为本插件背书。

直接和间接依赖的精确版本记录在 `package-lock.json`。每次公开发布前必须重新审查锁文件、许可证检查结果和最终 npm tarball。
