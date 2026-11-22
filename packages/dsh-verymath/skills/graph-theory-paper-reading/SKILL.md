---
name: graph-theory-paper-reading
description: 图论论文深度阅读与证明树构建。触发条件：用户上传或粘贴图论论文（PDF/Markdown/纯文本），要求深度阅读、证明树构建、主定理分析、研究综述、未来方向建议。关键词触发："图论阅读"、"证明树"、"主定理分析"、"证明大纲"、"graph theory reading"、"proof tree"、"图论论文"。PDF 文件自动通过 MinerU 转换为 Markdown 后阅读。使用场景：用户需要系统性理解一篇图论论文的核心贡献、证明框架、文献背景和未来研究方向。
---

# 图论论文深度阅读与证明树构建

## DSH Integration Notes

- 本技能由 `@eduwork/dsh-verymath` 插件提供；作为独立技能与 `math-paper-reading` 并列——
  本技能专注图论论文的证明树与 LaTeX 报告交付，通用论文结构提取走 `math-paper-reading`。
- LaTeX 报告需要 XeLaTeX 与 `forest`/`standalone` 宏包；编译前先用 shell 检查
  `kpsewhich forest.sty`，缺失时只交付 .tex 源码并告知用户安装路径，不要自动安装。
- 产物（`<slug>_reading.tex`、`<slug>_tree_*.tex`）写入当前会话工作区。
- 若论文结构 JSON（来自 math-paper-reading）已存在，可将其定理/依赖信息作为主定理分析输入，但本技能的证明树以原文为准。

## 概述

本 skill 对图论论文进行**六大维度深度阅读**，以主定理为中心，逆向构建条件树，正向展望后续研究。

**输入格式**：支持 PDF、Markdown、纯文本。PDF 文件自动通过 MinerU 转换为 Markdown 后阅读（若当前环境已安装 MinerU 且 PDF 无法被直接读取）。可直接读取 PDF 时跳过转换。

**输出文件**：生成一份主报告 `.tex` 文件（文件名 `<slug>_reading.tex`），以及若干独立的证明树图片 `.tex` 文件（文件名 `<slug>_tree_<name>.tex`）。树图片使用 `standalone` 文档类单独编译为 PDF 矢量图，主报告通过 `\includegraphics` 引用之。

## 执行流程

```
论文原文 (PDF / Markdown / 纯文本)
  │
  ▼
[0] PDF 预处理：MinerU 转换为 Markdown（跳过条件见下文）
  │
  ▼
[1] 研究主题识别
  │
  ▼
[2] 主定理相关定义提取
  │
  ▼
[3] 研究综述（聚焦同类研究对象）
  │
  ▼
[4] 主定理与已知结果改进分析
  │
  ▼
[5] 证明大纲与证明树构建
  │
  ▼
[6] 未来研究方向与方法建议
  │
  ▼
[输出] .tex 文件 — 可 xelatex 编译
```

## 步骤 0：PDF 预处理（MinerU 转换）

### 跳过条件

PDF 文件在以下情况**跳过** MinerU 转换，直接阅读：
- 当前模型原生支持 PDF 输入（如可直接调用 Read 工具读取 PDF 内容）
- 用户已提供 Markdown/纯文本格式的论文内容

若模型不支持直接读取 PDF，或 Read 工具返回「不支持 PDF 输入」错误，则执行 MinerU 转换。

### MinerU 安装与使用

**检查安装**：
```bash
pip3 show mineru 2>/dev/null && echo "已安装" || echo "未安装"
```

**安装检查点**：

MinerU 是可选的重依赖。缺失时先说明用途、安装命令和环境影响，并取得用户明确
同意；不要自动安装。

```bash
pip3 install mineru
```

**转换 PDF 为 Markdown**：
```bash
# 基本用法：-p 指定 PDF，-o 指定输出目录，-m auto（自动选择解析模式）
mineru -p <论文.pdf> -o <输出目录> -m auto
```

输出目录中生成 `<pdf_basename>.md` 文件，即为转换后的 Markdown 文本。

