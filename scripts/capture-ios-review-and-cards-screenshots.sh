#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$repo_root/scripts/capture-ios-marketing-screenshot.sh" \
  "MarketingReviewAndCardsScreenshotsTests/testGenerateOpportunityCostReviewAndCardsScreenshots" \
  "the Review front, result, AI draft, and Cards list states" \
  "1" \
  "review-card-front-app-store-opportunity-cost" \
  "2" \
  "review-card-result-app-store-opportunity-cost" \
  "4" \
  "review-card-ai-draft-app-store-opportunity-cost" \
  "5" \
  "cards-list-app-store-vocabulary" \
  "$@"
