from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from check_lean_project import check_project, find_project_root, read_mathlib_revision, read_toolchain  # noqa: E402


class CheckLeanProjectTests(unittest.TestCase):
    def test_finds_project_root_and_versions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = (Path(tmp) / "proj").resolve()
            nested = root / "A" / "B"
            nested.mkdir(parents=True)
            (root / "lean-toolchain").write_text("leanprover/lean4:v4.26.0\n", encoding="utf-8")
            (root / "lakefile.toml").write_text(
                'name = "proj"\n\n[[require]]\nname = "mathlib"\nscope = "leanprover-community"\nrev = "v4.26.0"\n',
                encoding="utf-8",
            )
            target = nested / "T.lean"
            target.write_text("example : True := by trivial\n", encoding="utf-8")

            self.assertEqual(find_project_root(target), root)
            self.assertEqual(read_toolchain(root), "leanprover/lean4:v4.26.0")
            self.assertEqual(read_mathlib_revision(root), "v4.26.0")

            result = check_project(root, skip_build=True)
            self.assertTrue(result["ok"])
            self.assertEqual(result["status"], "ok_skip_build")

    def test_build_uses_discovered_lake_binary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "lean-toolchain").write_text("leanprover/lean4:v4.28.0\n", encoding="utf-8")
            (root / "lakefile.toml").write_text('name = "proj"\n', encoding="utf-8")

            with patch("check_lean_project.find_tool", return_value="/custom/bin/lake"), \
                patch("check_lean_project.run_command", return_value={
                    "ok": True,
                    "returncode": 0,
                    "stdout": "",
                    "stderr": "",
                    "command": ["/custom/bin/lake", "build"],
                }) as run:
                result = check_project(root)

            self.assertTrue(result["ok"])
            run.assert_called_once()
            self.assertEqual(run.call_args.args[0], ["/custom/bin/lake", "build"])


if __name__ == "__main__":
    unittest.main()
