---
name: math-glossary
description: "术语库构建与管理 skill。当用户需要从专业词汇文献（PDF/Excel/TXT/JSON/CSV/YAML/MDX/扫描件）中提取、构建、维护双语术语库时使用。触发场景：用户说'建术语库'、'整理数学词汇'、'从词典提取术语'、'术语库'、'glossary'、'词汇表'、'翻译术语管理'，需要查询术语库（'查术语'、'流形英文怎么说'），或翻译 agent 需要查询/更新术语库时。学科无关的通用框架，数学是第一个应用场景。在 DSH 中优先使用 verymath_glossary_query / verymath_glossary_upsert / verymath_glossary_build / verymath_python_check 工具执行。"
---

# 数学术语库构建与管理

从专业词汇资源中构建结构化的双语术语库，支持构建、维护、查询、导出。框架本身是学科无关的，数学是第一个应用场景。

> **用户手册**：`references/user-manual.md` — 面向终端用户的完整使用手册，涵盖快速开始、Web 管理、日志系统、FAQ。

## DSH 工具入口（本插件提供）

在 DSH 宿主中，本 skill 的确定性操作优先通过 `@eduwork/dsh-verymath` 插件提供的模型工具执行，而不是直接起子进程：

| 任务 | 工具 | 说明 |
| --- | --- | --- |
| 查询术语 | `verymath_glossary_query` | 按英文/中文/term_id/子领域查询 `glossary.json`，返回例句，支持子领域过滤，无需 Python |
| 存词/更新 | `verymath_glossary_upsert` | 读论文/翻译遇到新术语时追加或更新条目；自动维护排序、连续 idx 与日期，**不要手改 glossary.json** |
| 结构化建库/扩充 | `verymath_glossary_build` | 运行 `scripts/` 下的 `glossary_build.py` 等脚本（需本地 Python 3）；Excel 缺依赖时工具会报告部分成功，如实转述 |
| 依赖检查 | `verymath_python_check` | 检查 Python 3 是否可用并给出安装提示 |
| 结构化校验 | （无工具时）读 JSON 后按 `references/glossary-schema.md` 校验 | 术语库不变量见下文 |

规则：

1. **查询类请求**（用户问某个术语怎么说/中英对照）直接用 `verymath_glossary_query`；结果为空再走构建流程。
2. **执行 `glossary_build.py` / `glossary_export.py` / `glossary_backup.py` / `glossary_enrich_examples.py` 前**先调 `verymath_python_check`；不可用时把工具返回的安装提示原样告知用户，不要自行安装。
3. **`glossary_web.py`（Flask Web 管理界面）是长驻服务**，不通过 `verymath_glossary_build` 运行；仅在用户明确要求时用 shell 启动，并遵守下文 loopback 安全边界。
4. 本 skill 目录即脚本根目录（`scripts/`、`references/` 相对于本 SKILL.md 解析）；把产物写到用户工作区（如 `glossary/glossary.json`），不要写回 skill 目录。
5. 翻译 agent 查词约定、冲突裁决、备份与日志规范见下文原流程，行为不变。

## 数据模型

> 完整数据模型见 `references/glossary-schema.md`。该文件定义了所有字段、排序规则和术语库文件结构。开始前先读取它。

核心要点：每条术语是一个 JSON 对象，`term_id` 是唯一标识。同一条英文术语如有别名，别名展开为独立行（同一 `en`，`cn` 为别名，其余字段一致，`term_id` 加 `__N` 后缀区分）。术语库以 JSON 文件为唯一事实源，Excel 仅用于导出供人工审阅。

## 入口交互流程

当用户触发此 skill 时，按顺序询问以下问题。**每次只问一个问题**，等用户回答后
再问下一个。宿主支持结构化提问工具时可使用；不支持时直接用简短文本提问，不要
依赖某个专用客户端工具。

### 第1问：术语来源