**转换后流程**：
1. 读取生成的 `.md` 文件内容
2. 检查转换质量：公式是否正确转为 LaTeX、表格是否完整、章节结构是否保留
3. 若关键公式/表格丢失严重，标记 `[UNCERTAIN: MinerU 转换可能丢失部分内容]`，并提示用户
4. 将 PDF 文件名作为 slug 来源（去除 `.pdf` 后缀）

---

## 硬性约束

### C1 — LaTeX 符号强制要求

所有数学符号必须用 LaTeX，行内用 `$...$`，独立公式用 `$$...$$` 或 `\[...\]`。

| ❌ 禁止 | ✅ 正确 |
|---|---|
| `K1,3` / `G(n,p)` / `chi(G)` | `$K_{1,3}$` / `$G(n,p)$` / `$\chi(G)$` |
| `n >= 7` / `alpha(G)` | `$n \geqslant 7$` / `$\alpha(G)$` |

### C2 — 定理陈述必须逐字引用

记录定义、定理、引理的陈述时，必须从论文**逐字复制原文**，禁止意译、总结或简化。

### C3 — 不确定性必须显式标记

不确定时标记 `[UNCERTAIN: 原因]`，不猜测。

### C4 — 以论文原文为依据

所有分析必须基于论文原文文本，不编造数据或引用。

### C5 — LaTeX 特殊字符转义

在非数学模式的文本中，以下字符必须转义：

| 字符 | LaTeX 写法 |
|------|-----------|
| `&` | `\&` |
| `%` | `\%` |
| `#` | `\#` |
| `_` | `\_` |
| `{` | `\{` |
| `}` | `\}` |
| `~` | `\textasciitilde{}` |
| `^` | `\^{}` |

**注意**：在 `$...$` 或 `$$...$$` 或 `\[...\]` 数学环境中**不要**转义这些字符。

### C6 — 作者名中特殊字符处理

使用正确的 LaTeX 转义，例如：
- `Lužar` → `Lu\v{z}ar`
- `Mockovčiaková` → `Mockov\v{c}iakov\'{a}`
- `Soták` → `Sot\'{a}k`
- `Dvořák` → `Dvo\v{r}\'{a}k`
- `Šámal` → `\v{S}\'{a}mal`
- `Grünbaum` → `Gr\"{u}nbaum`

### C7 — 证明树节点样式规范

证明树使用 `forest` 宏包（基于 TikZ）在独立的 `standalone` 文档中渲染为矢量图。节点类型通过颜色编码突出证明结构：

| 节点类型 | 填充色 | 边框色 | 说明 |
|---------|--------|--------|------|
| `[THEOREM]` 根节点 | `fill=blue!25, draw=blue!70` | 粗边框 | 主定理，树根 |
| `[LEMMA]` | `fill=green!12, draw=green!50` | 正常 | 引理节点 |
| `[CASE A/B]` | `fill=orange!10, draw=orange!50` | 正常 | 分类讨论节点 |
| `[EXTERNAL]` | `fill=yellow!12, draw=yellow!60` | 正常 | 外部引用 |
| `[COROLLARY]` | `fill=violet!10, draw=violet!50` | 正常 | 推论节点 |
| `Step` / 构造步骤 | `fill=white, draw=black!30` | 淡黑 | 中间构造步骤 |
| `[BASE]` 叶节点 | `fill=gray!8, draw=gray!40` | 细边框，斜体 | 终止叶节点 |

**关键规则**：
- 所有节点使用简短标识符 + `content={...}` 键显式指定显示内容
- `content={...}` 内的 `[...]` 无需额外转义
- 边标签用 `edge label={node[midway,above,font=\tiny\itshape\color{gray}]{方法}}` 标注推理方法
- 树图单独保存为 `standalone` PDF，主报告通过 `\includegraphics` 引用

---

## LaTeX 文件骨架

生成的 `.tex` 文件必须**严格使用以下骨架**。`% === %` 之间的内容由各维度填充。

