# 构建与验证 / Build and validation

需要 Node.js 24.22.1 及以上（实测于 24.22.2）。开发依赖锁定 DSH `0.2.2-rc.1`，peer 范围同时覆盖 `0.2.1-rc.5` 与后续 `0.2.x`。
Requires Node.js 24.22.1+ (verified on 24.22.2). Development dependencies pin DSH `0.2.2-rc.1`; the peer range also covers `0.2.1-rc.5` and later `0.2.x`.

```sh
npm ci
npm run check
```

`lib/` 与 `node_modules/` 不提交；安装时使用已构建的 `lib/`。
`lib/` and `node_modules/` are not committed; installation consumes the built `lib/`.

## check 覆盖范围 / What check covers

`npm run check` 依次执行类型检查、构建、172 项 vitest 测试与 13 项 runtime probe 检查。probe 挂载真实的 `ctx.verymath` 服务、工具与技能注册表，并按 DSH 0.2.2 的要求装载原生工具执行器，用合成工作区执行全部工具（含 upsert 的别名新增／按 `term_id` 纠正／整批回滚，以及 `verymath_paper_graph` 的跨批合并），不调用模型、不访问网络。
`npm run check` runs type checking, build, 172 vitest tests and 13 runtime probe checks. The probe mounts the real `ctx.verymath` service, tool and skill registries, then executes every tool against a synthetic workspace — including upsert alias creation, correction by `term_id`, whole-batch rollback, and `verymath_paper_graph` batch merging — without model calls or network access.

## 不在 CI 覆盖内 / Not covered by CI

Python、SageMath、TeX Live、Lean/elan、MATLAB 不随包分发，测试只证明探测与降级路径，不证明这些环境里的真实执行。真实模型任务链路不在 `check` 内，其记录见仓库的能力示例文档。
Python, SageMath, TeX Live, Lean/elan and MATLAB are not bundled; tests prove the probe and degradation paths, not execution inside those environments. Real-model task chains are outside `check` and are recorded in the capability examples in the repository.

## 包内容 / Package contents

`package.json` 的 `files` 决定发布内容：`lib`、`skills`、`docs/capability-examples.md`、`docs/examples`、`cordis.patch.yml`、双语 README、本文件、`NOTICE.md`、`UPSTREAM.json` 与三份许可文件。源码与测试不进入 npm 包。
`files` in `package.json` controls the published content: `lib`, `skills`, `docs/capability-examples.md`, `docs/examples`, `cordis.patch.yml`, both READMEs, this file, `NOTICE.md`, `UPSTREAM.json` and the three license documents. Sources and tests are not packed.
