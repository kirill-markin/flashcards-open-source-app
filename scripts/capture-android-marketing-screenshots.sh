#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_dir="$repo_root/apps/android"
locale_prefix="${FLASHCARDS_MARKETING_LOCALE_PREFIX:-en}"
script_class="com.flashcardsopensourceapp.app.marketing.screenshots.MarketingAllScreenshotsScript"
cleanup_script_class="com.flashcardsopensourceapp.app.marketing.screenshots.MarketingScreenshotGuestCleanupScript"
output_dir="$repo_root/apps/android/docs/media/play-store-screenshots"
remote_screenshot_dir="/sdcard/Download/flashcards-marketing-screenshots"
file_names=(
    "${locale_prefix}-1_review-card-front-google-play-opportunity-cost.png"
    "${locale_prefix}-2_review-card-result-google-play-opportunity-cost.png"
    "${locale_prefix}-3_progress-google-play-study-history.png"
    "${locale_prefix}-4_review-card-ai-draft-google-play-opportunity-cost.png"
    "${locale_prefix}-5_cards-list-google-play-vocabulary.png"
)

if [[ "$(adb get-state 2>/dev/null)" != "device" ]]; then
    cat >&2 <<'EOF'
No Android device or emulator is connected.
Start one headless API 36 emulator first, for example:
  emulator @Medium_Phone_API_36.1 -no-window -no-audio -gpu auto

If the local emulator is flaky and you need more startup visibility, use:
  emulator @Medium_Phone_API_36.1 -no-window -no-audio -gpu auto -verbose -debug init,metrics -logcat '*:s ActivityManager:i AndroidTestOrchestrator:i TestRunner:i'
EOF
    exit 1
fi

device_sdk="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
if [[ "$device_sdk" != "36" ]]; then
    echo "Connected Android device must run API 36. Current SDK: $device_sdk" >&2
    exit 1
fi

run_marketing_guest_cleanup() {
    "$repo_root/scripts/android-dismiss-system-dialogs.sh"
    (
        cd "$android_dir"
        echo "Running Android marketing screenshot guest cleanup."
        ./gradlew :app:connectedMarketingScreenshotAndroidTest \
          "-Pandroid.testInstrumentationRunnerArguments.includeManualOnly=true" \
          "-Pandroid.testInstrumentationRunnerArguments.clearPackageData=false" \
          "-Pandroid.testInstrumentationRunnerArguments.marketingLocalePrefix=$locale_prefix" \
          "-Pandroid.testInstrumentationRunnerArguments.class=$cleanup_script_class"
    )
}

cleanup_on_exit() {
    local exit_status="$?"
    if ! run_marketing_guest_cleanup; then
        echo "ERROR: Android marketing screenshot guest cleanup failed." >&2
        if [[ "$exit_status" -eq 0 ]]; then
            exit_status=1
        fi
    fi
    exit "$exit_status"
}

"$repo_root/scripts/android-set-device-locale.sh" "$locale_prefix"
"$repo_root/scripts/android-dismiss-system-dialogs.sh"
trap cleanup_on_exit EXIT
run_marketing_guest_cleanup

cd "$android_dir"
echo "Running the unified Android marketing screenshot flow."
./gradlew :app:connectedMarketingScreenshotAndroidTest \
  "-Pandroid.testInstrumentationRunnerArguments.includeManualOnly=true" \
  "-Pandroid.testInstrumentationRunnerArguments.clearPackageData=false" \
  "-Pandroid.testInstrumentationRunnerArguments.marketingLocalePrefix=$locale_prefix" \
  "-Pandroid.testInstrumentationRunnerArguments.class=$script_class"

mkdir -p "$output_dir"

for file_name in "${file_names[@]}"; do
    output_path="$output_dir/$file_name"
    remote_screenshot_path="$remote_screenshot_dir/$file_name"
    temp_output_path="$(mktemp)"
    adb exec-out cat "$remote_screenshot_path" > "$temp_output_path"
    mv "$temp_output_path" "$output_path"
    echo "Saved screenshot to $output_path"
done
