#!/usr/bin/env python3
"""Render worker/test/fixtures/cases.json with the Python app and store the PNGs as
base64 in worker/test/fixtures/golden.json. The Worker's tests compare their own
renders against these, so the two targets cannot silently drift apart.

Needs the app's dependencies (Pillow with raqm, loguru, pydantic-settings):
    pip install -r requirements.txt && python scripts/gen_golden.py
"""
import base64
import datetime
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.services import clock  # noqa: E402

FIXTURES = ROOT / "worker" / "test" / "fixtures"
DESC = json.loads((ROOT / "worker" / "src" / "tables.json").read_text(encoding="utf-8"))["descMap"]


def main() -> None:
    golden = {}
    for case in json.loads((FIXTURES / "cases.json").read_text(encoding="utf-8")):
        at = datetime.datetime(*case["at"])
        clock.get_israel_time = lambda at=at: at  # freeze the clock
        w = case["weather"]
        weather = {"temp": w["temp"], "icon_key": w["icon"], "desc": DESC[w["icon"]]} if w else None
        png = clock.generate_clock_image(
            font_name=case["font"], sleep_time=case["sleep"], weather=weather, jewish_date=case["jewish"]
        )
        golden[case["name"]] = base64.b64encode(png).decode()
    (FIXTURES / "golden.json").write_text(json.dumps(golden, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(golden)} golden images")


if __name__ == "__main__":
    main()