```latex
\documentclass[12pt,a4paper]{article}
\usepackage[UTF8]{ctex}
\usepackage{geometry}
\geometry{margin=2cm}
\usepackage{amsmath,amssymb}
\usepackage{longtable,booktabs,array}
\usepackage{hyperref}
\usepackage{enumitem}
\usepackage{graphicx}
\usepackage{titlesec}
\usepackage{xcolor}
\usepackage{framed}
\setlength{\parskip}{4pt}
\setlength{\parindent}{0pt}
\setlist{nosep}
\titleformat{\section}{\Large\bfseries}{}{0em}{}
\titleformat{\subsection}{\large\bfseries}{}{0em}{}
\titleformat{\subsubsection}{\normalsize\bfseries}{}{0em}{}
\titlespacing{\section}{0pt}{12pt}{6pt}
\titlespacing{\subsection}{0pt}{10pt}{4pt}
\titlespacing{\subsubsection}{0pt}{8pt}{2pt}
\pagestyle{empty}
\begin{document}

% === 标题块 ===
{\LARGE\bfseries <论文英文标题>}\\[4pt]
{\large --- 图论深度阅读报告}\\[8pt]
{\normalsize 论文：<作者列表 LaTeX 转义后> \textit{<论文简短标题>} <期刊/会议>, <年份>;卷:页码.}\\[2pt]
{\normalsize 分析日期：YYYY-MM-DD}\\[12pt]
\hrule

% === 维度内容 ===
<各维度输出内容>

% === 页脚 ===
\vspace{12pt}
\hrule
\vspace{8pt}
{\small 本报告由 graph-theory-paper-reading skill 生成 \hspace{1cm} 版本 1.0 \hspace{1cm} 分析日期 YYYY-MM-DD}

\end{document}
```

---

## 维度 1：研究主题识别

### 目标

用 3–5 句话概括论文的核心研究问题。

### LaTeX 输出模板

```latex
% ============ 维度 1 ============
\section*{维度 1：研究主题}

\textbf{研究对象}：<一句话，如 ``次立方图（subcubic graphs，$\Delta(G) \leqslant 3$）上的列表星边染色''>

\textbf{核心问题}：<一句话，说明本文试图解决什么问题>

\textbf{方法论标签}：<逗号分隔的方法论，如：极小反例法、反证法、Petersen 分解定理>

\textbf{核心证明技巧}：<1--2 段，从方法论标签中识别出本文最关键的 1--2 个证明技术，解释（1）该技巧在证明中扮演什么角色，（2）它的工作原理是什么，（3）它为什么是该证明中不可替代的核心。注意：不要罗列所有方法，只抓最创新或最核心的那个。>

\textbf{同类方法论文推荐}：<2--3 篇使用了相同或相似核心证明技巧的论文。每篇格式：``作者 (年份)，\textit{标题}，期刊/会议。—— 关联说明：简述该论文在哪个环节使用了相同的技巧。优先考虑论文自身引用列表中的相关文献；若没有，可从同一研究方向中寻找。若无法确定，标注 [UNCERTAIN: 需外部检索]。>

\textbf{摘要}：<3--5 句话概括论文做了什么>
```

### 辅助定位问题

1. 论文引言的第一段提出了什么未解决的问题或缺口？
2. 论文的标题和摘要中最核心的参数/对象是什么？
3. 这篇论文属于极值图论、拉姆齐理论、染色理论、结构图论、随机图论还是谱图论？

---

## 维度 2：主定理相关定义提取

### 目标

提取**与主定理直接相关**的定义，不包括论文中所有定义。判断标准：

- 主定理陈述中直接出现的术语/符号的定义 → **必须提取**
- 主定理证明过程中核心使用的定义 → **必须提取**
- 与主定理结果有直接比较关系的已知结果涉及的定义 → **建议提取**
- 仅在预备知识节中列出、主定理未使用的定义 → **不提取**

### LaTeX 输出模板

每个定义独立一个 `\subsection*{}`：

```latex
% ============ 维度 2 ============
\section*{维度 2：核心定义}

\subsection*{定义 1：<定义名称>}

\textbf{原文陈述}：
\begin{quote}
<逐字引用原文，LaTeX 格式，注意 C2>
\end{quote}

\textbf{位置}：\S X.Y

\textbf{与主定理的关系}：<1--2 句话>

\subsection*{定义 2：<定义名称>}
...
```

---

