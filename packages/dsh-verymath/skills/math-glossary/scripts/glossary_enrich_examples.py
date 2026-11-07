"""为 glossary.json 中缺少 examples 的术语批量生成中英文例句。

AI 补全是显式可选能力。脚本不提供固定代理、模型或占位密钥；调用者必须通过
命令行参数或环境变量配置 OpenAI-compatible client。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any


def _load_terms(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        terms = json.load(handle)
    if not isinstance(terms, list):
        raise ValueError("glossary.json 顶层必须是术语对象数组")
    for index, term in enumerate(terms, 1):
        if not isinstance(term, dict):
            raise ValueError(f"第 {index} 条术语必须是 JSON 对象")
        if not term.get("term_id") or not term.get("en") or not term.get("cn"):
            raise ValueError(
                f"第 {index} 条术语必须包含非空 term_id、en 和 cn"
            )
    return terms


def _atomic_json_dump(terms: list[dict[str, Any]], path: Path) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(terms, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def _build_prompt(terms_batch: list[dict[str, Any]]) -> str:
    term_lines = []
    for term in terms_batch:
        field_hint = ""
        if term.get("field"):
            field = term["field"]
            if isinstance(field, list):
                field = " / ".join(str(item) for item in field)
            field_hint = f"，所属子领域：{field}"
        term_lines.append(
            f"- {term['en']} → {term['cn']}（{term.get('pos', '')}）"
            f"{field_hint}"
        )

    return f"""请为以下数学术语分别生成一个中英文对照的例句。

术语列表：
{chr(10).join(term_lines)}

要求：
1. 每个术语生成一个英文例句和一个中文翻译
2. 例句应体现该术语在数学文献中的典型用法，自然、简练
3. 中文翻译应为地道的中文学术表达
4. 严格按以下 JSON 格式输出，只输出 JSON，不要其它文字，不要用代码围栏包裹：

{{"results": [
  {{"en": "英文术语", "example_en": "英文例句", "example_cn": "中文例句"}},
  ...
]}}

共 {len(terms_batch)} 条术语，每条必须都有例句。"""


def call_examples_batch(
    terms_batch: list[dict[str, Any]],
    client: Any,
    model: str,
) -> dict[str, Any]:
    """通过已配置的 OpenAI-compatible client 生成一批例句。"""
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": _build_prompt(terms_batch)}],
        temperature=0.3,
        max_tokens=4096,
    )
    text = (response.choices[0].message.content or "").strip()
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0].strip()
    result = json.loads(text)
    if not isinstance(result, dict) or not isinstance(result.get("results"), list):
        raise ValueError("模型返回结果缺少 results 数组")
    return result


def _build_client(api_key: str, api_base: str | None):
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise ImportError(
            "例句补全需要可选依赖 openai；请先审阅并安装 requirements-ai.txt。"
        ) from exc
    kwargs = {"api_key": api_key}
    if api_base:
        kwargs["base_url"] = api_base
    return OpenAI(**kwargs)


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


def _refresh_excel(glossary_path: Path) -> Path:
    export_to_excel = _load_export_function()
    exported = Path(export_to_excel(glossary_path, glossary_path.parent))
    for candidate in glossary_path.parent.glob("glossary_*.xlsx"):
        if candidate.resolve() != exported.resolve():
            candidate.unlink()
            print(f"已删除旧 Excel: {candidate.name}")
    return exported


def enrich_glossary(
    glossary_path: str | os.PathLike[str],
    *,
    api_key: str,
    model: str,
    api_base: str | None = None,
    batch_size: int = 20,
    export_excel: bool = True,
    delay_seconds: float = 1.0,
    client: Any | None = None,
) -> tuple[int, int]:
    """补全例句并返回 ``(updated, missing_before)``。"""
    if batch_size < 1:
        raise ValueError("batch_size 必须大于 0")

    path = Path(glossary_path).expanduser().resolve()
    terms = _load_terms(path)
    missing = [
        term
        for term in terms
        if not term.get("examples")
    ]
    print(f"总计 {len(terms)} 条，缺例句 {len(missing)} 条")
    if not missing:
        print("所有术语都已有例句。")
        return 0, 0

    if not api_key:
        raise ValueError("必须通过 --api-key 或 MATH_GLOSSARY_API_KEY 提供密钥")
    if not model:
        raise ValueError("必须通过 --model 或 MATH_GLOSSARY_MODEL 提供模型名")

    configured_client = client or _build_client(api_key, api_base)
    updated = 0
    for offset in range(0, len(missing), batch_size):
        batch = missing[offset : offset + batch_size]
        batch_number = offset // batch_size + 1
        total_batches = (len(missing) + batch_size - 1) // batch_size
        print(
            f"批次 {batch_number}/{total_batches}："
            f"处理 {batch[0]['en']} ... {batch[-1]['en']}"
        )
        try:
            result = call_examples_batch(batch, configured_client, model)
        except Exception as exc:
            print(f"  错误：{exc}")
            print("  跳过此批，继续下一批。")
            continue

        result_map = {
            str(item.get("en", "")).strip(): item
            for item in result["results"]
            if isinstance(item, dict)
        }
        for term in batch:
            generated = result_map.get(term["en"])
            if not generated:
                print(f"  未匹配：{term['en']}")
                continue
            example_en = str(generated.get("example_en", "")).strip()
            example_cn = str(generated.get("example_cn", "")).strip()
            if not example_en or not example_cn:
                print(f"  返回例句不完整：{term['en']}")
                continue
            term["examples"] = [{"en": example_en, "cn": example_cn}]
            term["updated_at"] = time.strftime("%Y-%m-%d")
            updated += 1
            print(f"  已更新：{term['en']}")

        if offset + batch_size < len(missing) and delay_seconds > 0:
            time.sleep(delay_seconds)

    terms.sort(
        key=lambda term: (
            term.get("en", "").lower(),
            term.get("cn", "").lower(),
        )
    )
    for index, term in enumerate(terms, 1):
        term["idx"] = index
    _atomic_json_dump(terms, path)

    if export_excel:
        exported = _refresh_excel(path)
        print(f"已导出 Excel: {exported}")
    print(f"更新了 {updated}/{len(missing)} 条术语的例句")
    return updated, len(missing)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="通过显式配置的 OpenAI-compatible API 补全术语例句。"
    )
    parser.add_argument("glossary", help="glossary.json 路径")
    parser.add_argument(
        "--api-key",
        default=os.environ.get("MATH_GLOSSARY_API_KEY"),
        help="API 密钥；也可用 MATH_GLOSSARY_API_KEY",
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get("MATH_GLOSSARY_API_BASE"),
        help="可选 endpoint；也可用 MATH_GLOSSARY_API_BASE",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("MATH_GLOSSARY_MODEL"),
        help="模型名；也可用 MATH_GLOSSARY_MODEL",
    )
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument(
        "--no-export",
        action="store_true",
        help="更新 JSON 后不导出 Excel",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        enrich_glossary(
            args.glossary,
            api_key=args.api_key or "",
            api_base=args.api_base,
            model=args.model or "",
            batch_size=args.batch_size,
            export_excel=not args.no_export,
        )
    except (ImportError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"错误：{exc}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
