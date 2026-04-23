#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$repo_root/scripts/capture-ios-marketing-screenshot.sh" \
  "MarketingProgressScreenshotTests/testGenerateStudyHistoryProgressScreenshot" \
  "the Progress study history state" \
  "3" \
  "progress-app-store-study-history" \
  "$@"
