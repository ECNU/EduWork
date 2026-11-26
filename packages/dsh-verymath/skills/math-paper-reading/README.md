# Math Paper Reading - AI4Math Skill Package

The English version of the README is placed below the Chinese version.

该技能包提供了一套高度专业、环环相扣的系统提示词（Skills），用于构建面向数学论文精读、结构提取、证明依赖分析和文献管理的 AI4Math 助理。

本系统采用了**数据驱动架构（Data-Driven Architecture）**。其核心逻辑是先通过结构提取将论文转化为 Ground Truth JSON 文件，随后所有深度阅读、图谱渲染、文献检索等操作均严格基于该结构化数据执行，从而杜绝大模型的逻辑幻觉。

## 🏗️ 系统架构与工作流

系统由主控路由中枢统一调度，采用“路由先行，技能按需加载”的模式：

1. **路由解析 (Routing):** 用户的任何指令都会首先触发 `agent_router.md`。它作为大脑解析意图，并决定加载哪个具体的技能说明书。
2. **结构提取 (Extraction):** 若为新论文，路由会首先调用 `skill_base.md` 生成逻辑骨架 JSON。
3. **专业处理 (Execution):** 路由根据后续需求，依次加载对应的图计算、深读或检索模块，确保各步骤严谨衔接。

---

## 🧩 核心模块解析

### 1. 主控路由中枢 (`agent_router.md`)

* **角色**：首席科研助理与中枢神经。
* **功能**：这是交互的**唯一入口**。它负责意图识别，并按需读取本地 `skill_*.md` 文件。通过这种方式，它能精确控制上下文，防止一次性加载过多信息导致混乱。

### 2. 结构提取模块 (`skill_base.md`)

* **角色**：基础数据架构师。
* **功能**：解析论文原文，将定义、引理、定理及证明依赖提取为 `<slug>_structure.json`。
* **硬约束**：强制 LaTeX 符号规范，定理陈述必须 100% 逐字引用。

### 3. 图计算引擎 (`skill_pathway_proof.md`)

* **角色**：逻辑拓扑专家。
* **功能**：纯粹基于 JSON 数据进行拓扑计算。它会调用 Python 脚本统计入度/出度，确保证明路径的严谨性。
* **产出**：渲染 Mermaid.js 依赖图，自动合成“目标导向（Top-down）”阅读路径。

### 4. 深度阅读助手 (`skill_paper_deep_read.md`)

* **角色**：数学研究员与导师。
* **功能**：提供从速览 (L1) 到深度推导 (L3) 的多层级解读。在 L3 阶段，它会识别原文的逻辑跳跃并进行填补，提取隐性断言 (Claim)。

### 5. 文献管理助手 (`skill_reference_manager.md`)

* **角色**：知识库管家。
* **功能**：管理 `local_reference_db.json` 本地数据库。它将论文元数据、核心结论及您的个人感悟持久化存储，支持语义检索与冷落提醒。

### 6. 文献检索助手 (`skill_literature_search.md`)

* **角色**：高级情报专家。
* **功能**：将数学概念转化为精准的数据库检索式。它能基于论文的外部依赖自动生成“向后追溯”的滚雪球检索策略。

---

## 🚀 核心特性

* **事实与解释分离**：所有定理先展示 JSON 中的逐字原文，再提供通俗化解释，确保准确性。
* **标准化 URI**：使用 `paper:arxiv:ID#Thm-N` 格式为所有逻辑实体编号，实现跨文档的精准引用。
* **代码驱动验证**：涉及复杂合并或统计任务时，Agent 优先编写运行 Python 脚本而非口头估算。

---

## 💻 使用指南

要使用此套件，请务必在每次开启新会话时，**首先让 AI 助手加载并遵守路由中枢的指令**：

1. **环境准备**：将 `agent_router.md` 和所有 5 个 `skill_*.md` 文件放入您的工作目录。
2. **初始化路由（关键第一步）**：启动会话后，**优先发送以下指令**，确立 Agent 的工作模式：
> *"请读取本地的 `agent_router.md` 文件，明确你作为首席数学科研 AI 助理的身份，并严格遵守其中的 Master Router SOP 作为本次会话的核心调度指令。准备好后请回复我。"*


3. **下达科研任务**：路由机制激活后，您无需再指定具体的 skill 文件，直接用自然语言描述科研需求，Claude 会自动按需加载模块，例如：
* **结构化与归档**：“帮我处理这篇新论文，提取结构并存入我的文献笔记。”（**路由**将自动依次调用 `skill_base` 和 `skill_reference_manager`）
* **逻辑拆解**：“这篇论文的引理 3.1 是如何推导出来的？请画出它的依赖子图。”（**路由**将自动调度 `skill_paper_deep_read` 和 `skill_pathway_proof`）
* **溯源检索**：“追溯这篇论文证明中依赖的所有外部定理。”（**路由**将分析 JSON 并激活 `skill_literature_search` 生成检索式）



---

## 📝 输出确认

