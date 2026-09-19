#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
android_dir="$repo_root/apps/android"
locale_prefix="${FLASHCARDS_MARKETING_LOCALE_PREFIX:-en}"
script_class="com.flashcardsopensourceapp.app.marketing.screenshots.MarketingAllScreenshotsScript"
cleanup_script_class="com.flashcardsopensourceapp.app.marketing.screenshots.MarketingScreenshotGuestCleanupScript"
script_method="generateUnifiedOpportunityCostMarketingScreenshotFlow"
cleanup_script_method="deleteStoredGuestSessionThenResetLocalState"
result_dir="$android_dir/app/build/outputs/androidTest-results/connected/marketingScreenshot"
sentry_environment_override="marketing-screenshot-instrumentation"
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
Start one headless API 37 emulator first, for example:
  emulator @Medium_Phone_API_37.0 -no-window -no-audio -gpu auto

If the local emulator is flaky and you need more startup visibility, use:
  emulator @Medium_Phone_API_37.0 -no-window -no-audio -gpu auto -verbose -debug init,metrics -logcat '*:s ActivityManager:i AndroidTestOrchestrator:i TestRunner:i'
EOF
    exit 1
fi

device_sdk="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
if [[ "$device_sdk" != "37" ]]; then
    echo "Connected Android device must run API 37. Current SDK: $device_sdk" >&2
    exit 1
fi

run_marketing_test() {
    local stage="$1"
    local expected_class="$2"
    local expected_method="$3"
    local expected_test="$expected_class#$expected_method"
    local stage_dir="$run_dir/$stage"
    local gradle_status=0
    mkdir -p "$stage_dir" || return "$?"
    rm -rf "$result_dir" || return "$?"
    "$repo_root/scripts/android/android-dismiss-system-dialogs.sh" || return "$?"
    (
        cd "$android_dir" || exit "$?"
        ./gradlew :app:verifyMarketingScreenshotResult \
          --no-configuration-cache \
          --init-script "$repo_root/scripts/android/verify-marketing-screenshot-result.init.gradle" \
          "-PmarketingScreenshotExpectedTest=$expected_test" \
          "-PmarketingScreenshotProofFile=$stage_dir/verified-test.txt" \
          "-Pandroid.testInstrumentationRunnerArguments.includeManualOnly=true" \
          "-Pandroid.testInstrumentationRunnerArguments.clearPackageData=false" \
          "-Pandroid.testInstrumentationRunnerArguments.marketingLocalePrefix=$locale_prefix" \
          "-Pandroid.testInstrumentationRunnerArguments.flashcardsSentryEnvironmentOverride=$sentry_environment_override" \
          "-Pandroid.testInstrumentationRunnerArguments.class=$expected_class"
    ) || gradle_status="$?"
    if [[ -d "$result_dir" ]]; then
        cp -R "$result_dir" "$stage_dir/results" || return "$?"
    fi
    if [[ "$gradle_status" -ne 0 ]]; then
        echo "ERROR: Android marketing stage $stage failed. Reports: $stage_dir" >&2
        return "$gradle_status"
    fi
    if [[ ! -f "$stage_dir/verified-test.txt" ]] || [[ "$(cat "$stage_dir/verified-test.txt")" != "$expected_test" ]]; then
        echo "ERROR: No verified successful execution of $expected_test for stage $stage. Reports: $stage_dir" >&2
        return 1
    fi
}

cleanup_on_exit() {
    local exit_status="$?"
    trap - EXIT
    if [[ "$final_cleanup_succeeded" != "true" ]]; then
        if ! run_marketing_test "exit-cleanup" "$cleanup_script_class" "$cleanup_script_method"; then
            echo "ERROR: Android marketing guest cleanup failed; restore the device and rerun cleanup before another capture. Reports: $run_dir" >&2
            exit_status=1
        fi
    fi
    rm -rf "$staging_dir"
    exit "$exit_status"
}

"$repo_root/scripts/android/android-set-device-locale.sh" "$locale_prefix"
adb shell cmd uimode night yes
"$repo_root/scripts/android/android-dismiss-system-dialogs.sh"
staging_dir="$(mktemp -d)"
mkdir -p "$android_dir/app/build/marketing-screenshot-runs"
run_dir="$(mktemp -d "$android_dir/app/build/marketing-screenshot-runs/run.XXXXXX")"
final_cleanup_succeeded=false
trap cleanup_on_exit EXIT
echo "Android marketing stage reports: $run_dir"
run_marketing_test "initial-cleanup" "$cleanup_script_class" "$cleanup_script_method"

# Use the device clock because emulator and host clocks can differ.
run_started_at="$(adb shell date +%s | tr -d '\r')"
for file_name in "${file_names[@]}"; do
    adb shell rm -f "$remote_screenshot_dir/$file_name"
done

echo "Running the unified Android marketing screenshot flow."
run_marketing_test "capture" "$script_class" "$script_method"

for file_name in "${file_names[@]}"; do
    bash "$repo_root/scripts/android/pull-marketing-screenshot.sh" \
        "$remote_screenshot_dir/$file_name" "$staging_dir/$file_name" "$run_started_at"
done

run_marketing_test "final-cleanup" "$cleanup_script_class" "$cleanup_script_method"
final_cleanup_succeeded=true

mkdir -p "$output_dir"
for file_name in "${file_names[@]}"; do
    mv "$staging_dir/$file_name" "$output_dir/$file_name"
    echo "Saved screenshot to $output_dir/$file_name"
done
