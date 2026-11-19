---
name: matlab-runner
description: "Use when a user explicitly requests MATLAB execution or verification, asks to inspect, test, generate, or modify MATLAB .m files, or needs MATLAB-specific functions, toolboxes, licenses, sessions, or environment evidence."
---

# MATLAB Runner

## DSH Integration Notes

- 本技能由 `@eduwork/dsh-verymath` 插件提供。MATLAB MCP Server 已由插件配置：
  MathWorks 官方 `matlab/matlab-mcp-server` v0.14.0（stdio），5 个工具以
  `mcp__matlab__check_matlab_code / evaluate_matlab_code / run_matlab_file /
  run_matlab_test_file / detect_matlab_toolboxes` 暴露——与本技能 §4 的能力清单一一对应。
- 服务器支持两种执行路径：默认 auto 模式优先附着桌面共享会话（桌面 MATLAB 运行
  `shareMATLABSession()` 后），附着不上则自建 headless 会话（`--matlab-root
  /Applications/MATLAB_R2025b.app`，nodesktop）；首次调用可能耗时数十秒（MATLAB 启动），属正常。
  附着桌面会话时执行结果与连接问候直接出现在用户的桌面 MATLAB 中（已验证 getpid 一致）。
- 用户环境：R2025b Update 7 + Optimization Toolbox + Symbolic Math Toolbox（已验证 license）。
- 工具不可用时按本技能 §5 报 `MCP_UNAVAILABLE`，并提示检查
  `~/matlab-mcp/matlab-mcp-server` 与 MATLAB 安装。

Use an available MATLAB MCP Server as the execution layer. This skill is a lightweight, coding-agent-neutral routing, safety, diagnosis, and reporting layer; it does not replace specialized MATLAB skills or MATLAB's own testing, profiling, and resource-management facilities.

## 1. Strict trigger boundary

Load `matlab-runner` before the first workflow tool call only when at least one of these conditions is met:

- the user explicitly asks to use MATLAB, run MATLAB, or obtain a MATLAB-verified result;
- the task asks to execute, inspect, test, generate, or modify a MATLAB `.m` file;
- the task genuinely requires MATLAB-specific functions, toolboxes, files, licenses, shared-session state, or environment evidence.

Do not load or run MATLAB merely because MATLAB could solve the problem. In particular, do not trigger for:

- ordinary mathematical derivations or calculations that do not request MATLAB evidence;
- generic programming questions;
- another language's code or toolchain;
- MATLAB code-only requests that explicitly require no execution, file creation, inspection, or tools;
- actions restricted to another named tool.

Respect boundaries such as “do not run,” “do not modify,” “do not create files,” “do not overwrite,” and “static analysis only.”

When the skill applies, the order is:

```text
Skill "matlab-runner"
→ optional task-specific reference
→ required MATLAB MCP or project tool
```

Never call MATLAB first and load the skill afterward.

## 2. Resolve references relative to this skill

The detailed rules are stored beside this file. Resolve every reference path relative to the directory containing this `SKILL.md`; never assume a fixed client-specific installation path.

Read only the relevant file:

- numerical accuracy, ODEs, residuals, statistics, complex output, or reproducible randomness: `./references/numerical-safety.md`
- memory, large arrays, Monte Carlo, batching, runtime, or output-volume assessment: `./references/resource-safety.md`
- file creation, name collisions, shared-session protection, test-file naming, or recovery after errors: `./references/file-session-safety.md`

Do not load all references by default. Do not inspect unrelated project files merely to prepare an answer. If the client cannot resolve a required relative reference, keep the core safety rules below and report the limitation instead of guessing another installation path.

## 3. Use progressive, lightweight environment checks

Do not run a full MATLAB, MCP, version, license, and toolbox preflight before every task.

- If the required MATLAB MCP tool is already available, use the narrowest tool directly.
- A successful tool call is sufficient evidence that the required chain worked for that call; do not repeat installation or connectivity checks afterward.
- For ordinary base-MATLAB work, do not call toolbox detection.
- If a task depends on a named toolbox, function, or license, check only that requirement. Prefer one targeted lightweight MATLAB call that collects three genuinely independent evidence channels when relevant: product detection such as `ver`, function resolution such as `which` or `exist`, and the named license test. A successful MATLAB call is not product-detection evidence, and `license('test',...) == 1` does not prove that the product or function is installed and resolvable. Use broad toolbox detection only when the user explicitly asks for an installed-toolbox or version list, or when targeted evidence is insufficient.
- Describe availability in the current MATLAB environment. If product, function, and license evidence disagree, report the conflict and the practical usability of the required function; do not invent the underlying installation cause. Do not claim a product is definitively uninstalled, misconfigured, or unlicensed unless the returned evidence supports that exact cause.
- If a call fails, perform only the smallest next check needed to locate the failing layer.
- Keep lightweight probes syntactically simple. Prefer ordinary top-level statements and a direct `if`/`else` over local or nested helper functions when the same evidence can be collected without them.
- Never install, reinstall, update, or reconfigure MATLAB, the MCP Server, Agentic Toolkit, or a toolbox unless the user explicitly asks for environment setup.