每次执行完毕后，Agent 会确认相关成果（JSON、Markdown 报告、依赖图文件或数据库更新）已成功保存，并在完成当前环节后清理上下文，准备执行下一个任务。


# Math Paper Reading - AI4Math Skill Package

This package provides a specialized, interlocking set of AI4Math skill instructions for structured mathematical paper reading, theorem dependency extraction, proof-path analysis, and reference management.

The system adopts a **Data-Driven Architecture**. Its core logic first converts a paper into a Ground Truth JSON file through structure extraction. All subsequent operations — deep reading, graph rendering, literature retrieval, etc. — are executed strictly based on this structured data, thereby eliminating the logical hallucinations of large models.

## 🏗️ System Architecture and Workflow

The system is centrally orchestrated by a master routing hub, following a "route first, skills loaded on demand" pattern:

1. **Routing:** Any user command first triggers `agent_router.md`. Acting as the brain, it parses intent and decides which specific skill instruction file to load.
2. **Extraction:** If it is a new paper, the router first invokes `skill_base.md` to generate a logical skeleton JSON.
3. **Execution:** Based on subsequent needs, the router loads the corresponding graph computation, deep reading, or retrieval modules in order, ensuring that every step is rigorously connected.

---

## 🧩 Core Module Breakdown

### 1. Master Router Hub (`agent_router.md`)

* **Role:** Chief research assistant and central nervous system.
* **Function:** This is the **single entry point** for interaction. It is responsible for intent recognition and reads local `skill_*.md` files on demand. In this way, it precisely controls context and prevents confusion caused by loading too much information at once.

### 2. Structure Extraction Module (`skill_base.md`)

* **Role:** Foundational data architect.
* **Function:** Parses the original paper text and extracts definitions, lemmas, theorems, and proof dependencies into a `<slug>_structure.json`.
* **Hard Constraint:** Enforces standard LaTeX notation, and theorem statements must be quoted verbatim with 100% fidelity.

### 3. Graph Computation Engine (`skill_pathway_proof.md`)

* **Role:** Logical topology expert.
* **Function:** Performs topological computations purely based on JSON data. It invokes Python scripts to calculate in-degree/out-degree, ensuring the rigor of proof paths.
* **Output:** Renders Mermaid.js dependency graphs and automatically synthesizes "goal-oriented (top-down)" reading pathways.

### 4. Deep Reading Assistant (`skill_paper_deep_read.md`)

* **Role:** Mathematics researcher and mentor.
* **Function:** Provides multi-level interpretation ranging from a quick overview (L1) to deep derivation (L3). At the L3 stage, it identifies logical gaps in the original text, fills them in, and extracts implicit assertions (Claims).

### 5. Reference Manager (`skill_reference_manager.md`)

* **Role:** Knowledge base steward.
* **Function:** Manages the `local_reference_db.json` local database. It persistently stores paper metadata, core conclusions, and your personal insights, supporting semantic search and "cooling off" reminders.

### 6. Literature Search Assistant (`skill_literature_search.md`)

* **Role:** Senior intelligence specialist.
* **Function:** Translates mathematical concepts into precise database search queries. It can automatically generate a "backward snowballing" retrieval strategy based on a paper's external dependencies.

---

## 🚀 Core Features

* **Separation of fact and interpretation:** Every theorem first presents the verbatim original text from the JSON, followed by a plain-language explanation, ensuring accuracy.
* **Standardized URI:** Uses the `paper:arxiv:ID#Thm-N` format to number all logical entities, enabling precise cross-document referencing.
* **Code-driven verification:** When handling complex merging or statistical tasks, the Agent prioritizes writing and running Python scripts over verbal estimates.

---

## 💻 Usage Guide

To use this suite with an AI coding agent, start every new session by **loading and following the routing hub instructions**:

1. **Environment setup:** Place `agent_router.md` and all 5 `skill_*.md` files in your working directory.
2. **Initialize the router (critical first step):** After launching the session, **immediately send the following command** to establish the Agent's working mode:
> *"Please read the local `agent_router.md` file, clarify your role as the chief mathematical research AI assistant, and strictly adhere to the Master Router SOP as the core scheduling directive for this session. Reply when ready."*

3. **Issue research tasks:** Once the routing mechanism is active, you no longer need to specify a particular skill file. Simply describe your research needs in natural language, and the agent will load the required modules on demand. For example:
* **Structuring and archiving:** “Help me process this new paper, extract its structure, and save it in my literature notes.” (**Router** will automatically invoke `skill_base` and `skill_reference_manager` in sequence)
* **Logical deconstruction:** “How was Lemma 3.1 in this paper derived? Please draw its dependency subgraph.” (**Router** will automatically orchestrate `skill_paper_deep_read` and `skill_pathway_proof`)
* **Backward tracing:** “Trace all external theorems that the proof of this paper depends on.” (**Router** will analyze the JSON and activate `skill_literature_search` to generate search queries)

---

## 📝 Output Confirmation

After each execution, the Agent will confirm that the relevant outputs (JSON, Markdown reports, dependency graph files, or database updates) have been successfully saved. It will then clear the context after completing the current step, ready to proceed with the next task.
