# 术语库使用指南（供第三方翻译 Agent 调用）

本文档面向需要调用本术语库进行翻译任务的 AI Agent，说明如何读取、查询、消歧和维护术语库。

---

## 一、术语库文件位置

```
<术语库目录>/
├── glossary.json           ← 唯一事实源（读取此文件即可）
├── glossary_YYYY-MM-DD.xlsx ← Excel 导出（供人工审阅，Agent 无需读取）
│
├── 修改记录.md              ← 网页端操作的变更日志
├── 扩充记录.md              ← 批量扩充的变更日志
└── glossary_backup_<时间戳>.json ← 扩充流程手动备份
```

Agent 只需读取 `glossary.json`。Web 与导入导出脚本保留在安装后的
`math-glossary/scripts/`，不复制到数据目录。

---

## 二、数据模型（关键字段速览）

每条术语的 JSON 结构：

```json
{
  "term_id": "manifold",        // 唯一标识（en 小写；别名行加 __N 后缀）
  "en": "manifold",             // 英文原文
  "cn": "流形",                  // 中文译名（或别名）
  "idx": 321,                   // 连续序号
  "pos": "名词",                 // 词性（中文）
  "field": ["拓扑学"],           // 子领域（数组，可多值）
  "source": "新英汉数学词汇",    // 来源参考书
  "examples": [                 // 例句，每个有 en + cn
    {"en": "a smooth manifold", "cn": "光滑流形"}
  ],
  "created_at": "2026-07-10",
  "updated_at": "2026-07-10"
}
```

完整字段定义见 `references/glossary-schema.md`。

---

## 三、翻译时的查词流程

### 3.1 基本查词

```python
# 1. 读取
with open("glossary.json") as f:
    terms = json.load(f)

# 2. 建索引（一次即可，建议缓存）
index = {t["term_id"]: t for t in terms}
```

### 3.2 精确匹配（优先级最高）

翻译时，对原文中识别到的英文术语，优先按 `term_id` 精确查找：

```python
def lookup(term: str, index: dict) -> dict | None:
    """精确匹配（大小写不敏感）"""
    return index.get(term.lower())
```

### 3.3 模糊匹配（精确匹配失败时）

如果原文中的术语在词库中不存在（可能是变体、复数、短语变体），按以下优先级尝试：

1. **词干匹配**：去掉末尾 `-s`/`-ing`/`-ed` 等后缀再查
2. **子串匹配**：在 `en` 字段中搜索原文是否为已知术语的一部分（如 `"smooth manifold"` → 匹配 `"manifold"`）
3. **别名匹配**：同一 `en` 下有多行时，`term_id` 无 `__N` 后缀的记录是主译名，
   其他记录为别名行（`cn` 即为别名）。不要用排序后的物理行号判断主译名。搜索时
   对所有 `cn` 做匹配。

### 3.4 field 上下文辅助

如果原文有章节标题或已知所属子领域（如"拓扑学""代数"），可先按 `field` 过滤候选术语再查，提高准确率。`field` 是数组，用 `in` 判断：

```python
candidates = [t for t in terms if "拓扑学" in t.get("field", [])]
```

---

## 四、多义词消歧策略

当同一 `term_id` 有多行（含别名行），Agent 需根据翻译上下文自动选择：

### 策略 1：例句对比（最优先）

读取该术语（所有同 `en` 行）的 `examples` 数组，将原文上下文与例句对比，选择语义最接近的义项。

### 策略 2：field 匹配

如果原文上下文有明确的子领域标识（如章节名、前后文中的领域关键词），匹配 `field` 字段中的子领域。

### 策略 3：频率优先

同一 `en` 的多行中，`term_id` 无 `__N` 后缀的记录为主译名；它在按 `cn` 排序后
不一定排在物理第一行。无明确上下文时默认选择该记录。

### 消歧示例

```
原文: "A measure assigns a non-negative number to subsets."
上下文关键词: assign, non-negative, subsets

en: "measure" (有 1 行，无别名)
  cn: "测度"        ← field: 数学/测度论, examples 中有类似上下文 → 匹配 ✓

→ Agent 应选择 "测度"
```

---

## 五、术语库维护约定（Agent 在翻译过程中发现新术语时）

翻译时如果遇到原文中的术语在术语库中不存在，Agent 可以：

1. 自行翻译该术语
2. 将新术语（含 en、cn、pos、field、source、原文例句）追加到 `glossary.json`
3. 写入后按 en → cn 排序 + 重新连续分配 idx
4. 重新导出 Excel（调用 `glossary_export.py export`）

**不要直接修改 Excel**，JSON 是唯一事实源。

---

## 六、示例 Python 翻译集成代码

```python
"""翻译 Agent 集成术语库的最小示例"""
import json

def load_glossary(path="glossary.json") -> dict:
    with open(path, "r", encoding="utf-8") as f:
        terms = json.load(f)
    return {t["en"].lower(): t for t in terms}, terms

def translate_term(word: str, context: str = "", index: dict = None, all_terms: list = None) -> str:
    """根据上下文翻译单个术语"""
    key = word.lower().strip()
    term = index.get(key) if index else None
    if not term:
        return None  # 未命中

    # 如果只有单一含义（无别名行），直接返回
    return term["cn"]

def _context_similarity(ctx: str, ex: str) -> float:
    """简单的上下文相似度（按共用词比例）"""
    ctx_words = set(ctx.lower().split())
    ex_words = set(ex.lower().split())
    if not ex_words:
        return 0.0
    return len(ctx_words & ex_words) / len(ex_words)
```

---

## 七、Excel 导出（人工审阅用）

翻译 Agent 不要直接修改 Excel。如需导出：

```bash
python3 scripts/glossary_export.py export <glossary.json路径> <输出目录>
```

生成的 `glossary_YYYY-MM-DD.xlsx` 含 10 列：序号、英文术语、中文译名、词性、子领域、来源、例句(英文)、例句(中文)、创建时间、更新时间。
