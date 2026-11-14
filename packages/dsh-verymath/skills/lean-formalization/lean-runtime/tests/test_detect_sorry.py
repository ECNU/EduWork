from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from detect_sorry import scan_text  # noqa: E402


class DetectSorryTests(unittest.TestCase):
    def test_detects_sorry_and_ignores_line_comment(self) -> None:
        result = scan_text("theorem t : True := by\n  trivial\n-- sorry\n", source="x.lean")
        self.assertTrue(result["ok"])

        result = scan_text("theorem t : True := by\n  sorry\n", source="x.lean")
        self.assertFalse(result["ok"])
        self.assertEqual(result["findings"][0]["kind"], "sorry")


if __name__ == "__main__":
    unittest.main()