先让用户输入文件路径（用户可以直接在聊天框里输入路径或拖拽文件）。接收到路径后，用 shell 验证路径是否存在。如果不存在，请用户重新输入。确认后进入第2问。

### 第2问：库类型

按以下内容提问：

```
header: "术语库类型"
question: "你想构建哪种类型的术语库？"
options (multiSelect: false):
  - label: "可更新库（推荐）"
    description: "后续可搜索、新增、修改"
  - label: "固定库"
    description: "建完不可进行后续操作"
```

- "可更新库"：构建完成后保持可维护状态。
- "固定库"：只跑构建流程。

### 第3问：来源文件类型

按以下内容提问：

```
header: "文件类型"
question: "来源文件是什么类型？"
options (multiSelect: false):
  - label: "文本文档（推荐）"
    description: "PDF / TXT / Excel / Markdown，从内容中直接提取术语对"
  - label: "结构化数据"
    description: "JSON / CSV / YAML，已有字段映射，直接导入"
  - label: "电子词典"
    description: "MDX 格式词典文件，解包后提取"
  - label: "扫描件 PDF"
    description: "需 OCR 处理"
```

- "文本文档"：从文档内容中提取术语对，适用于大多数场景
- "结构化数据"：源文件已是键值对或表格，按字段映射导入。支持 JSON（对象数组或键值对象）、CSV（自动编码检测）、YAML
- "电子词典"：MDX 格式词典文件，用 mdict-utils 解包为文本后提取
- "扫描件 PDF"：需 OCR 处理

## 构建流程

### 第一步：解析与提取术语

从源文件中提取英文→中文的术语对。

**双语对照格式（如《新英汉数学词汇》）**：按行解析。"英文 中文"的对应关系通常是工整的对照格式，直接拆分。

**Excel 表格格式**：自动识别英文列和中文列。优先找表头含 "English/英文/术语/term" 和 "中文/翻译/译名/Chinese/translation" 的列。

**纯文本格式**：识别相邻出现的 "英文术语" + "中文翻译" 模式。数学术语的英文通常是单个单词或短语（如 *manifold*、*homotopy group*），中文通常是 2-6 个字的词或短语。

**Markdown 格式**：识别 Markdown 中的术语对照。常见排版结构包括：
- 表格：`| English | 中文 |` → 逐行提取
- 列表：`- term → 译法` 或 `- term (译法)`
- 分隔符对照：`EN | CN` 格式的术语表

**JSON 格式**：直接读取 JSON 文件，自动识别字段映射：

1. 如果 JSON 是对象数组 `[{...}, {...}]`：自动匹配字段名
   - en 列识别：`en` / `english` / `term` / `word` / `keyword` / `name`
   - cn 列识别：`cn` / `chinese` / `translation` / `definition` / `译名` / `中文` / `翻译`
   - pos 列识别：`pos` / `词性` / `part_of_speech`
   - field 列识别：`field` / `领域` / `domain` / `discipline` / `学科`
   - 未识别的字段忽略
2. 如果 JSON 是键值对象 `{"term": "translation", ...}`：直接当作 `{en: cn}` 对解析
3. 已符合本术语库 schema 的 JSON（有 `term_id`、`en`、`cn`）可直接合并，但仍需走冲突检测

**CSV 格式**：用 Python `csv` 模块自动检测分隔符（逗号/制表符）和编码（UTF-8/UTF-8 BOM/GBK）。首行当作表头，按上述 JSON 的字段识别规则匹配列名。跳过空行。

**YAML 格式**：用 `yaml.safe_load()` 解析，然后按 JSON 格式的同样逻辑处理。

对 CSV/TSV/JSON/YAML，优先使用正式离线入口（DSH 中用 `verymath_glossary_build` 工具，`script: "glossary_build.py"`，`args` 传源路径与选项；其他宿主用 shell）：

```bash
python3 scripts/glossary_build.py "/path/to/source.csv"
```

