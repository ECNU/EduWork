# 术语库 JSON 数据模型

机器可读版本见同目录的 `glossary.schema.json`。除 JSON Schema 可表达的字段约束外，
还必须满足以下跨条目不变量：`term_id` 全局唯一；条目按 `en`、`cn` 排序；`idx`
从 1 开始连续编号。

## 完整字段

```json
{
  "term_id": "manifold",
  "en": "manifold",
  "cn": "流形",
  "pos": "名词",
  "field": ["拓扑学"],
  "source": "新英汉数学词汇",
  "examples": [
    {"en": "a smooth manifold", "cn": "光滑流形"}
  ],
  "created_at": "2026-07-10",
  "updated_at": "2026-07-10"
}
```

## 字段定义

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `term_id` | string | ✅ | — | 唯一标识。单条术语用 `en` 的小写形式；同 en 多条时（别名行）用 `en__N` 后缀区分 |
| `en` | string | ✅ | — | 英文术语原文 |
| `cn` | string | ✅ | — | 中文译名（如为别名行，cn 即别名） |
| `pos` | string | ❌ | `""` | 词性，中文填写：名词 / 动词 / 形容词 / 副词 / 介词 / 动词短语 等 |
| `field` | array | ❌ | `[]` | 子领域，支持多值。如 `["代数拓扑", "代数几何"]` |
| `source` | string | ❌ | `""` | 来源参考书名称 |
| `examples` | array | ❌ | `[]` | 例句 `[{en, cn}, ...]` |
| `created_at` | string | ✅ | 当前时间 | ISO 日期 YYYY-MM-DD |
| `updated_at` | string | ✅ | 当前时间 | ISO 日期 YYYY-MM-DD |

## 别名处理

别名**不作为字段存储**。如果术语有别名：

- 别名展开为独立行：同一 `en`，`cn` 为别名，其余字段（pos/field/source/examples）与原术语一致
- term_id 规则：来源中首先出现、被选作主译名的记录用 `en` 小写，后续别名行加
  `__N` 后缀（如 `axiom of choice` 和 `axiom of choice__1`）
- 排序规则：先按 `en` 首字母，再按 `cn` 首字母，确保别名紧邻原术语

`term_id` 是稳定身份，不能用排序后的物理行号判断主译名。按 `cn` 排序后，无后缀
记录不保证位于同一 `en` 分组的第一行；调用方应显式查找无 `__N` 后缀的记录。

## 排序规则

```
en 首字母升序 → cn 首字母升序
```

所有写操作后自动执行此排序并重新连续分配 `idx`。

## 文件结构

所有输出文件存放在来源文件所在目录下的"术语库"文件夹中，扁平存放：

```
<来源文件所在目录>/
└── 术语库/
    ├── glossary.json                  ← 主术语库
    ├── glossary_backup_<时间戳>.json       ← 扩充流程手动触发备份
    ├── glossary_<YYYY-MM-DD>.xlsx     ← 自动导出的 Excel
    ├── 修改记录.md                     ← Web 界面写操作日志
    └── 扩充记录.md                     ← 批量扩充日志
```
