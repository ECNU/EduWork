from __future__ import annotations

from typing import Any

from .shared import (
    EXIT_DOCUMENT,
    JsonArgumentParser,
    SkillError,
    add_blocks,
    apply_properties,
    atomic_save,
    emit,
    iter_paragraphs,
    non_empty_text,
    optional_text,
    path_result,
    project_path,
    project_root,
    read_json_spec,
    reject_unknown,
    require_docx,
    run,
    validate_ooxml_archive,
)


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Edit a DOCX document using ordered JSON operations.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--spec-json")
    group.add_argument("--spec-file")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def run_has_rich_content(run: Any) -> bool:
    return any(child.tag.rsplit("}", 1)[-1] not in {"rPr", "t"} for child in run._r)


def replace_in_runs(document: Any, find: str, replacement: str) -> tuple[int, int, int]:
    replaced = 0
    cross_run_skipped = 0
    rich_content_skipped = 0
    for paragraph in iter_paragraphs(document):
        combined_matches = paragraph.text.count(find)
        run_matches = 0
        for run in paragraph.runs:
            count = run.text.count(find)
            if count:
                run_matches += count
                if run_has_rich_content(run):
                    rich_content_skipped += count
                    continue
                run.text = run.text.replace(find, replacement)
                replaced += count
        cross_run_skipped += max(0, combined_matches - run_matches)
    return replaced, cross_run_skipped, rich_content_skipped


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    input_path = project_path(args.input, root, label="--input", must_exist=True, suffix=".docx")
    validate_ooxml_archive(input_path)
    output = project_path(args.output, root, label="--output", suffix=".docx")
    spec = read_json_spec(inline=args.spec_json, file_path=args.spec_file, root=root)
    reject_unknown(spec, {"operations"}, label="edit specification")
    operations = spec.get("operations")
    if not isinstance(operations, list) or not operations:
        raise SkillError("invalid_spec", "The edit specification requires a non-empty operations array.")
    if len(operations) > 1_000:
        raise SkillError("too_many_operations", "operations must contain at most 1000 items.")
    docx = require_docx()
    try:
        document = docx.Document(str(input_path))
    except Exception as exc:
        raise SkillError(
            "document_read_failed",
            "The document could not be opened.",
            exit_code=EXIT_DOCUMENT,
            details={"path": str(input_path), "reason": str(exc)},
        ) from exc

    counts: dict[str, int] = {}
    replacements = 0
    cross_run_skipped = 0
    rich_content_skipped = 0
    appended_blocks = 0
    for index, operation in enumerate(operations, start=1):
        label = f"operations[{index}]"
        if not isinstance(operation, dict):
            raise SkillError("invalid_operation", f"{label} must be an object.")
        kind = operation.get("op")
        if not isinstance(kind, str):
            raise SkillError("invalid_operation", f"{label}.op must be a string.")
        if kind == "replace_text":
            reject_unknown(operation, {"op", "find", "replace"}, label=label)
            find = non_empty_text(operation.get("find"), label=f"{label}.find")
            replacement = optional_text(operation.get("replace"), label=f"{label}.replace")
            replaced, skipped, rich_skipped = replace_in_runs(document, find, replacement)
            replacements += replaced
            cross_run_skipped += skipped
            rich_content_skipped += rich_skipped
        elif kind == "set_properties":
            reject_unknown(operation, {"op", "properties"}, label=label)
            apply_properties(document, operation.get("properties"), label=f"{label}.properties")
        elif kind == "append_blocks":
            reject_unknown(operation, {"op", "blocks"}, label=label)
            block_counts = add_blocks(document, operation.get("blocks"), root=root, docx=docx, label=f"{label}.blocks")
            appended_blocks += sum(block_counts.values())
        else:
            raise SkillError(
                "unsupported_operation",
                f"{label}.op is not supported.",
                details={"op": kind, "supported": ["replace_text", "set_properties", "append_blocks"]},
            )
        counts[kind] = counts.get(kind, 0) + 1

    atomic_save(document, output, overwrite=args.overwrite)
    emit(
        {
            "ok": True,
            "operation": "edit",
            **path_result(output, root),
            "source": input_path.relative_to(root).as_posix(),
            "operations_applied": len(operations),
            "operation_counts": counts,
            "replacements": replacements,
            "cross_run_matches_skipped": cross_run_skipped,
            "rich_content_matches_skipped": rich_content_skipped,
            "blocks_appended": appended_blocks,
        }
    )
    return 0


if __name__ == "__main__":
    run("edit", main)
