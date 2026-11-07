# 许可范围

[English](#english)

本包采用 `MulanPSL-2.0 AND MIT`，表示不同来源的代码各自适用不同许可，不是任选其一。

`src`、`scripts`、`test`、`cordis.patch.yml` 与包内其他原创文件按木兰宽松许可证第 2 版授权，全文见 [LICENSE](LICENSE)。`skills` 下改编自 VeryMath 各仓库的技能内容与 Python 脚本保持 MIT，全文见 [LICENSE-MIT](LICENSE-MIT)；逐仓库 commit 见 [UPSTREAM.json](UPSTREAM.json)，改编范围与逐项改动见 [NOTICE.md](NOTICE.md)。八个上游仓库中七个为 MIT，另一个 Sagemath-skill 为 GPLv3，本包未收录其任何代码，仅按公开文档以 TypeScript 重新实现查询契约。

同时分发原创部分与上游改编部分时，须一并保留两份许可全文及来源署名。上游 MIT 授权及其权利人不因本包的许可选择而改变。机构版权声明不表示其他贡献者转让版权。

`skills/math-beamer/templates` 下的模板只调用用户本机 TeX Live 提供的 Beamer 主题，不随包分发第三方样式文件或字体。Python、SageMath、TeX Live、Lean、MATLAB 等外部环境由用户自行安装，按各自许可使用。技能文档中出现的 LGPL、MIT 等字样是对相应 Python 包许可的说明，不代表本包分发这些库。

## English

This package uses `MulanPSL-2.0 AND MIT`: different components carry different licenses rather than a choice between the two.

`src`, `scripts`, `test`, `cordis.patch.yml` and other original files are licensed under MulanPSL-2.0 (see [LICENSE](LICENSE)). Skill content and Python scripts under `skills` adapted from the VeryMath repositories remain under MIT (see [LICENSE-MIT](LICENSE-MIT)); per-repository commits are recorded in [UPSTREAM.json](UPSTREAM.json) and adaptations in [NOTICE.md](NOTICE.md). Seven of the eight upstream repositories are MIT; the eighth, Sagemath-skill, is GPLv3 and contributes no code — only a lookup contract re-implemented in TypeScript from its public documentation.

Redistributing both the original and adapted parts requires carrying both license texts and the attribution. Upstream MIT grants and their holders are unaffected by this package's license choice. Institutional copyright notices do not transfer copyright from other contributors.

Templates under `skills/math-beamer/templates` only reference Beamer themes from the user's own TeX Live installation; no third-party style files or fonts are redistributed. Python, SageMath, TeX Live, Lean and MATLAB are installed by the user under their own licenses. LGPL and MIT mentions in skill documentation describe those Python packages and do not indicate redistribution here.
