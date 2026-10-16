"""Apply the existing archive bounds before invoking the installed DSH checker."""
import runpy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dsh_office.documents.shared import validate_ooxml_archive

checker, document = sys.argv[1:3]
validate_ooxml_archive(Path(document))
sys.argv = [checker, document]
runpy.run_path(checker, run_name="__main__")
