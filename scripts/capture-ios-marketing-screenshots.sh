#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$repo_root/scripts/capture-ios-marketing-screenshot.sh" \
  "MarketingScreenshotsTests/testGenerateMarketingScreenshots" \
  "the unified Review, Progress, AI draft, and Cards marketing states" \
  "1" \
  "review-card-front-app-store-opportunity-cost" \
  "2" \
  "review-card-result-app-store-opportunity-cost" \
  "3" \
  "progress-app-store-study-history" \
  "4" \
  "review-card-ai-draft-app-store-opportunity-cost" \
  "5" \
  "cards-list-app-store-vocabulary" \
  "$@"
