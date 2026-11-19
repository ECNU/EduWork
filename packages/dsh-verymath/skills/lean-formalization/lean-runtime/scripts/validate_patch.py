from __future__ import annotations

import difflib
import re
from pathlib import Path
from typing import Any

from detect_sorry import scan_text


DECL_RE = re.compile(r"^\s*(theorem|lemma|def|class|structure|inductive)\s+([A-Za-z_][\w'.]*)\b(.*)")


def collect_declarations(text: str) -> dict[str, str]:
    declarations: dict[str, str] = {}
    for line in text.splitlines():
        match = DECL_RE.match(line)
        if not match:
            continue
        kind, name, rest = match.groups()
        header = f"{kind} {name} {rest}".split(":=", 1)[0].strip()
        declarations[name] = re.sub(r"\s+", " ", header)
    return declarations


def review_patch(before_text: str, after_text: str, allow_statement_changes: bool = False) -> dict[str, Any]:
    after_scan = scan_text(after_text, source="after")
    before_decls = collect_declarations(before_text)
    after_decls = collect_declarations(after_text)
    statement_changes = []
    for name, before_header in before_decls.items():
        after_header = after_decls.get(name)
        if after_header and before_header != after_header:
            statement_changes.append({
                "declaration": name,
                "before": before_header,
                "after": after_header,
            })

    findings: list[dict[str, Any]] = []
    findings.extend(after_scan.get("findings", []))
    if statement_changes and not allow_statement_changes:
        findings.append({
            "kind": "statement_changed",
            "changes": statement_changes,
        })

    return {
        "ok": not findings,
        "status": "ok" if not findings else "patch_safety_violation",
        "forbidden_findings": after_scan.get("findings", []),
        "statement_changes": statement_changes,
        "diff": "\n".join(difflib.unified_diff(
            before_text.splitlines(),
            after_text.splitlines(),
            fromfile="before",
            tofile="after",
            lineterm="",
        )),
        "findings": findings,
    }


def review_files(before: str | Path, after: str | Path, allow_statement_changes: bool = False) -> dict[str, Any]:
    before_path = Path(before).expanduser().resolve()
    after_path = Path(after).expanduser().resolve()
    if not before_path.exists() or not after_path.exists():
        missing = [str(path) for path in (before_path, after_path) if not path.exists()]
        return {
            "ok": False,
            "status": "file_not_found",
            "errors": [{"severity": "error", "data": f"Missing files: {', '.join(missing)}"}],
        }
    result = review_patch(
        before_path.read_text(encoding="utf-8", errors="replace"),
        after_path.read_text(encoding="utf-8", errors="replace"),
        allow_statement_changes=allow_statement_changes,
    )
    result["before"] = str(before_path)
    result["after"] = str(after_path)
    return result
