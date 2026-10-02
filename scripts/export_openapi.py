"""Export without starting the server or touching persistent demo data."""

import json
from pathlib import Path

from backend.app.main import create_app

root = Path(__file__).resolve().parents[1]
(root / "docs" / "openapi.json").write_text(
    json.dumps(create_app().openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
