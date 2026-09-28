# EduWork 文献工具

**简体中文** | [English](README_EN.md)

`@eduwork/dsh-literature` 为 DSH 提供文献检索、BibTeX 和可用全文获取能力，可独立用于其他 DSH 应用。

本包 fork 自 [SihanLv/dsh-literature](https://github.com/SihanLv/dsh-literature) `0.1.2`，由 EduWork 接续维护，沿用 MIT 许可证。感谢原作者和上游贡献者。来源提交及原始文件校验值见 [UPSTREAM.json](UPSTREAM.json)，许可证与归属见 [NOTICE.md](NOTICE.md)。

## 目前支持

- **DBLP、arXiv 检索**：合并结果、去重，保留已发表论文与预印本的区别。
- **BibTeX**：获取来源提供的引用条目。
- **全文获取**：尝试 arXiv 源文件、HTML、PDF，以及可访问的出版方 PDF，提取内容写入当前会话工作区。
- **后台任务**：全文获取默认通过 DSH Jobs 执行，支持查询结果与取消；写入遵循当前会话的沙箱策略。

全文是否可用取决于来源服务、网络和访问权限，不承诺获取付费或受限全文。出版方 PDF 链接解析的回退路径会使用宿主配置的 Subagent；本包不自带模型或账号。

## 安装与使用

要求 Node.js `24.18.0+` 和 DSH `0.2.0-rc.1`；其他内核版本尚未验证。

```sh
dsh plugin add @eduwork/dsh-literature@0.1.0
```

也可以从源码构建：

```sh
# 在 EduWork 仓库根目录执行
node scripts/packages/manage.mjs install dsh-literature
node scripts/packages/manage.mjs check dsh-literature
node scripts/packages/manage.mjs pack dsh-literature
```

打包结果位于 `dist/npm-packages/dsh-literature/`，可通过 DSH 的插件安装入口选择生成的 `.tgz`。

启用后，Agent 可使用 `literature_search`、`literature_bibtex`、`literature_fulltext`。例如：“检索近年关于检索增强生成的论文，给出引用，并获取能公开访问的全文。”后台全文任务通过官方 `job_output` 读取结果、`job_kill` 取消。

原来的 `literature`、`literature-dblp`、`literature-arxiv`、`tool-literature` 配置标识保持不变。手动安装时请先停用旧 `@shlv/dsh-literature`，不要同时启用两套同名工具。安装本包不会自动迁移宿主已有的 profile/home 配置；更换内核或插件前请保留原配置。

## 配置与维护

核心 `literature` 条目支持 `enabledSources`（`dblp`、`arxiv`）、`searchMaxResults`、`timeoutMs` 及下载/提取大小限制；工具条目 `tool-literature` 的 `subagentProvider` 默认是 `spawn`。不配置来源列表时使用全部已注册且可用的来源，空列表表示全部停用。

源码保留四层结构：`src/core` 负责检索协调和内容提取，`src/dblp`、`src/arxiv` 对接来源，`src/tool` 对接 DSH 工具与 Jobs。对应的 npm 导出为 `/core`、`/dblp`、`/arxiv`、`/tool`，同时提供 TypeScript 类型声明。原上游的五个包收为一个包，减少跨包版本配套工作。

后续计划在这一结构上拓展更多文献来源；目前仅支持 DBLP 和 arXiv。新增来源还需要完善标识、引用和全文回退规则，并补齐测试。

普通检查使用合成数据，不联网检索、不调用真实模型。`npm run test:live` 单独运行需要访问外部文献服务的性能检查，不作为 CI 门槛。维护与发布流程见 [包维护指南](../../docs/PACKAGES.md)。问题和贡献请提交到 [EduWork](https://github.com/ECNU/EduWork/issues)。
