#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 \"<path/Nibomo.app>\"" >&2
    exit 1
fi

app_path="$1"
if [[ ! -d "$app_path" || "$app_path" != *.app ]]; then
    echo "Expected an existing .app directory: $app_path" >&2
    exit 1
fi

exec /usr/bin/open -n --env FLASHCARDS_AUTOMATION_RUN=1 "$app_path"
