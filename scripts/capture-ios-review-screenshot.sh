#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$repo_root/scripts/capture-ios-marketing-screenshot.sh" \
  "MarketingReviewResultScreenshotTests/testGenerateOpportunityCostReviewResultScreenshot" \
  "en-2_review-card-result-app-store-opportunity-cost.png" \
  "en" \
  "the Review result state"
