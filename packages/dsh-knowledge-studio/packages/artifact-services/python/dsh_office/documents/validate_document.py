from __future__ import annotations

import xml.etree.ElementTree as ET
import zipfile
from typing import Any

from .shared import (
    EXIT_VALIDATION,
    JsonArgumentParser,
    emit,
    path_result,
    project_path,
    project_root,
    require_docx,
    run,
    validate_ooxml_archive,
)


REQUIRED_PARTS = {"[Content_Types].xml", "_rels/.rels", "word/document.xml"}


def parse_args() -> Any:
    parser = JsonArgumentParser(description="Validate the OOXML structure of a DOCX document.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--input", required=True)
    return parser.parse_args()


def invalid_result(input_path: Any, root: Any, issues: list[dict[str, Any]]) -> int:
    emit(
        {
            "ok": False,
            "operation": "validate",
            "valid": False,
            **path_result(input_path, root),
            "issues": issues,
        }
    )
    return EXIT_VALIDATION


def main() -> int:
    args = parse_args()
    root = project_root(args.project_root)
    input_path = project_path(args.input, root, label="--input", must_exist=True, suffix=".docx")
    validate_ooxml_archive(input_path)
    docx = require_docx()
    issues: list[dict[str, Any]] = []
    if not zipfile.is_zipfile(input_path):
        return invalid_result(
            input_path,
            root,
            [{"severity": "error", "code": "invalid_docx_container", "message": "The file is not a valid DOCX ZIP container."}],
        )
    external_relationships = 0
    try:
        with zipfile.ZipFile(input_path) as archive:
            names = set(archive.namelist())
            for part in sorted(REQUIRED_PARTS - names):
                issues.append(
                    {"severity": "error", "code": "missing_required_part", "message": "A required OOXML part is missing.", "part": part}
                )
            for name in names:
                if name.endswith(".xml") or name.endswith(".rels"):
                    try:
                        root_element = ET.fromstring(archive.read(name))
                    except (ET.ParseError, OSError, KeyError) as exc:
                        issues.append(
                            {"severity": "error", "code": "invalid_xml_part", "message": "An OOXML XML part could not be parsed.", "part": name, "reason": str(exc)}
                        )
                        if len(issues) >= 100:
                            break
                    else:
                        if name.endswith(".rels"):
                            for relationship in root_element:
                                if relationship.attrib.get("TargetMode") == "External":
                                    external_relationships += 1
    except (OSError, zipfile.BadZipFile) as exc:
        return invalid_result(
            input_path,
            root,
            [{"severity": "error", "code": "container_read_failed", "message": "The DOCX container could not be read.", "reason": str(exc)}],
        )

    paragraph_count = 0
    table_count = 0
    inline_image_count = 0
    if not any(issue["severity"] == "error" for issue in issues):
        try:
            document = docx.Document(str(input_path))
            paragraph_count = len(document.paragraphs)
            table_count = len(document.tables)
            inline_image_count = len(document.inline_shapes)
        except Exception as exc:
            issues.append(
                {"severity": "error", "code": "document_parse_failed", "message": "python-docx could not parse the document.", "reason": str(exc)}
            )
    if paragraph_count == 0 and table_count == 0:
        issues.append({"severity": "warning", "code": "empty_document", "message": "The document has no body paragraphs or tables."})
    if external_relationships:
        issues.append(
            {
                "severity": "warning",
                "code": "external_relationships",
                "message": "The document contains external relationships; they were not opened or validated.",
                "count": external_relationships,
            }
        )
    issues.append(
        {
            "severity": "info",
            "code": "visual_render_not_checked",
            "message": "OOXML structure was checked, but Word/WPS visual rendering was not performed.",
        }
    )
    valid = not any(issue["severity"] == "error" for issue in issues)
    emit(
        {
            "ok": valid,
            "operation": "validate",
            "valid": valid,
            **path_result(input_path, root),
            "summary": {
                "paragraph_count": paragraph_count,
                "table_count": table_count,
                "inline_image_count": inline_image_count,
                "external_relationship_count": external_relationships,
            },
            "issues": issues,
        }
    )
    return 0 if valid else EXIT_VALIDATION


if __name__ == "__main__":
    run("validate", main)
