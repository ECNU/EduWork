from __future__ import annotations

import sys
import tempfile
import unittest
import os
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from common import CANONICAL_LEAN_TOOLCHAIN, load_toml  # noqa: E402
from configure_lean import configure, inspect_environment  # noqa: E402


class ConfigureLeanTests(unittest.TestCase):
    def test_existing_lean_project_is_coding_agent_ready(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "Main.lean"
            (root / "lean-toolchain").write_text("leanprover/lean4:v4.28.0\n", encoding="utf-8")
            (root / "lakefile.toml").write_text('name = "proj"\n', encoding="utf-8")
            target.write_text("example : True := by trivial\n", encoding="utf-8")

            with patch.dict(os.environ, {"AI4MATH_HOME": str(root / "shared-ai4math")}, clear=False):
                os.environ["AI4MATH_LEAN_WORKSPACE"] = ""
                result = inspect_environment(root, target=target)

            self.assertTrue(result["ok"])
            self.assertEqual(result["agent"]["mode"], "coding-agent")
            self.assertEqual(result["agent"]["backend"], "none")
            self.assertFalse(result["agent"]["numina_required"])
            self.assertEqual(result["agent"]["numina_runtime"], "built_in_recipe")
            self.assertEqual(result["missing_config"], [])
            self.assertIn("numina", result)
            self.assertIn("readiness", result["numina"])

    def test_save_local_writes_lean_agent_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            with patch.dict(os.environ, {"AI4MATH_HOME": str(root / "shared-ai4math")}, clear=False):
                os.environ["AI4MATH_LEAN_WORKSPACE"] = ""
                result = configure(root, save_local=True, toolchain="leanprover/lean4:v4.28.0")
            local = load_toml(root / ".ai4math" / "lean_agent.local.toml")

            self.assertFalse(result["ok"])
            self.assertEqual(result["status"], "missing_config")
            self.assertEqual(local["agent"]["backend"], "none")
            self.assertEqual(local["agent"]["mode"], "coding-agent")
            self.assertEqual(local["lean"]["preferred_toolchain"], "leanprover/lean4:v4.28.0")
            self.assertIn("lean_agent.local.toml", (root / ".ai4math" / ".gitignore").read_text())

    def test_save_local_defaults_to_canonical_toolchain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            with patch.dict(os.environ, {"AI4MATH_HOME": str(root / "shared-ai4math"), "AI4MATH_LEAN_TOOLCHAIN": ""}, clear=False):
                os.environ["AI4MATH_LEAN_WORKSPACE"] = ""
                result = configure(root, save_local=True)
            local = load_toml(root / ".ai4math" / "lean_agent.local.toml")

            self.assertFalse(result["ok"])
            self.assertEqual(local["lean"]["preferred_toolchain"], CANONICAL_LEAN_TOOLCHAIN)

    def test_create_workspace_dry_run_uses_canonical_toolchain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            with patch.dict(os.environ, {"AI4MATH_HOME": str(root / "shared-ai4math"), "AI4MATH_LEAN_TOOLCHAIN": ""}, clear=False), \
                patch("configure_lean.find_tool", side_effect=lambda tool: f"/usr/bin/{tool}"):
                os.environ["AI4MATH_LEAN_WORKSPACE"] = ""
                result = configure(root, create_workspace=True, dry_run=True)

            self.assertEqual(result["workspace_actions"][0]["command"], [
                "/usr/bin/elan",
                "run",
                CANONICAL_LEAN_TOOLCHAIN,
                "lake",
                "new",
                "lean_workspace",
                "math",
            ])

    def test_complete_managed_workspace_is_reused_without_rebuild(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workspace = root / "shared-ai4math" / "lean-workspace"
            workspace.mkdir(parents=True)
            (workspace / "lean-toolchain").write_text(f"{CANONICAL_LEAN_TOOLCHAIN}\n", encoding="utf-8")
            (workspace / "lakefile.toml").write_text('name = "lean_workspace"\n', encoding="utf-8")
            (workspace / "lake-manifest.json").write_text('{"packages":[]}\n', encoding="utf-8")
            (workspace / ".lake").mkdir()

            with patch.dict(os.environ, {"AI4MATH_HOME": str(root / "shared-ai4math"), "AI4MATH_LEAN_TOOLCHAIN": ""}, clear=False), \
                patch("configure_lean.run_command") as run_command:
                os.environ["AI4MATH_LEAN_WORKSPACE"] = ""
                result = configure(root, create_workspace=True)

            self.assertTrue(result["ok"])
            self.assertEqual(result["workspace_actions"][0]["command"], ["reuse", str(workspace)])
            run_command.assert_not_called()

    def test_workspace_creation_failure_is_reported_as_lean_setup_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            with patch.dict(os.environ, {"AI4MATH_HOME": str(root / "shared-ai4math")}, clear=False), \
                patch("configure_lean.find_tool", return_value="/usr/bin/lake"), \
                patch("configure_lean.run_command", return_value={
                    "ok": False,
                    "returncode": 1,
                    "stdout": "",
                    "stderr": "download failed",
                    "command": ["/usr/bin/lake", "new", "lean_workspace", "math"],
                }):
                os.environ["AI4MATH_LEAN_WORKSPACE"] = ""
                result = configure(root, create_workspace=True)

            self.assertFalse(result["ok"])
            self.assertEqual(result["status"], "lean_workspace_setup_failed")
            self.assertIn("retry configure --create-workspace", result["recommended_next_action"])

    def test_configure_setup_numina_requires_project_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.dict(os.environ, {"AI4MATH_HOME": str(root / "shared-ai4math")}, clear=False):
                os.environ["AI4MATH_LEAN_WORKSPACE"] = ""
                result = configure(root, setup_numina=True, dry_run=True)

        self.assertFalse(result["numina"]["ok"])
        self.assertEqual(result["numina"]["status"], "missing_project_name")
        self.assertIn("--project-name", result["numina"]["recommended_next_action"])


if __name__ == "__main__":
    unittest.main()
