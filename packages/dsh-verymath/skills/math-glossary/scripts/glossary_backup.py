"""术语库备份工具。扩充流程触发时在 glossary.json 同目录生成只读副本。"""

from __future__ import annotations

import os
import shutil
from datetime import datetime
from pathlib import Path


def backup_glossary(glossary_path: str | os.PathLike[str]) -> str | None:
    """将 glossary.json 备份到同目录，文件名加时间戳前缀。

    Args:
        glossary_path: glossary.json 的绝对路径

    Returns:
        备份文件路径，如果源文件不存在则返回 None
    """
    source = Path(glossary_path).expanduser()
    if not source.is_file():
        return None

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S_%f")
    backup_name = f"glossary_backup_{timestamp}.json"
    backup_path = source.parent / backup_name

    shutil.copy2(source, backup_path)
    return str(backup_path)


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python3 glossary_backup.py <path/to/glossary.json>")
        sys.exit(1)

    result = backup_glossary(sys.argv[1])
    if result:
        print(f"Backed up to: {result}")
    else:
        print("No glossary.json found, skipping backup.")