## 维度 3：研究综述（聚焦同类研究对象）

### 目标

梳理与**本文研究对象相同或高度相似**的文献发展脉络。

### 组织原则

- 以**研究对象**为线索串联文献
- 按时间顺序排列
- 每条包含：作者/年份、研究对象、核心结果、与本文的关系

### LaTeX 输出模板

```latex
% ============ 维度 3 ============
\section*{维度 3：研究综述——<本文研究对象>的发展}

\subsection*{研究脉络概要}

<2--3 句话概括从起源到本文的整体发展逻辑>

\subsection*{关键已有工作}

% 综述表：一般 4--6 篇，列宽按需调整
\begin{longtable}{|c|p{2.5cm}|p{3cm}|p{3.5cm}|p{2.5cm}|}
\hline
序号 & 工作 & 研究对象 & 核心结果 & 与本文关系 \\
\hline
1 & <作者> [X] (<年份>) & <对象> & <结果，LaTeX> & <如：本文改进对象> \\
\hline
2 & ... & ... & ... & ... \\
\hline
\end{longtable}

\subsection*{发展脉络详解}

\textbf{早期奠基（如有）}：
<简述>

\textbf{关键突破（如有）}：
<简述>

\textbf{最新进展（近 3--5 年）}：
<简述>

\textbf{本文定位}：
<2--3 句话说明本文在脉络中的位置>
```

### 补充说明

- 若论文引用文献 >15 篇，精选 5–10 篇展开
- 未被引用但与研究对象高度相关的工作，标注 `[UNCERTAIN: 外部补充，论文未引用]`

---

## 维度 4：主定理与已知结果改进分析

### 目标

1. 逐字列出所有主定理
2. 每个主定理对标 1–2 个已知结果，明确改进点

### LaTeX 输出模板

```latex
% ============ 维度 4 ============
\section*{维度 4：主定理与改进分析}

\subsection*{主定理清单}

\textbf{Theorem X.X}（逐字陈述）
\begin{quote}
<原文陈述>
\end{quote}

\subsection*{主定理 1：Theorem X.X —— 改进分析}

% 改进对比表：4 列，按需调 p{} 宽度
\begin{longtable}{|p{2.2cm}|p{4cm}|p{4cm}|p{3.3cm}|}
\hline
对比维度 & 已知结果 [标签] & 本文结果 Theorem X.X & 改进说明 \\
\hline
研究对象 & <值> & <值> & <值> \\
\hline
上界 & <值> & <值> & <值> \\
\hline
适用条件 & <值> & <值> & <值> \\
\hline
紧性 & <值> & <值> & <值> \\
\hline
\end{longtable}

\textbf{改进点总结}：
\begin{enumerate}
\item <改进点 1：具体说明改进了什么>
\item <改进点 2>
\end{enumerate}

\textbf{改进方式/技术创新}：<本文通过什么新技术或新构造实现了上述改进>
```

---

## 维度 5：证明大纲与证明树构建

### 目标

构建以主定理为**根节点**的证明树：
- 节点 = 达成某个中间结论或条件
- 边 = 推理方法（反证法、归纳法、概率方法、构造法、不等式放缩等）
- 层级 = 从根向下逐层展开

### 构建规则

1. **根节点**：主定理
2. **第一层**：能**直接推出**主定理的条件/引理。边标注推理方法
3. **第二层及以下**：类推
4. **终止叶节点**：
   - 已知结论：标注 `[KNOWN: 来源]`
   - 定义：标注 `[DEFINITION]`
   - 外部引用：标注 `[EXTERNAL: 标注]`
   - 不再展开的基底：标注 `[BASE]`

### 节点类型标注

- `[THEOREM]` / `[LEMMA]` / `[CLAIM]` / `[DEFINITION]` / `[CONSTRUCTION]` / `[KNOWN]` / `[EXTERNAL]` / `[BASE]`

### 边（推理方法）常用标注

反证法、逆否命题、直接推导、充分性方向/必要性方向、归纳法（对某参数）、概率方法（期望/存在性）、构造法、不等式放缩（具体不等式名）、分类讨论（分 N 类）、双重计数、回到定义、稳定性方法、正则引理+计数引理、贪心着色、删色缩减列表