Do not use shell commands as a hidden environment preflight when MATLAB MCP tools are available.

## 4. Use MATLAB MCP, not a shell substitute

Use MATLAB MCP tools whenever they are available. Do not invoke MATLAB through PowerShell, bash, a terminal, or `matlab.exe -batch` as an unrequested workaround.

Never claim that MATLAB ran unless a MATLAB MCP tool returned execution output. If the MCP server is unavailable, report that limitation rather than silently switching execution routes.

## 5. Discover and choose the narrowest correct tool

Before the first MATLAB call, inspect the current tool catalog and match capabilities and argument schemas. Coding agents may expose the same MCP capability with a bare name, a server prefix, or a namespace. Use the actual exposed tool name and its returned schema. Do not invent a client-specific prefix.

Match these logical capabilities rather than literal names:

| Task | MATLAB MCP capability |
|---|---|
| Short code, direct calculations, targeted lightweight checks | `evaluate_matlab_code` |
| Run an existing MATLAB program | `run_matlab_file` |
| Run a MATLAB unit-test file | `run_matlab_test_file` |
| Static Code Analyzer inspection only | `check_matlab_code` |
| MATLAB version and installed toolboxes | `detect_matlab_toolboxes` |

Do not use a general execution capability when a dedicated test, static-analysis, or toolbox capability fits. If multiple tools appear to match, compare their descriptions and parameter schemas before choosing. If no MATLAB MCP capability is exposed, report `MCP_UNAVAILABLE`; do not fall back to a shell command merely because a MATLAB executable exists.

Follow the selected tool's actual argument schema. When an evaluation capability accepts `project_path`, pass the absolute path of the intended project directory. For file and test capabilities, pass an absolute `script_path` when that parameter is present. Never redirect MATLAB to an unrelated folder.

## 6. Execution discipline and core safety

Before a MATLAB call:

1. identify the requested result, precision, file effects, named toolbox needs, output size, and safety constraints;
2. send the smallest complete code block that can answer the request;
3. decide what MATLAB must print to support every planned conclusion;
4. for file writes, check the destination first;
5. for expensive tasks, assess feasibility before allocating data;
6. before treating an analytical solution, expected value, reference dataset, or acceptance target as ground truth, validate the reference itself with the cheapest relevant condition or invariant.

Never send placeholders, unfinished ellipses, pseudocode, dummy loops, no-op assignments, or incomplete expressions to MATLAB.

Keep the requested computation separate from optional diagnostics. Do not append exploratory API calls, default-value probes, version checks, or other diagnostics to a core computation unless the user requested them or they are required to interpret the result. Avoid dumping large arrays or logs; return summaries unless the full output is necessary.

Core rules:

- Preserve the shared MATLAB session. Do not use `clear`, `clearvars`, `clear all`, `clc`, `close all`, or restart MATLAB unless explicitly requested and necessary.
- Do not overwrite, delete, rename, or modify an existing file without explicit authorization.
- Do not create a large array or begin an expensive simulation when a lightweight assessment already shows serious risk.
- Do not automatically run a safer alternative when the user asked only for an assessment or unexecuted example code.
- Treat official environment output, theoretical calculations, and unmeasured estimates as different evidence categories.
- Before pointwise numerical comparison, verify that sample points, lengths, orientation, and dimensions correspond. Do not allow accidental row-versus-column implicit expansion to create a matrix of cross-comparisons.
- Keep a human in the loop for consequential execution or file changes when permissions request approval.

## 7. Classify failures by layer

Use the most specific supported category; do not guess. If evidence does not distinguish the layer, use `ENVIRONMENT_UNRESOLVED` and state what remains unknown.

| Error type | Use when |
|---|---|
| `SKILL_NOT_LOADED` | A MATLAB workflow required this skill, but it was not loaded or the load failed; stop before further MATLAB work. |
| `MCP_UNAVAILABLE` | The MATLAB MCP server or required MCP tool is not configured, exposed, or connected. |
| `MCP_TOOL_TIMEOUT` | A dispatched MATLAB MCP call exceeded the client or tool timeout. Do not infer from the timeout alone whether MATLAB executed the code. |
| `MATLAB_SESSION_UNAVAILABLE` | The MCP layer responds, but no usable MATLAB process or shared session is available. |
| `TOOLBOX_UNAVAILABLE` | A required toolbox, function, or license is unavailable. State which condition was actually checked. |
| `MATLAB_EXECUTION_ERROR` | MATLAB accepted the execution request but the code produced a syntax or runtime error. |
| `MATLAB_TEST_FAILURE` | The MATLAB test tool ran successfully, but one or more tests failed or were incomplete. |
| `VALIDATION_FAILURE` | MATLAB execution succeeded, but the result failed the requested numerical, file, or acceptance criterion. |
| `ENVIRONMENT_UNRESOLVED` | Available evidence is insufficient to distinguish MCP, session, installation, or another environment layer. |

