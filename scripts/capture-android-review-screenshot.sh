#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "scripts/capture-android-review-screenshot.sh is now a compatibility alias for the supported combined Review + Cards run." >&2
exec bash "$repo_root/scripts/capture-android-review-and-cards-screenshot.sh"