### LaTeX 输出模板：主报告（引用树图片）

```latex
\subsection*{证明策略摘要}

<2--4 句话的意译证明策略概述>

\subsection*{共享引理（如有）}

\begin{itemize}
\item \textbf{Lemma X.Y}：被 Theorem A 和 Theorem B 共同使用
\end{itemize}

\subsection*{证明树：Theorem X.X}

% 证明树保存为独立 PDF 图片，通过 includegraphics 引用
\begin{figure}[htbp]
\centering
\includegraphics[width=\textwidth,keepaspectratio]{<slug>_tree_thmX.pdf}
\caption{Theorem X.X 的证明树}
\label{fig:proof-tree-thmX}
\end{figure}
```

### LaTeX 输出模板：独立树图片（`<slug>_tree_<name>.tex`）

每个主定理/辅助引理生成一个独立的树图文件，使用 `standalone` 文档类编译为单页 PDF 矢量图。节点通过**颜色编码**突出证明结构层次。

```latex
% 文件名：<slug>_tree_thmX.tex
\documentclass[tikz,border=8pt]{standalone}
\usepackage[UTF8]{ctex}
\usepackage{amsmath,amssymb}
\usepackage{forest}
\useforestlibrary{edges}

% ---- 节点类型样式定义 ----
\forestset{
  nodestyle/.style={draw, rounded corners, inner sep=3pt, align=left, font=\footnotesize},
  thm/.style={nodestyle, fill=blue!25, draw=blue!70, line width=0.8pt},
  lem/.style={nodestyle, fill=green!12, draw=green!50},
  case/.style={nodestyle, fill=orange!10, draw=orange!50},
  ext/.style={nodestyle, fill=yellow!12, draw=yellow!60},
  cor/.style={nodestyle, fill=violet!10, draw=violet!50},
  base/.style={nodestyle, fill=gray!8, draw=gray!40, font=\footnotesize\itshape},
  step/.style={nodestyle, fill=white, draw=black!30},
}

\begin{document}
\begin{forest}
  for tree={
    grow'=south,
    parent anchor=south,
    child anchor=north,
    l sep=4mm,
    s sep=2mm,
    edge={->, >=stealth, semithick},
  },
  [ThmX, thm, content={\textbf{[THEOREM]} Theorem X.X: <简述结论>}
    [LemY, lem, content={\textbf{[LEMMA]} Lemma X.Y\\<简述>}, edge label={node[midway,left,font=\tiny\itshape\color{gray}]{<推理方法>}}
      [Base1, base, content={\textbf{[BASE]} <简述>}, edge label={node[midway,left,font=\tiny\itshape\color{gray}]{直接推导}}
      ]
      [Ext, ext, content={\textbf{[EXTERNAL]} Theorem Z\\<简述>}, edge label={node[midway,left,font=\tiny\itshape\color{gray}]{引用}}
      ]
    ]
    [Case2, case, content={\textbf{[CASE]} <简述>}, edge label={node[midway,left,font=\tiny\itshape\color{gray}]{分类讨论}}
      [S1, step, content={Step 1: <构造步骤>}, edge label={node[midway,left,font=\tiny\itshape\color{gray}]{构造法}}
        [Base2, base, content={\textbf{[BASE]} <简述>}]
      ]
    ]
  ]
\end{forest}
\end{document}
```

### 规则

- **独立树文件**：每个证明树写为独立的 `<slug>_tree_<name>.tex`，使用 `\documentclass[tikz,border=8pt]{standalone}`
- **节点颜色编码**（见 C7 表格）：蓝=定理根、绿=引理、橙=分支条件、黄=外部引用、紫=推论、灰=终止叶（斜体）、白=中间步骤
- **树方向**：默认向下生长（`grow'=south`），适合深度嵌套的证明树；浅宽树可用 `grow'=east`
- **边标签**：推理方法用 `edge label={node[midway,left,font=\tiny\itshape\color{gray}]{方法}}`，灰色斜体，不干扰主体
- **节点标识**：使用简短 ID + `content={...}`，`content` 内 `[...]` 无需转义
- **间距**：`l sep=4mm`（层级间距）、`s sep=2mm`（兄弟间距），可按树大小微调
- **主报告引用**：`\includegraphics[width=\textwidth,keepaspectratio]{<slug>_tree_<name>.pdf}`
- 每个主定理一棵树，多主定理则多棵树 + 多份独立文件

