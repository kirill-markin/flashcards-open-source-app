#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$repo_root/scripts/capture-ios-marketing-screenshot.sh" \
  "MarketingReviewAiDraftScreenshotTests/testGenerateOpportunityCostReviewAiDraftScreenshot" \
  "4" \
  "review-card-ai-draft-app-store-opportunity-cost" \
  "the Review AI draft state" \
  "$@"
