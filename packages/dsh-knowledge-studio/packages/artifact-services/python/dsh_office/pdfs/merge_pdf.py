from __future__ import annotations

from typing import Any

from .shared import (
    MAX_PAGES,
    MAX_PDF_BYTES,
    JsonArgumentParser,
    SkillError,
    atomic_write,
    copy_metadata,
    emit,
    path_result,
    project_path,
    project_root,
    reader_from,
    require_pypdf,
    run,
)

MAX_MERGE_INPUTS = 50


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Merge PDF files in the order supplied.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--input", action="append", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    if len(args.input) < 2:
        raise SkillError("invalid_arguments", "Provide at least two --input PDF files.")
    if len(args.input) > MAX_MERGE_INPUTS:
        raise SkillError("too_many_inputs", f"Provide at most {MAX_MERGE_INPUTS} input PDF files.")
    inputs = [
        project_path(raw, root, label=f"--input[{index}]", must_exist=True, suffix=".pdf")
        for index, raw in enumerate(args.input, start=1)
    ]
    if len({str(path).casefold() for path in inputs}) != len(inputs):
        raise SkillError("duplicate_input", "The same PDF input must not be supplied more than once.")
    total_input_bytes = sum(path.stat().st_size for path in inputs)
    if total_input_bytes > MAX_PDF_BYTES:
        raise SkillError(
            "inputs_too_large",
            "The combined input PDFs exceed the managed size limit.",
            details={"size_bytes": total_input_bytes, "max_bytes": MAX_PDF_BYTES},
        )
    output = project_path(args.output, root, label="--output", suffix=".pdf")
    if any(output == path for path in inputs):
        raise SkillError("output_is_input", "The output must not replace an input PDF.")

    pypdf = require_pypdf()
    readers = [reader_from(pypdf, path) for path in inputs]
    total_pages = sum(len(reader.pages) for reader in readers)
    if total_pages > MAX_PAGES:
        raise SkillError(
            "too_many_pages",
            "The merged PDF would exceed the managed page limit.",
            details={"page_count": total_pages, "max_pages": MAX_PAGES},
        )
    writer = pypdf.PdfWriter()
    page_counts: list[int] = []
    for reader in readers:
        page_counts.append(len(reader.pages))
        for page in reader.pages:
            writer.add_page(page)
    if readers:
        copy_metadata(readers[0], writer)

    def write_pdf(temporary: Any) -> None:
        with temporary.open("wb") as handle:
            writer.write(handle)

    atomic_write(output, write_pdf, overwrite=args.overwrite)
    emit(
        {
            "ok": True,
            "operation": "merge",
            **path_result(output, root),
            "inputs": [path.relative_to(root).as_posix() for path in inputs],
            "input_page_counts": page_counts,
            "page_count": total_pages,
            "visual_validation": False,
        }
    )
    return 0


if __name__ == "__main__":
    run("merge", main)