该命令自动识别常用列名、记录文件名与行号/记录号、生成唯一 `term_id`、排序并连续
编号。默认不覆盖已有 JSON；覆盖必须先确认备份并显式添加 `--force`。PDF、OCR、
MDX 和自由文本仍按本节工作流解析并人工复核，不伪装成已经自动化。

**MDX 电子词典格式**：用 `mdict -x <file>.mdx -d <output_dir>` 解包为 `.txt` 文件，然后解析：

- 每条记录以 `</>` 分隔
- 每条记录的第一行是关键词（英文术语）
- 后续行是 HTML 内容，从 `<div class="title">` 提取英文术语，从 `<div class="text">` 提取中文译名
- 跳过 `@@@LINK=xxx` 条目（它们是交叉引用，不是独立术语）

为什么会这样设计——学术界的术语数据分布在多种格式中：开放术语项目用 JSON/YAML 发布，政企标注用 CSV，中文词典社区（FreeMdict）用 MDX 发布高质量英汉词典。覆盖这四种格式意味着 skill 可以直接导入现成的术语数据源，而不必人工重新整理。

**溯源精度**：解析每条术语时，在 `source` 字段中记录来源信息（如文件名+行号），以便后续追溯每条术语在源文件中的具体位置。无需额外的 `note` 字段。

提取后，为每条术语构造完整 JSON：

```python
term = {
    "term_id": en_term,
    "en": en_term,
    "cn": cn_term,
    "pos": "",          # 词性用中文填写，如 "名词"、"动词"、"形容词"
    "field": [],         # 子领域，支持数组（如 ["代数拓扑", "代数几何"]），从 "/" 分隔的文本自动拆分
    "source": source_name,  # 来源文件名
    "examples": [],
    "created_at": today,
    "updated_at": today
}
```

`today` 的格式为 ISO 日期 `YYYY-MM-DD`。

> **注意**：别名不再作为字段存储。如果术语有别名（如 `axiom of choice` 别名
> `AC`），别名应展开为独立行：同一 `en`，`cn` 为别名，其余字段与原术语一致。
> 无 `__N` 后缀的 `term_id` 标识来源中首先出现的主译名；该身份不依赖排序后的
> 显示位置。排序时仍按 `en`、`cn`，确保别名相邻。

### 第二步：冲突检测与合并

如果 `glossary.json` 已经存在，将新提取的术语与现有术语比较：

1. **新术语（term_id 不存在）**：直接加入
2. **重复术语（同一 term_id）**：用新来源的值覆盖旧值，并把旧值记录到变更日志中
3. **同一来源内部的冲突**（同一 term_id 在同一来源中出现多次，译法不同）：列出冲突条目让用户逐条裁决

冲突展示格式：
```
发现 1 条术语存在冲突译法：

homology：
  · 同调（来源：新英汉数学词汇 第3章）
  · 同源性（来源：新英汉数学词汇 第7章）
  · 二者均保留

请选择保留哪个译法？（输入 1 或 2 或 3）
```

### 第三步：排序与安全写入

将最终结果按英文术语字母顺序排序后写入 glossary.json，然后自动导出 Excel。所有输出文件统一扁平存放在来源文件所在目录下的"术语库"文件夹中。

排序 + 连续编号 + 写入 + 导出的顺序：

1. `terms.sort(key=lambda t: (t.get("en", "").lower(), t.get("cn", "").lower()))` — 按 en -> cn 两级排序
2. `for i, t in enumerate(terms, 1): t["idx"] = i` — 重新连续分配 idx
3. 写入 `glossary.json`
4. 调用 `glossary_export.py export` 导出 Excel（新导出成功后删除旧 .xlsx）
5. 对 JSON 和 Excel 都要做排序+重编号，保证 idx 连续无断层

如果 `openpyxl` 缺失或导出失败，保留已经原子写入的 JSON，但必须报告
“JSON 已完成、Excel 待完成”，不得声称整个构建流程已经完成。补齐依赖后再单独
运行 `scripts/glossary_export.py export`。