### 多主定理情况

若证明相互独立，分别构建。共享引理另起一节。

---

## 维度 6：未来研究方向与方法建议

### 目标

基于本文结果和综述，提出**可操作**的未来研究问题。

### LaTeX 输出模板

```latex
% ============ 维度 6 ============
\section*{维度 6：未来研究方向}

\subsection*{方向 1：<问题名称>}

\textbf{问题陈述}：<1--2 句话>

\textbf{动机}：<1--2 句话>

\textbf{方法建议}：
\begin{enumerate}
\item <具体方法建议 1>
\item <具体方法建议 2>
\end{enumerate}

\textbf{同类方法参考论文}：<1--2 篇使用了本文核心技巧（维度 1 中识别的方法）的相关论文，为研究者提供方法论参考。格式：``作者 (年份)，\textit{标题}。—— 关联：简述该方法在该论文中的使用方式。若无法确定，标注 [UNCERTAIN]。>

\textbf{预期难度}：低 / 中 / 高 / 极高

\subsection*{方向 2：<问题名称>}
...
```

### 生成原则

- **不要空泛**：避免无具体目标的建议
- **基于论文自身**：优先从结论/讨论/开放问题节提取
- **基于维度 4**：从改进分析中找未覆盖的缺口
- **基于维度 3**：从已知结果的局限性中找突破方向

### 方向来源检查清单

- [ ] 论文的"结论"或"开放问题"节
- [ ] 论文中标注为"未来工作"的语句
- [ ] 主定理中未达到紧界
- [ ] 主定理的条件能否减弱
- [ ] 本文结果对更一般的图类是否成立
- [ ] 综述中已知结果的未解决问题
- [ ] 本文技术方法能否应用于其他问题

---

## 输出完成清单

- [ ] 骨架严格使用指定 preamble + 标题块（含 C6 的作者名转义）
- [ ] 研究主题清晰概括，含核心证明技巧分析 + 同类方法论文推荐（维度 1）
- [ ] 核心定义仅保留与主定理相关的（维度 2）
- [ ] 每个未来方向附「同类方法参考论文」（维度 6）
- [ ] 研究综述聚焦同类对象（维度 3）
- [ ] 每个主定理对标已知结果且明确改进点（维度 4）
- [ ] 证明树单独保存为 `<slug>_tree_<name>.tex`，使用 `standalone` 文档类（维度 5 / C7）
- [ ] 树节点使用颜色编码（`thm`/`lem`/`case`/`ext`/`base`/`step` 样式），`content={...}` 格式
- [ ] 主报告通过 `\includegraphics` 引用树图片
- [ ] 未来方向具体可操作（维度 6）
- [ ] 所有数学符号 LaTeX 格式（C1）
- [ ] 所有文本特殊字符已转义（C5）
- [ ] 定理/定义陈述逐字引用（C2）
- [ ] 不确定处已标 `[UNCERTAIN]`（C3）
- [ ] 文件以 `\end{document}` 结尾
- [ ] 文件名：主报告 `<slug>_reading.tex` + 树图 `<slug>_tree_<name>.tex`

---

## 编译指南（需告知用户）

文件生成后，**先编译树图片文件，再编译主报告**：

```bash
# 1. 编译每个独立的证明树文件为 PDF
xelatex -interaction=nonstopmode <slug>_tree_thmX.tex
xelatex -interaction=nonstopmode <slug>_tree_lemma1.tex
# ...（每个树文件各一次）

# 2. 编译主报告（引用树 PDF）
xelatex -interaction=nonstopmode <slug>_reading.tex
xelatex -interaction=nonstopmode <slug>_reading.tex
```

主报告跑两次 xelatex 以解析交叉引用和目录。若从 Markdown 源提取 \<slug\>，去掉 `.md` 后缀、保留论文标识名。
