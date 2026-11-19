from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from common import ensure_ai4math_gitignore  # noqa: E402
from numina_runtime import (  # noqa: E402
    DEFAULT_UPSTREAM_URL,
    build_configure_plan,
    build_install_plan,
    build_run_plan,
    credential_report,
    read_numina_env_local,
    runtime_paths,
)


class NuminaRuntimePathTests(unittest.TestCase):
    def test_runtime_paths_default_under_ai4math(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shared = root / "shared-ai4math"

            with patch.dict(os.environ, {"AI4MATH_HOME": str(shared), "AI4MATH_NUMINA_HOME": ""}, clear=False):
                paths = runtime_paths(root)

            runtime = shared / "numina-runtime"
            self.assertEqual(paths["root"], str(runtime))
            self.assertEqual(paths["upstream"], str(runtime / "upstream"))
            self.assertEqual(paths["results"], str(runtime / "results"))
            self.assertEqual(paths["default_upstream_url"], DEFAULT_UPSTREAM_URL)

    def test_runtime_paths_honor_ai4math_numina_home(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            custom = Path(tmp) / "custom-numina"
            with patch.dict(os.environ, {"AI4MATH_NUMINA_HOME": str(custom)}, clear=False):
                paths = runtime_paths(Path(tmp))

            expected = Path(os.path.abspath(custom))
            self.assertEqual(paths["root"], str(expected))
            self.assertEqual(paths["upstream"], str(expected / "upstream"))

    def test_numina_runtime_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            gitignore = ensure_ai4math_gitignore(tmp)

            lines = gitignore.read_text(encoding="utf-8").splitlines()

        self.assertIn("numina-runtime/", lines)


class NuminaRuntimeCredentialTests(unittest.TestCase):
    def test_env_local_is_read_from_numina_runtime_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shared = root / "shared-ai4math"
            env_path = shared / "numina-runtime" / ".env.local"
            env_path.parent.mkdir(parents=True)
            env_path.write_text(
                "export ANTHROPIC_AUTH_TOKEN=secret-token\n"
                "OPENAI_API_KEY=placeholder-openai-token\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"AI4MATH_HOME": str(shared), "AI4MATH_NUMINA_HOME": ""}, clear=False):
                values = read_numina_env_local(root)

        self.assertEqual(values["ANTHROPIC_AUTH_TOKEN"], "secret-token")
        self.assertEqual(values["OPENAI_API_KEY"], "placeholder-openai-token")

    def test_credential_report_redacts_values(self) -> None:
        report = credential_report({
            "ANTHROPIC_AUTH_TOKEN": "secret-token",
            "OPENAI_API_KEY": "placeholder-openai-token",
        })

        self.assertTrue(report["claude"]["configured"])
        self.assertEqual(report["claude"]["variables"]["ANTHROPIC_AUTH_TOKEN"], "<redacted>")
        self.assertEqual(report["skill_keys"]["OPENAI_API_KEY"], "<redacted>")
        self.assertNotIn("secret-token", str(report))


class NuminaRuntimePlanTests(unittest.TestCase):
    def test_install_plan_clones_official_upstream_when_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shared = root / "shared-ai4math"
            with patch.dict(os.environ, {"AI4MATH_HOME": str(shared), "AI4MATH_NUMINA_HOME": ""}, clear=False):
                plan = build_install_plan(root, dry_run=True)

        self.assertTrue(plan["ok"])
        self.assertEqual(plan["status"], "install_plan_ready")
        self.assertEqual(plan["actions"][0]["command"][0:2], ["git", "clone"])
        self.assertEqual(plan["actions"][0]["command"][2], DEFAULT_UPSTREAM_URL)

    def test_install_plan_blocks_dirty_upstream(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shared = root / "shared-ai4math"
            upstream = shared / "numina-runtime" / "upstream"
            upstream.mkdir(parents=True)
            (upstream / ".git").mkdir()

            with patch.dict(os.environ, {"AI4MATH_HOME": str(shared), "AI4MATH_NUMINA_HOME": ""}, clear=False), \
                patch("numina_runtime.run_command", return_value={
                "ok": True,
                "returncode": 0,
                "stdout": " M tutorial/foo.py\n",
                "stderr": "",
                "command": ["git", "status", "--short"],
            }):
                plan = build_install_plan(root, dry_run=False)

        self.assertFalse(plan["ok"])
        self.assertEqual(plan["status"], "dirty_upstream")
        self.assertEqual(plan["actions"], [])

    def test_configure_plan_uses_official_setup_and_uv_commands(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shared = root / "shared-ai4math"
            upstream = shared / "numina-runtime" / "upstream"
            (upstream / ".git").mkdir(parents=True)

            with patch.dict(os.environ, {"AI4MATH_HOME": str(shared), "AI4MATH_NUMINA_HOME": ""}, clear=False), \
                patch("numina_runtime.run_command", return_value={
                "ok": True,
                "returncode": 0,
                "stdout": "",
                "stderr": "",
                "command": ["git", "status", "--short"],
            }):
                plan = build_configure_plan(root, project_name="demo_project", dry_run=True)

        commands = [action["command"] for action in plan["actions"]]
        self.assertTrue(plan["ok"])
        self.assertIn(["./setup.sh", "demo_project"], commands)
        self.assertIn(["uv", "python", "install"], commands)
        self.assertIn(["uv", "sync"], commands)
        self.assertNotIn(["uv", "run", "scripts/sync_projects.py"], commands)

    def test_run_plan_uses_official_runner_without_executing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            theorem = root / "Demo.lean"
            theorem.write_text("example : True := by\n  trivial\n", encoding="utf-8")
            shared = root / "shared-ai4math"
            upstream = shared / "numina-runtime" / "upstream"
            upstream.mkdir(parents=True)

            with patch.dict(os.environ, {"AI4MATH_HOME": str(shared), "AI4MATH_NUMINA_HOME": ""}, clear=False):
                plan = build_run_plan(root, file=theorem, max_iters=3)

        self.assertTrue(plan["ok"])
        self.assertEqual(plan["status"], "run_plan_ready")
        self.assertEqual(plan["command"][0:5], ["uv", "run", "python", "-m", "scripts.run_claude"])
        self.assertIn(str(Path(os.path.abspath(theorem))), plan["command"])


if __name__ == "__main__":
    unittest.main()
