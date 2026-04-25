#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$repo_root/scripts/capture-ios-marketing-screenshot.sh" \
  "MarketingScreenshotsTests/testGenerateMarketingScreenshots" \
  "the unified Review, Progress, AI draft, and Cards marketing states" \
  "1" \
  "2" \
  "3" \
  "4" \
  "5" \
  "$@"
