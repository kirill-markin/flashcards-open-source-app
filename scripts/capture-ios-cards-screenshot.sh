#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$repo_root/scripts/capture-ios-marketing-screenshot.sh" \
  "MarketingCardsScreenshotTests/testGenerateConceptCardsListScreenshot" \
  "en-3_cards-list-app-store-vocabulary.png" \
  "en" \
  "the Cards list state"
