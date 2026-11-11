#!/usr/bin/env python3
"""Export the Hebrew tables from the Python app to worker/src/tables.json.

The Python modules stay the source of truth; the Cloudflare Worker consumes the
generated JSON. Values are read with ast.literal_eval, so no app dependencies
(Pillow, pydantic, ...) are needed to run this script.

Usage:
    python3 scripts/export_tables.py            # write worker/src/tables.json
    python3 scripts/export_tables.py --check    # exit 1 if the file is stale
"""
import argparse
import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "worker" / "src" / "tables.json"

# module path -> {json key: module-level variable}
SOURCES = {
    "app/services/clock.py": {
        "hours": "HOURS",
        "minutePrefix": "MINUTE_PREFIX",
        "periodWords": "PERIOD_WORDS",
        "monthsHe": "MONTHS_HE",
        "daysHe": "DAYS_HE",
    },
    "app/services/jewish_cal.py": {
        "jewishMonthsHe": "_JEWISH_MONTHS_HE",
        "hebrewDayNums": "_HEBREW_DAY_NUMS",
    },
    "app/services/weather.py": {
        "descMap": "_DESC_MAP",
    },
}


def _literal(tree: ast.Module, name: str, path: str):
    for node in tree.body:
        target = None
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target, value = node.targets[0], node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            target, value = node.target, node.value
        if isinstance(target, ast.Name) and target.id == name:
            return ast.literal_eval(value)
    raise SystemExit(f"{name} not found in {path}")


def build() -> str:
    data: dict = {}
    for path, keys in SOURCES.items():
        tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
        for key, var in keys.items():
            value = _literal(tree, var, path)
            # sets (PERIOD_WORDS) are unordered: sort for a stable file
            data[key] = sorted(value) if isinstance(value, (set, frozenset)) else value
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if tables.json is out of date")
    args = parser.parse_args()
    content = build()
    if args.check:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != content:
            print(f"{OUT.relative_to(ROOT)} is stale; run scripts/export_tables.py", file=sys.stderr)
            return 1
        return 0
    OUT.write_text(content, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
