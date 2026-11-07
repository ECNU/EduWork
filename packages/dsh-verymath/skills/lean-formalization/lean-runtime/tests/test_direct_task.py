from __future__ import annotations

import sys
import tempfile
import unittest
import os
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from direct_task import build_direct_task, run_direct_task  # noqa: E402


class DirectTaskTests(unittest.TestCase):
    def test_managed_workspace_routes_standalone_file_to_coding_agent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workspace = root / ".ai4math" / "lean-workspace"
            workspace.mkdir(parents=True)
            (workspace / "lean-toolchain").write_text("leanprover/lean4:v4.28.0\n", encoding="utf-8")
            (workspace / "lakefile.toml").write_text('name = "lean_workspace"\n', encoding="utf-8")
            target = root / "Standalone.lean"
            target.write_text("example : True := by trivial\n", encoding="utf-8")

            with patch.dict(os.environ, {"AI4MATH_LEAN_WORKSPACE": str(workspace)}, clear=False):
                result = build_direct_task("prove", root, target)

            self.assertTrue(result["ok"])
            self.assertEqual(result["status"], "coding_agent_task_ready")
            self.assertEqual(result["agent_mode"], "coding-agent")
            self.assertEqual(result["backend"], "none")
            self.assertEqual(result["workspace_mode"], "managed_workspace")
            self.assertEqual(result["missing_config"], [])

    def test_missing_workspace_reports_required_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "Standalone.lean"
            target.write_text("example : True := by trivial\n", encoding="utf-8")

            with patch.dict(os.environ, {"AI4MATH_HOME": str(root / "shared-ai4math"), "AI4MATH_LEAN_WORKSPACE": ""}, clear=False):
                result = build_direct_task("prove", root, target)

            self.assertFalse(result["ok"])
            self.assertEqual(result["status"], "missing_config")
            self.assertIn("lean_workspace", result["missing_config"])
            self.assertEqual(result["backend"], "none")

    def test_dry_run_marks_ready_task_without_external_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "lean-toolchain").write_text("leanprover/lean4:v4.28.0\n", encoding="utf-8")
            (root / "lakefile.toml").write_text('name = "proj"\n', encoding="utf-8")
            target = root / "Main.lean"
            target.write_text("example : True := by trivial\n", encoding="utf-8")

            result = run_direct_task("repair", root, target, dry_run=True)

            self.assertTrue(result["ok"])
            self.assertEqual(result["status"], "dry_run")
            self.assertEqual(result["backend"], "none")
            self.assertIn("direct_workflow", result)
            self.assertNotIn("command", result)


if __name__ == "__main__":
    unittest.main()
