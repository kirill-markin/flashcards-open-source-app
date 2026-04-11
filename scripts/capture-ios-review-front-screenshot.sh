#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$repo_root/scripts/capture-ios-marketing-screenshot.sh" \
  "MarketingReviewFrontScreenshotTests/testGenerateOpportunityCostReviewFrontScreenshot" \
  "1" \
  "review-card-front-app-store-opportunity-cost" \
  "the Review front state" \
  "$@"
