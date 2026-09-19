#!/usr/bin/env bash

set -euo pipefail

remote_path="$1"
output_path="$2"
run_started_at="$3"
remote_mtime="$(adb shell stat -c %Y "$remote_path" | tr -d '\r')"
remote_size="$(adb shell stat -c %s "$remote_path" | tr -d '\r')"

if [[ ! "$remote_mtime" =~ ^[0-9]+$ || "$remote_mtime" -lt "$run_started_at" ]]; then
    echo "ERROR: Screenshot is stale or missing: $remote_path (mtime=$remote_mtime, run=$run_started_at)." >&2
    exit 1
fi
if [[ ! "$remote_size" =~ ^[0-9]+$ || "$remote_size" -eq 0 ]]; then
    echo "ERROR: Screenshot is empty: $remote_path." >&2
    exit 1
fi

adb pull -a "$remote_path" "$output_path"
python3 - "$output_path" "$remote_size" "$run_started_at" <<'PYTHON'
from pathlib import Path
import sys

path = Path(sys.argv[1])
size = int(sys.argv[2])
started_at = int(sys.argv[3])
if path.stat().st_size != size or path.stat().st_mtime < started_at:
    raise SystemExit(f"ERROR: Screenshot transfer is incomplete or stale: {path}")
with path.open("rb") as image:
    if image.read(8) != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"ERROR: Screenshot is not a PNG: {path}")
PYTHON
