# 构建与验证 / Build and validation

需要 Node.js 24.22.1 及以上。开发依赖锁定 DSH `0.2.1-rc.5`，peer 范围同时覆盖 `0.2.2-rc.1`。
Requires Node.js 24.22.1 or newer. Development dependencies pin DSH `0.2.1-rc.5`; the peer range also covers `0.2.2-rc.1`.

```sh
npm ci
npm run build
npm run check
```

`lib/` 与 `node_modules/` 不提交。桌面插件管理器安装本目录时使用已构建的 `lib/`。
`lib/` and `node_modules/` are not committed. Desktop installation consumes the built `lib/` directory.

## check 包含什么 / What `check` runs

```sh
npm run typecheck     # tsc --noEmit
npm run build         # tsc → lib/
npm test              # vitest 合成测试，离线
npm run test:runtime  # 真实 DSH 插件 API 探针，不调用任何模型
```

`test:runtime` 挂载真实的 `ctx.verymath` 服务、工具注册表与技能注册表，用合成工作区执行全部工具。
它不访问网络、不调用模型、不读取开发者机器的 `~/.verymath`，可以在干净 checkout 上直接运行。
The runtime probe mounts the real `ctx.verymath` service, tool registry and skill registry, then executes
every tool against a synthetic workspace. It performs no network calls, invokes no model, and never reads
a developer's `~/.verymath`, so it runs on a clean checkout.

## 需要外部环境的能力 / Capabilities needing external environments

Python、SageMath、TeX Live、Lean/elan、MATLAB 都不随包分发，也**不在 CI 覆盖范围内**：相关工具只做环境探测，
缺失时返回结构化安装提示。因此单元测试证明的是探测与降级路径，不是这些环境里的真实执行。
Python, SageMath, TeX Live, Lean/elan and MATLAB are not bundled and are **not covered by CI**: the corresponding
tools only probe for the environment and return structured install hints when it is missing. Unit tests therefore
prove the probe/degradation paths, not execution inside those environments.

## 真实模型验收 / Model-level acceptance

`npm run check` 不调用模型。涉及真实模型的任务链路（论文结构提取、术语库构建、OCR 审校、QP 求解等）
的场景记录见仓库内的能力示例文档，这些不能由单元测试替代。
`npm run check` never calls a model. Task-level scenarios that need a real model are recorded in the capability
examples documented in the repository; unit tests do not substitute for them.

## 包内容 / Package contents

发布内容受 `package.json` 的 `files` 控制：`lib`、`skills`、`cordis.patch.yml`、双语 README、`DEVELOPMENT.md`、
`NOTICE.md`、`UPSTREAM.json` 与三份许可文件。测试与源码不进入 npm 包。
Published content is controlled by `files` in `package.json`: `lib`, `skills`, `cordis.patch.yml`, both READMEs,
`DEVELOPMENT.md`, `NOTICE.md`, `UPSTREAM.json` and the three license documents. Tests and sources are not packed.