依赖齐全时保持三者一致：JSON（事实源）→ Excel（导出）→ Web 前端（读取 JSON
展示）。`_save_terms()` 统一处理此流程；Excel 暂缺时，JSON 仍是可继续工作的
事实源。

**重要：Excel 导出后将旧的 .xlsx 文件删除，只保留最新一份。** 导出的 Excel 文件命名为 `glossary_YYYY-MM-DD.xlsx`，如果同一天多次导出会覆盖，不同日期导出则删除前一天的文件。

## 维护操作与Web管理界面（可更新库模式）

> **模板文档**：`references/glossary-web-template.md` — 详细记录了 Web 界面模板的所有可定制点（路径、端口、字段、配色、文案等）。后续建立新的术语库维护网页时，阅读该文档按需修改即可。

构建完成后，可从 package 根目录启动本地 Web 服务器：

```bash
python3 scripts/glossary_web.py \
  --glossary "/absolute/path/to/glossary.json"
```

默认只监听 `127.0.0.1:7788` 并打开系统浏览器。无图形界面环境使用
`--no-browser`。界面没有身份认证；除非用户明确理解风险并添加
`--allow-remote`，不得绑定非 loopback 地址。使用完毕后优先在启动终端按
`Ctrl+C` 停止服务器。

**文件说明**：
- `scripts/glossary_web.py` — Web 管理界面模板（单文件 Flask 应用，内嵌 HTML/CSS/JS）
- `scripts/glossary_backup.py` — 备份脚本（扩充流程手动触发）
- `scripts/glossary_build.py` — CSV/TSV/JSON/YAML 结构化建库入口
- `scripts/glossary_export.py` — Excel 导入导出脚本

界面支持：

- 🔍 **搜索** — 输入即搜，前缀匹配英文/中文
- 👁️ **查看** — 点击术语所在行，展示完整字段（含统计栏：总数、来源、首字母分布）
- ✏️ **修改** — 在详情中编辑，显示前后对比，二次确认后修改
- 🗑️ **删除** — 二次确认后删除
- ➕ **新增** — 填写英文+中文+词性+子领域+来源，自动查重

写操作（修改/删除/新增）自动记录到 `修改记录.md` 并刷新 Excel 导出。所有写操作均自动按 en → cn 排序并重新分配连续 idx。JSON / Excel / Web 前端三者随时保持同步。

### 新术语库部署步骤

1. 保持脚本位于 package 的 `scripts/` 中，不复制或改写模板。
2. 在用户明确选择的工作目录创建 `glossary.json`。
3. 从 package 根目录运行上述启动命令，并通过 `--glossary` 传入数据路径。
4. 需要改变端口时传 `--port`，不修改源码。
5. 验证搜索、新增、编辑、删除、日志和 Excel 刷新均只影响该数据目录。

### 第4问：是否备份

按以下内容提问：

```
header: "预先备份"
question: "扩充前是否需要备份当前术语库？"
options (multiSelect: false):
  - label: "需要（推荐）"
    description: "扩充前自动备份 glossary.json 到备份文件"
  - label: "不需要"
    description: "直接扩充，不额外备份"
```

### 扩充操作（CLI 端）

如果用户想利用新的术语对照资料对术语库进行大范围扩充，需要在终端输入精确指令：

> **"我想扩充当前术语库"**

只有这一句精确匹配才会触发扩充流程。skill 按顺序引导用户：

1. 先问"请提供用于扩充的源文件路径"
2. 验证路径存在后，询问第4问（是否备份）
3. 走构建流程（解析→提取→冲突检测→合并）
4. 完成后自动刷新 Excel 并生成扩充记录

**注意：第4问是扩充流程专属问题，不在初始构建的四问交互流程中。初始构建的第3问之后直接进入构建流程，不需要第4问。**

#### 扩充记录日志

扩充完成后，必须在术语库目录生成 `扩充记录.md`，包含两个表格：

