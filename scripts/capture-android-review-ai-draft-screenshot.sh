#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_dir="$repo_root/apps/android"
output_path="$repo_root/apps/android/docs/media/play-store-screenshots/en-4_review-card-ai-draft-google-play-opportunity-cost.png"
script_class="com.flashcardsopensourceapp.app.MarketingReviewAiDraftScreenshotScript"
remote_screenshot_path="/sdcard/Download/flashcards-marketing-screenshots/en-4_review-card-ai-draft-google-play-opportunity-cost.png"

if [[ "$(adb get-state 2>/dev/null)" != "device" ]]; then
    echo "No Android device or emulator is connected." >&2
    exit 1
fi

device_sdk="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
if [[ "$device_sdk" != "36" ]]; then
    echo "Connected Android device must run API 36. Current SDK: $device_sdk" >&2
    exit 1
fi

"$repo_root/scripts/android-dismiss-system-dialogs.sh"

cd "$android_dir"
echo "Running manual Android marketing screenshot script for the Review AI draft state."
./gradlew :app:connectedDebugAndroidTest \
  "-Pandroid.testInstrumentationRunnerArguments.includeManualOnly=true" \
  "-Pandroid.testInstrumentationRunnerArguments.class=$script_class"

mkdir -p "$(dirname "$output_path")"
temp_output_path="$(mktemp)"
adb exec-out cat "$remote_screenshot_path" > "$temp_output_path"
mv "$temp_output_path" "$output_path"

echo "Saved screenshot to $output_path"
