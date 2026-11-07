# 许可范围

**简体中文** | English

本包采用 SPDX 表达式 `MulanPSL-2.0 AND MIT`。这表示**不同来源的代码各自适用不同许可**，不是"任选其一"的双许可授权。

## 适用范围

| 路径 | 许可 | 权利人 |
| --- | --- | --- |
| `src/**`、`scripts/**`、`test/**`、`cordis.patch.yml`、本文件与 `package.json` 等包内原创文件 | `MulanPSL-2.0`，全文见 [LICENSE](LICENSE) | 本文档所列贡献者 |
| `skills/**` 中改编自 VeryMath 各仓库的技能内容与 Python 脚本 | `MIT`，全文见 [LICENSE-MIT](LICENSE-MIT) | VeryMath 及其贡献者（逐仓库 commit 见 [UPSTREAM.json](UPSTREAM.json)） |
| `skills/**` 中随包携带的模板与参考文档 | 同其上游来源的 `MIT` 授权 | 同上 |

`NOTICE.md` 记录改编范围与逐项改动；`UPSTREAM.json` 记录每个上游仓库的完整 commit 哈希。

## 分发要求

同时分发本包的原创部分与上游改编部分时，须一并保留 [LICENSE](LICENSE) 与 [LICENSE-MIT](LICENSE-MIT) 两份全文，以及 `NOTICE.md`、`UPSTREAM.json` 中的来源与署名。上游 MIT 授权及其权利人不会因本包的许可选择而改变。

包内 `skills/math-beamer/templates/` 下的 `.tex` 模板仅调用用户本机 TeX Live 发行版提供的 Beamer 主题（如 `\usetheme{Warsaw}`），不随包分发任何第三方 `.sty`、`.cls` 或字体文件。

## 第三方环境

Python、SageMath、TeX Live、Lean/elan、MATLAB 等外部环境由用户自行安装，按各自许可使用，不在本包分发范围内。`skills/least-squares/SKILL.md` 等文档中出现的 LGPL/MIT 字样是对相应 Python 包许可的**说明文字**，不代表本包分发这些库。

## English

This package uses the SPDX expression `MulanPSL-2.0 AND MIT`. It means **different components carry different licenses**, not a choice between the two.

- Original files (`src/**`, `scripts/**`, `test/**`, `cordis.patch.yml`, this file) are licensed under `MulanPSL-2.0` (see [LICENSE](LICENSE)).
- Skill content and Python scripts under `skills/**` are adapted from the VeryMath repositories and remain under `MIT` (see [LICENSE-MIT](LICENSE-MIT)), with per-repository commits recorded in [UPSTREAM.json](UPSTREAM.json) and adaptations described in `NOTICE.md`.

Redistributing the package requires carrying both license texts plus the provenance files. Upstream MIT grants and their copyright holders are unaffected by this package's license choice.

The `.tex` templates under `skills/math-beamer/templates/` only reference Beamer themes provided by the user's own TeX Live installation; no third-party `.sty`, `.cls`, or font files are distributed with this package.

External environments (Python, SageMath, TeX Live, Lean/elan, MATLAB) are installed by the user under their own licenses and are not distributed here. LGPL/MIT mentions in skill documentation describe those Python packages; they do not indicate that this package redistributes them.
