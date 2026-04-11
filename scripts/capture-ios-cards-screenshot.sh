#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$repo_root/scripts/capture-ios-marketing-screenshot.sh" \
  "MarketingCardsScreenshotTests/testGenerateConceptCardsListScreenshot" \
  "3" \
  "cards-list-app-store-vocabulary" \
  "the Cards list state" \
  "$@"
