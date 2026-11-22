from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from validate_patch import review_files  # noqa: E402


FIXTURES = Path(__file__).resolve().parent / "fixtures"


class ValidatePatchTests(unittest.TestCase):
    def test_rejects_sorry(self) -> None:
        result = review_files(FIXTURES / "before.lean", FIXTURES / "after_bad.lean")
        self.assertFalse(result["ok"])
        self.assertTrue(result["forbidden_findings"])

    def test_rejects_statement_change(self) -> None:
        result = review_files(FIXTURES / "before.lean", FIXTURES / "after_statement_changed.lean")
        self.assertFalse(result["ok"])
        self.assertTrue(result["statement_changes"])


if __name__ == "__main__":
    unittest.main()
