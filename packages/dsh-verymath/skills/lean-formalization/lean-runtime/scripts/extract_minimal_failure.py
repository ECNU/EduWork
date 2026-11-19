from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from check_lean_project import check_file
from detect_sorry import scan_text


DECL_START_RE = re.compile(r"^\s*(theorem|lemma|def|example|instance)\s+")


def _line_window(lines: list[str], center: int, radius: int = 8) -> tuple[int, int, str]:
    start = max(1, center - radius)
    end = min(len(lines), center + radius)
    snippet = "\n".join(lines[start - 1:end])
    return start, end, snippet


def _target_block(lines: list[str], target: str) -> tuple[int, int, str] | None:
    start_index = None
    for index, line in enumerate(lines):
        if re.search(rf"\b{re.escape(target)}\b", line) and DECL_START_RE.search(line):
            start_index = index
            break
    if start_index is None:
        return None
    end_index = len(lines)
    for index in range(start_index + 1, len(lines)):
        if DECL_START_RE.search(lines[index]):
            end_index = index
            break
    return start_index + 1, end_index, "\n".join(lines[start_index:end_index])


def extract(file: str | Path, target: str | None = None, run_lean: bool = False, timeout: int = 120) -> dict[str, Any]:
    file_path = Path(file).expanduser().resolve()
    if not file_path.exists():
        return {
            "ok": False,
            "status": "file_not_found",
            "minimal_failure": {},
            "errors": [{"severity": "error", "data": f"File not found: {file_path}"}],
        }
    text = file_path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    block = _target_block(lines, target) if target else None
    if block is None:
        scan = scan_text(text, source=str(file_path))
        if scan.get("findings"):
            first = scan["findings"][0]
            block = _line_window(lines, int(first["line"]))
        else:
            block = (1, min(len(lines), 40), "\n".join(lines[:40]))

    lean_result = check_file(file_path, timeout=timeout) if run_lean else None
    start, end, snippet = block
    status = "minimal_failure_extracted"
    ok = True
    if lean_result and not lean_result.get("ok"):
        status = "lean_failure_minimized"
    return {
        "ok": ok,
        "status": status,
        "file": str(file_path),
        "target": target,
        "minimal_failure": {
            "start_line": start,
            "end_line": end,
            "snippet": snippet,
            "lean": lean_result,
        },
    }
