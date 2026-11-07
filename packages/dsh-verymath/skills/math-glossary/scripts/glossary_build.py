"""从结构化数据构建符合 math-glossary 合同的 glossary.json。

本脚本只负责 CSV/TSV、JSON 和 YAML。PDF、OCR、MDX 与自由文本仍由
``SKILL.md`` 中的 agent workflow 解析和人工复核。
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


COLUMN_ALIASES = {
    "term_id": ("term_id", "termid", "术语id"),
    "en": ("en", "english", "term", "word", "keyword", "name", "英文", "术语"),
    "cn": (
        "cn",
        "chinese",
        "translation",
        "definition",
        "译名",
        "中文",
        "翻译",
    ),
    "pos": ("pos", "part_of_speech", "词性"),
    "field": ("field", "domain", "discipline", "领域", "子领域", "学科"),
    "source": ("source", "来源"),
    "examples": ("examples", "例句", "示例"),
    "created_at": ("created_at", "创建时间"),
    "updated_at": ("updated_at", "更新时间"),
}
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class GlossaryBuildError(ValueError):
    """Raised when structured source data cannot satisfy the glossary contract."""


def _normalize_header(value: str) -> str:
    return re.sub(r"[\s_-]+", "", value.strip().casefold())


def _decode_text(path: Path) -> str:
    raw = path.read_bytes()
    errors = []
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError as exc:
            errors.append(f"{encoding}: {exc}")
    raise GlossaryBuildError(
        f"无法解码 {path.name}；已尝试 UTF-8/UTF-8 BOM/GB18030。"
    ) from errors[-1]


def _detect_columns(
    fieldnames: list[str],
    explicit_en: str | None,
    explicit_cn: str | None,
) -> dict[str, str]:
    normalized = {
        _normalize_header(name): name
        for name in fieldnames
        if name is not None
    }
    result: dict[str, str] = {}
    explicit = {"en": explicit_en, "cn": explicit_cn}
    for canonical, aliases in COLUMN_ALIASES.items():
        selected = explicit.get(canonical)
        if selected:
            key = _normalize_header(selected)
            if key not in normalized:
                raise GlossaryBuildError(
                    f"找不到显式指定的 {canonical} 列: {selected}"
                )
            result[canonical] = normalized[key]
            continue
        for alias in aliases:
            match = normalized.get(_normalize_header(alias))
            if match is not None:
                result[canonical] = match
                break
    missing = [field for field in ("en", "cn") if field not in result]
    if missing:
        raise GlossaryBuildError(
            "无法识别必需列 "
            + ", ".join(missing)
            + f"；现有列为: {', '.join(fieldnames)}"
        )
    return result


def _records_from_csv(
    path: Path,
    *,
    en_column: str | None,
    cn_column: str | None,
) -> list[tuple[dict[str, Any], str]]:
    text = _decode_text(path)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",\t;")
    except csv.Error:
        dialect = csv.excel_tab if path.suffix.lower() == ".tsv" else csv.excel
    reader = csv.DictReader(text.splitlines(), dialect=dialect)
    if not reader.fieldnames:
        raise GlossaryBuildError(f"{path.name} 缺少表头")
    columns = _detect_columns(reader.fieldnames, en_column, cn_column)
    records = []
    for row in reader:
        if not row or not any(str(value or "").strip() for value in row.values()):
            continue
        canonical = {
            field: row.get(column)
            for field, column in columns.items()
        }
        records.append((canonical, f"{path.name}:line {reader.line_num}"))
    return records


def _load_json_or_yaml(path: Path) -> Any:
    text = _decode_text(path)
    if path.suffix.lower() == ".json":
        return json.loads(text)
    try:
        import yaml
    except ImportError as exc:
        raise ImportError(
            "YAML 输入需要 PyYAML；请先审阅并安装 requirements.txt。"
        ) from exc
    return yaml.safe_load(text)


def _records_from_object(
    data: Any,
    path: Path,
) -> list[tuple[dict[str, Any], str]]:
    if isinstance(data, dict) and isinstance(data.get("terms"), list):
        data = data["terms"]
    if isinstance(data, list):
        records = data
    elif isinstance(data, dict):
        records = []
        for english, translation in data.items():
            if isinstance(translation, dict):
                record = dict(translation)
                record.setdefault("en", english)
            else:
                record = {"en": english, "cn": translation}
            records.append(record)
    else:
        raise GlossaryBuildError(
            f"{path.name} 顶层必须是对象数组、terms 数组或 en→cn 对象"
        )

    output = []
    for index, record in enumerate(records, 1):
        if not isinstance(record, dict):
            raise GlossaryBuildError(
                f"{path.name}:record {index} 必须是对象"
            )
        output.append((record, f"{path.name}:record {index}"))
    return output


def read_structured_source(
    source_path: str | os.PathLike[str],
    *,
    en_column: str | None = None,
    cn_column: str | None = None,
) -> list[tuple[dict[str, Any], str]]:
    path = Path(source_path).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"{path} 不存在或不是文件")
    suffix = path.suffix.lower()
    if suffix in {".csv", ".tsv"}:
        return _records_from_csv(
            path,
            en_column=en_column,
            cn_column=cn_column,
        )
    if suffix in {".json", ".yaml", ".yml"}:
        return _records_from_object(_load_json_or_yaml(path), path)
    raise GlossaryBuildError(
        f"结构化建库 CLI 不支持 {suffix or '无扩展名'}；"
        "当前仅支持 CSV/TSV/JSON/YAML。"
    )


def _record_value(record: dict[str, Any], field: str) -> Any:
    normalized = {
        _normalize_header(str(key)): value
        for key, value in record.items()
    }
    for alias in COLUMN_ALIASES[field]:
        key = _normalize_header(alias)
        if key in normalized:
            return normalized[key]
    return None


def _field_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        raw_items: Iterable[Any] = value
    else:
        raw_items = re.split(r"[/;,，；]", str(value))
    seen = set()
    output = []
    for item in raw_items:
        text = str(item).strip()
        if text and text not in seen:
            seen.add(text)
            output.append(text)
    return output


def _examples(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    output = []
    for example in value:
        if not isinstance(example, dict):
            continue
        english = str(example.get("en", "")).strip()
        chinese = str(example.get("cn", "")).strip()
        if english or chinese:
            output.append({"en": english, "cn": chinese})
    return output


def _trace_source(
    location: str,
    record_source: Any,
    source_label: str | None,
) -> str:
    parts = []
    for value in (source_label, record_source):
        text = str(value or "").strip()
        if text and text not in parts:
            parts.append(text)
    parts.append(location)
    return "; ".join(parts)


def build_terms(
    records: list[tuple[dict[str, Any], str]],
    *,
    source_label: str | None = None,
) -> list[dict[str, Any]]:
    today = datetime.now().strftime("%Y-%m-%d")
    occurrences: dict[str, int] = {}
    seen_pairs: set[tuple[str, str]] = set()
    used_term_ids: set[str] = set()
    terms = []

    for record, location in records:
        english = str(_record_value(record, "en") or "").strip()
        chinese = str(_record_value(record, "cn") or "").strip()
        if not english or not chinese:
            raise GlossaryBuildError(
                f"{location} 缺少非空英文术语或中文译名"
            )
        pair = (english.casefold(), chinese)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)

        base_id = english.casefold()
        provided_id = str(_record_value(record, "term_id") or "").strip()
        if provided_id:
            normalized_id = provided_id.casefold()
            if normalized_id in used_term_ids:
                raise GlossaryBuildError(
                    f"{location} 的 term_id 与已有记录重复: {provided_id}"
                )
            term_id = provided_id
            used_term_ids.add(normalized_id)
            if normalized_id == base_id:
                occurrences[base_id] = max(
                    occurrences.get(base_id, 0),
                    1,
                )
            else:
                suffix = re.fullmatch(
                    re.escape(base_id) + r"__(\d+)",
                    normalized_id,
                )
                if suffix:
                    occurrences[base_id] = max(
                        occurrences.get(base_id, 0),
                        int(suffix.group(1)) + 1,
                    )
        else:
            occurrence = occurrences.get(base_id, 0)
            while True:
                candidate = (
                    base_id
                    if occurrence == 0
                    else f"{base_id}__{occurrence}"
                )
                if candidate.casefold() not in used_term_ids:
                    term_id = candidate
                    break
                occurrence += 1
            occurrences[base_id] = occurrence + 1
            used_term_ids.add(term_id.casefold())

        created_at = str(_record_value(record, "created_at") or today).strip()
        updated_at = str(_record_value(record, "updated_at") or today).strip()
        if not DATE_PATTERN.fullmatch(created_at):
            created_at = today
        if not DATE_PATTERN.fullmatch(updated_at):
            updated_at = today

        terms.append({
            "term_id": term_id,
            "en": english,
            "cn": chinese,
            "pos": str(_record_value(record, "pos") or "").strip(),
            "field": _field_list(_record_value(record, "field")),
            "source": _trace_source(
                location,
                _record_value(record, "source"),
                source_label,
            ),
            "examples": _examples(_record_value(record, "examples")),
            "created_at": created_at,
            "updated_at": updated_at,
        })

    terms.sort(
        key=lambda term: (
            term["en"].casefold(),
            term["cn"].casefold(),
        )
    )
    for index, term in enumerate(terms, 1):
        term["idx"] = index
    return terms


def _atomic_json_dump(terms: list[dict[str, Any]], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.name}.",
        suffix=".tmp",
        dir=output.parent,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(terms, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, output)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def _load_export_function():
    export_path = Path(__file__).resolve().with_name("glossary_export.py")
    spec = importlib.util.spec_from_file_location(
        "math_glossary_export",
        export_path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载导出脚本: {export_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.export_to_excel


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="从 CSV/TSV/JSON/YAML 构建 glossary.json。"
    )
    parser.add_argument("source", help="结构化来源文件")
    parser.add_argument(
        "--output",
        help="输出 JSON；默认 <来源目录>/术语库/glossary.json",
    )
    parser.add_argument("--en-column", help="显式指定英文列名")
    parser.add_argument("--cn-column", help="显式指定中文列名")
    parser.add_argument(
        "--source-label",
        help="附加书名、项目名等来源标签",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="允许覆盖已存在的输出 JSON；覆盖前仍建议先备份",
    )
    parser.add_argument(
        "--no-excel",
        action="store_true",
        help="只生成 JSON，不尝试导出 Excel",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    source = Path(args.source).expanduser().resolve()
    output = (
        Path(args.output).expanduser().resolve()
        if args.output
        else source.parent / "术语库" / "glossary.json"
    )
    if output.exists() and not args.force:
        print(f"错误：{output} 已存在；请先备份，并显式添加 --force。")
        return 2

    try:
        records = read_structured_source(
            source,
            en_column=args.en_column,
            cn_column=args.cn_column,
        )
        terms = build_terms(records, source_label=args.source_label)
        if not terms:
            raise GlossaryBuildError("来源文件没有可用术语")
        _atomic_json_dump(terms, output)
    except (
        FileNotFoundError,
        GlossaryBuildError,
        ImportError,
        json.JSONDecodeError,
        OSError,
    ) as exc:
        print(f"错误：{exc}")
        return 2

    print(f"JSON 已完成：{output}（{len(terms)} 条）")
    if args.no_excel:
        print("按 --no-excel 要求跳过 Excel；本次状态为 JSON 完成。")
        return 0

    try:
        export_to_excel = _load_export_function()
        exported = Path(export_to_excel(output, output.parent)).resolve()
    except (ImportError, OSError, ValueError) as exc:
        print(f"Excel 待完成：{exc}")
        print("JSON 已安全保留；不得把本次状态表述为完整导出完成。")
        return 3

    for candidate in output.parent.glob("glossary_*.xlsx"):
        if candidate.resolve() != exported:
            candidate.unlink()
    print(f"Excel 已完成：{exported}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
