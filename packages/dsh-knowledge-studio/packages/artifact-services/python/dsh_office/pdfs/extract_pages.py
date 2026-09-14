from __future__ import annotations

from typing import Any

from .shared import (
    JsonArgumentParser,
    SkillError,
    atomic_write,
    copy_metadata,
    emit,
    parse_pages,
    path_result,
    project_path,
    project_root,
    reader_from,
    require_pypdf,
    run,
)


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Extract selected pages into a new PDF.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--pages", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    input_path = project_path(args.input, root, label="--input", must_exist=True, suffix=".pdf")
    output = project_path(args.output, root, label="--output", suffix=".pdf")
    if output == input_path:
        raise SkillError("output_is_input", "The output must not replace the input PDF.")

    pypdf = require_pypdf()
    reader = reader_from(pypdf, input_path)
    page_indexes = parse_pages(args.pages, total_pages=len(reader.pages))
    writer = pypdf.PdfWriter()
    copy_metadata(reader, writer)
    for page_index in page_indexes:
        writer.add_page(reader.pages[page_index])

    def write_pdf(temporary: Any) -> None:
        with temporary.open("wb") as handle:
            writer.write(handle)

    atomic_write(output, write_pdf, overwrite=args.overwrite)
    emit(
        {
            "ok": True,
            "operation": "extract_pages",
            **path_result(output, root),
            "source": input_path.relative_to(root).as_posix(),
            "source_page_count": len(reader.pages),
            "selected_pages": [index + 1 for index in page_indexes],
            "page_count": len(page_indexes),
            "visual_validation": False,
        }
    )
    return 0


if __name__ == "__main__":
    run("extract_pages", main)
