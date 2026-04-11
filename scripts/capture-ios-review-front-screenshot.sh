#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$repo_root/scripts/capture-ios-marketing-screenshot.sh" \
  "MarketingReviewFrontScreenshotTests/testGenerateOpportunityCostReviewFrontScreenshot" \
  "en-1_review-card-front-app-store-opportunity-cost.png" \
  "en" \
  "the Review front state"
