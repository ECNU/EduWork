from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from common import CANONICAL_LEAN_TOOLCHAIN, ai4math_home, expand_path, load_toml, read_config, read_env_local, write_env_local  # noqa: E402


class CommonConfigTests(unittest.TestCase):
    def test_load_toml_has_python39_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text(
                '[agent]\nmode = "coding-agent"\nbackend = "none"\n'
                '[lean]\nreuse_managed_workspace = true\n',
                encoding="utf-8",
            )
            with patch("common.tomllib", None):
                data = load_toml(path)

            self.assertEqual(data["agent"]["backend"], "none")
            self.assertTrue(data["lean"]["reuse_managed_workspace"])

    def test_expand_path_preserves_symlink_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            real = root / "real-python"
            link = root / "venv-python"
            real.touch()
            link.symlink_to(real)

            self.assertEqual(expand_path(str(link), root), link)

    def test_ai4math_home_honors_environment_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            custom = root / "shared-ai4math"

            with patch.dict("os.environ", {"AI4MATH_HOME": str(custom)}, clear=False):
                result = ai4math_home(root)

            self.assertEqual(result, custom)

    def test_default_config_uses_canonical_toolchain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            with patch.dict("os.environ", {"AI4MATH_LEAN_TOOLCHAIN": ""}, clear=False):
                config = read_config(root)

            self.assertEqual(config["lean"]["preferred_toolchain"], CANONICAL_LEAN_TOOLCHAIN)

    def test_environment_can_override_canonical_toolchain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            override = "leanprover/lean4:v4.26.0"

            with patch.dict("os.environ", {"AI4MATH_LEAN_TOOLCHAIN": override}, clear=False):
                config = read_config(root)

            self.assertEqual(config["lean"]["preferred_toolchain"], override)

    def test_write_env_local_updates_values_and_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            write_env_local(root, {"AI4MATH_SAMPLE_TOKEN": "secret one"})
            write_env_local(root, {"AI4MATH_SAMPLE_TOKEN": "secret two", "AI4MATH_SAMPLE_MODE": "local"})

            env = read_env_local(root)
            self.assertEqual(env["AI4MATH_SAMPLE_TOKEN"], "secret two")
            self.assertEqual(env["AI4MATH_SAMPLE_MODE"], "local")
            self.assertEqual((root / ".ai4math" / ".env.local").read_text().count("AI4MATH_SAMPLE_TOKEN"), 1)
            self.assertIn(".env.local", (root / ".ai4math" / ".gitignore").read_text())


if __name__ == "__main__":
    unittest.main()
