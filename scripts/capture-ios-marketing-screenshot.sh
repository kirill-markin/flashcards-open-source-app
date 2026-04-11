#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 4 ]]; then
    echo "Usage: $0 <test_identifier> <output_file_name> <localization_code> <description>" >&2
    exit 1
fi

test_identifier="$1"
output_file_name="$2"
localization_code="$3"
description="$4"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_path="$repo_root/apps/ios/Flashcards/Flashcards Open Source App.xcodeproj"
scheme_name="Flashcards Open Source App"

resolve_booted_simulator_id() {
    if [[ -n "${FLASHCARDS_IOS_SIMULATOR_ID:-}" ]]; then
        echo "$FLASHCARDS_IOS_SIMULATOR_ID"
        return
    fi

    mapfile -t booted_ids < <(xcrun simctl list devices booted | awk -F '[()]' '/Booted/ {print $(NF-1)}')

    if [[ "${#booted_ids[@]}" -eq 0 ]]; then
        echo "No booted iOS simulator was found. Boot one simulator manually first." >&2
        exit 1
    fi

    if [[ "${#booted_ids[@]}" -gt 1 ]]; then
        echo "More than one iOS simulator is booted. Set FLASHCARDS_IOS_SIMULATOR_ID explicitly." >&2
        exit 1
    fi

    echo "${booted_ids[0]}"
}

resolve_simulator_name() {
    local simulator_id="$1"
    local simulator_line
    simulator_line="$(xcrun simctl list devices booted | rg "$simulator_id" | head -n 1 || true)"

    if [[ -z "$simulator_line" ]]; then
        echo "Failed to resolve the booted simulator line for $simulator_id." >&2
        exit 1
    fi

    echo "$simulator_line" | sed -E 's/^[[:space:]]*//; s/[[:space:]]+\([^)]*\)[[:space:]]+\(Booted\)$//'
}

resolve_device_family() {
    local simulator_name="$1"

    if [[ "$simulator_name" == *"iPad"* ]]; then
        echo "ipad"
        return
    fi

    if [[ "$simulator_name" == *"iPhone"* ]]; then
        echo "iphone"
        return
    fi

    echo "Unable to derive iOS screenshot device family from booted simulator '$simulator_name'." >&2
    exit 1
}

simulator_id="$(resolve_booted_simulator_id)"
simulator_name="$(resolve_simulator_name "$simulator_id")"
device_family="$(resolve_device_family "$simulator_name")"
output_directory="$repo_root/apps/ios/docs/media/app-store-screenshots/$device_family"
output_path="$output_directory/$output_file_name"

mkdir -p "$output_directory"

echo "Running manual iOS marketing screenshot script for $description on $simulator_name."
xcrun simctl bootstatus "$simulator_id" -b

FLASHCARDS_INCLUDE_MANUAL_SCREENSHOT_TESTS="true" \
FLASHCARDS_MARKETING_SCREENSHOT_OUTPUT_DIR="$output_directory" \
FLASHCARDS_MARKETING_SCREENSHOT_LOCALIZATION="$localization_code" \
xcodebuild \
  -project "$project_path" \
  -scheme "$scheme_name" \
  -destination "platform=iOS Simulator,id=$simulator_id" \
  "-only-testing:Flashcards Open Source App UI Tests/$test_identifier" \
  test

if [[ ! -f "$output_path" ]]; then
    echo "Expected screenshot file at $output_path." >&2
    exit 1
fi

echo "Saved screenshot to $output_path"