**第一个表 — 新增术语**（无新增时显示"本次扩充无新增术语"）：

| 序号 | 英文术语 | 中文译名 | 词性 | 子领域 | 来源 | 例句(英文) | 例句(中文) | 创建时间 | 更新时间 |
|------|---------|---------|------|--------|------|-----------|-----------|----------|----------|

每行为一条新增术语的全部字段信息。序号按最终排序后的连续 idx。

**第二个表 — 替换术语**（无替换时显示"本次扩充无替换术语"）：

| 序号 | 词汇 | 替换前信息 | 替换后信息 | 变更原因 |
|------|------|-----------|-----------|----------|

每行为一条被替换术语，替换前后只填被修改的字段，格式为 `字段名：旧值 → 新值`，多字段用 `<br>` 分行。变更原因说明替换的动机（如"补全缺失字段""语义修正""来源更新"）。

#### 扩充后处理

1. JSON 按 en → cn 排序后重新连续分配 idx
2. 调用 `glossary_export.py` 重新导出 Excel（删除旧 .xlsx，只保留新导出的）
3. 生成 `扩充记录.md`（上述格式）
4. 如果用户选择了"需要备份"，先用 `glossary_backup.py` 备份当前 glossary.json
5. JSON 和 Excel 都要做排序+重编号，保证 idx 连续无断层

扩充完成后展示操作指引。

## 依赖检查

首次使用脚本时先调 `verymath_python_check` 工具（其他宿主用 shell 做只读检查）：

```bash
python3 -c "import flask, openpyxl, yaml"
python3 -c "import openai"  # 仅例句自动补全需要
python3 -c "import shutil; print(shutil.which('mdict') or 'missing')"  # 仅 MDX
```

缺少依赖时先向用户报告用途和安装范围，获得确认后再安装：

```bash
python3 -m pip install -r requirements.txt
python3 -m pip install -r requirements-ai.txt  # 可选
python3 -m pip install mdict-utils              # 仅 MDX，可选
```

不得自动安装依赖，不得读取未明确提供的密钥，不得把密钥写入术语库、日志或命令
输出。

## 写入与安全边界

- 只写入用户明确选择的术语库目录。
- 覆盖或批量扩充前先展示目标路径；用户选择备份时先运行
  `scripts/glossary_backup.py`。
- JSON 使用原子替换；新 Excel 导出成功后才清理旧 Excel。
- 不直接发布源词典、论文、扫描件或其他可能受版权约束的语料。
- Web 界面默认只绑定 loopback 地址，远程暴露需用户显式授权。
- AI 例句属于待审阅建议，不得当作原始文献证据。

## 与翻译 agent 的约定

> **完整使用指南**：`references/glossary-usage-guide.md` — 供第三方翻译 Agent 调用术语库的完整文档，包含查词流程、多义词消歧策略、示例代码。需要调用术语库的 Agent 应优先阅读该指南。

本 skill 只负责术语库的构建和维护，不直接调用翻译 agent。与翻译 agent 之间的接口约定：

- 翻译 agent 读取 `glossary.json`，建立 `{term_id → cn}` 映射表；**在 DSH 中新增/更新术语一律走 `verymath_glossary_upsert` 工具**，不要手改 JSON（工具自动维护不变量）
- 翻译时优先按 `term_id` 精确查找，再按 en 子串匹配
- 同一个 en 在不同 field 下有不同 cn（多义术语），需根据文献上下文所属子领域以及语境选择
- 术语若有例句（`examples`），翻译 agent 应将原文上下文与例句对比，选择语义最接近的义项
- 术语库中例句缺失且用户同意调用外部模型时，可调用
  `scripts/glossary_enrich_examples.py`。必须用 `--model` 和 `--api-key`（或
  `MATH_GLOSSARY_MODEL`、`MATH_GLOSSARY_API_KEY`）显式配置；自定义
  OpenAI-compatible endpoint 使用 `--api-base`。生成结果需人工审阅。
