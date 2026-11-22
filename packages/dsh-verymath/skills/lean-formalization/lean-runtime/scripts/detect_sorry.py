from __future__ import annotations

import re
from pathlib import Path
from typing import Any


FORBIDDEN_PATTERNS = {
    "sorry": re.compile(r"\bsorry\b"),
    "admit": re.compile(r"\badmit\b"),
    "axiom": re.compile(r"^\s*axiom\b"),
}


def _strip_line_comment(line: str) -> str:
    return line.split("--", 1)[0]


def scan_text(text: str, source: str = "<text>") -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        code = _strip_line_comment(line)
        for kind, pattern in FORBIDDEN_PATTERNS.items():
            if pattern.search(code):
                findings.append({
                    "kind": kind,
                    "file": source,
                    "line": line_no,
                    "text": line.rstrip(),
                })
    return {
        "ok": not findings,
        "status": "ok" if not findings else "forbidden_tokens_found",
        "findings": findings,
    }


def scan_file(path: str | Path) -> dict[str, Any]:
    file_path = Path(path).expanduser().resolve()
    if not file_path.exists():
        return {
            "ok": False,
            "status": "file_not_found",
            "findings": [],
            "errors": [{"severity": "error", "data": f"File not found: {file_path}"}],
        }
    result = scan_text(file_path.read_text(encoding="utf-8", errors="replace"), source=str(file_path))
    result["file"] = str(file_path)
    return result