For an error, report:

- error type;
- stage where it occurred;
- direct evidence from the tool result;
- the smallest reasonable next action.

Do not call a failed test an execution error, and do not call a numerically unacceptable result a MATLAB runtime error. A reference solution that fails its initial condition, boundary condition, defining equation, or another required invariant makes the intended numerical comparison invalid; classify the unresolved task as `VALIDATION_FAILURE`, even when MATLAB executed without a runtime error.

A failed MATLAB MCP call remains part of the execution history even if a later retry succeeds. When recovery completes the requested task, report `Completion status: success (after recovery)` and include the recovered error type, stage, direct evidence, and corrective action. Never replace the failed call with only the successful retry in the final account.

Classify a recovered MCP timeout as `MCP_TOOL_TIMEOUT`; do not silently relabel it as an ordinary success. If a validation formula, reference check, residual, dimension check, or acceptance test is corrected after a prior successful MATLAB run, disclose the earlier issue as a recovered `VALIDATION_FAILURE`.

Respect call budgets:

- An explicit maximum such as “at most one MATLAB call” or “do not call again” is a hard constraint. If the available call fails or produces an invalid validation result, do not exceed the limit; report the task as failed or partial and ask for permission before retrying.
- A preference or target such as “try to do this in one call” may be exceeded only by the smallest recovery call needed for correctness. Report the real total and state that the preferred call count was not met.
- Do not retry merely to improve wording, formatting, or optional diagnostics.

## 8. Evidence and faithful reporting

After execution:

1. compare the answer with the actual returned output;
2. check labels, units, formulas, filenames, function names, and summary values for internal consistency;
3. separate MATLAB output from interpretation and optional suggestions;
4. never invent values, license states, runtime, peak memory, accuracy, or success claims;
5. count every MATLAB MCP call that was dispatched, including failed, corrective, and discarded calls. Do not describe only the final successful call as a single execution when earlier calls occurred.

When the user asks for the code actually sent to MATLAB, reproduce the exact relevant MCP payload. Include failed, timed-out, or partially executed calls when they affected the result. Do not delete a failing line and present the remainder as the complete executed code. If comments or sections are omitted, label the result as an excerpt or as executable statements rather than verbatim code.

A corrective MATLAB call must recompute every quantity whose validity depends on the corrected formula, reference, shape, or condition. Never hard-code values observed in an earlier call into a follow-up call as a substitute for recomputation or verification.

When the user asks to run faulty code unchanged, run it unchanged, return the genuine MATLAB error, and keep any repair separate.

## 9. Unified completion summary

After any task that invokes MATLAB, checks the MATLAB environment, runs tests, or creates or modifies files, end with a concise completion summary. Use natural wording and omit genuinely inapplicable lines, but always include `Completion status` and `MATLAB execution`.

Interpret completion status by whether the user's requested task was completed, not by whether the checked dependency was available:

- `success`: the requested calculation, inspection, availability check, or file task was completed;
- `success (after recovery)`: the task was completed after one or more disclosed failed calls;
- `partial`: only part of the requested deliverables was completed;
- `failed`: the requested core task was not completed.

For example, a successful check that proves `fmincon` is unavailable has `Completion status: success` and `Error type or limitation: TOOLBOX_UNAVAILABLE`; the unavailable dependency does not make the inspection itself partial.

Recommended fields:

```text
Completion status: success / success (after recovery) / partial / failed
MATLAB execution: yes / no
MATLAB tool calls: total N; successful S; failed F
Tools used: ...
Code or files created/modified: ...
Tests: passed / failed / not run
Validation: criterion and outcome
Result location: absolute path, when applicable
Recovered error: type, stage, evidence, and action, when applicable
Constraint compliance: met / not met, when the user imposed a tool-call or execution limit
Error type or limitation: ..., when applicable
```

The summary must make clear:

- what code or files were produced or changed;
- whether MATLAB actually ran and the truthful total number of MATLAB MCP calls;
- whether tests ran and passed;
- what numerical or file validation standard was used;
- where any result was saved;
- whether an explicit call-count or execution constraint was met.

Do not claim a file was generated when only inline code was shown. Do not relabel a three-call recovery as a one-call task merely because only the last call produced the accepted result. Return exact executed code only when requested; the completion summary is not a substitute for the actual output or error.
