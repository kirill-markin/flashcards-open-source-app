#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$repo_root/scripts/capture-ios-marketing-screenshot.sh" \
  "MarketingReviewScreenshotsTests/testGenerateOpportunityCostReviewScreenshots" \
  "the Review front, result, and AI draft states" \
  "1" \
  "review-card-front-app-store-opportunity-cost" \
  "2" \
  "review-card-result-app-store-opportunity-cost" \
  "4" \
  "review-card-ai-draft-app-store-opportunity-cost" \
  "$@"
