"""Run only this package's Office modules with an isolated Python interpreter."""
import runpy
import sys
from pathlib import Path

module = sys.argv.pop(1)
allowed = {
    "documents": {"create_document", "edit_document", "inspect_document", "validate_document", "render_preview"},
    "spreadsheets": {"create_workbook", "edit_workbook", "inspect_workbook", "validate_workbook"},
    "presentations": {"create_presentation", "inspect_presentation", "validate_presentation"},
    "pdfs": {"create_pdf", "inspect_pdf", "validate_pdf", "merge_pdf", "extract_pages"},
}
kind, _, command = module.partition(".")
if command not in allowed.get(kind, set()):
    raise SystemExit("Unsupported Office operation")
sys.path.insert(0, str(Path(__file__).resolve().parent))
runpy.run_module("dsh_office." + module, run_name="__main__")
