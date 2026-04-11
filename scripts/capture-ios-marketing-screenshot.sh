#!/usr/bin/env bash

set -euo pipefail

supported_locales=(
    "en-US"
    "ar"
    "zh-Hans"
    "de"
    "hi"
    "ja"
    "ru"
    "es-MX"
    "es-ES"
)

print_usage() {
    cat <<'EOF' >&2
Usage:
  capture-ios-marketing-screenshot.sh [--locale <code>] <test_identifier> <description> <screenshot_index> <screenshot_slug> [<screenshot_index> <screenshot_slug> ...]
  capture-ios-marketing-screenshot.sh --list-locales

Supported locales:
  en-US
  ar
  zh-Hans
  de
  hi
  ja
  ru
  es-MX
  es-ES

Environment:
  FLASHCARDS_MARKETING_SCREENSHOT_LOCALE   Canonical locale code or supported alias.
  FLASHCARDS_IOS_SIMULATOR_ID              Booted simulator device UUID.
EOF
}

print_supported_locales() {
    printf '%s\n' "${supported_locales[@]}"
}

canonicalize_locale() {
    local raw_locale="$1"

    case "$raw_locale" in
        en | en-US)
            echo "en-US"
            ;;
        ar)
            echo "ar"
            ;;
        zh-CN | zh-Hans)
            echo "zh-Hans"
            ;;
        de | de-DE)
            echo "de"
            ;;
        hi | hi-IN)
            echo "hi"
            ;;
        ja | ja-JP)
            echo "ja"
            ;;
        ru | ru-RU)
            echo "ru"
            ;;
        es-MX | es-419)
            echo "es-MX"
            ;;
        es-ES)
            echo "es-ES"
            ;;
        *)
            return 1
            ;;
    esac
}

resolve_requested_locale() {
    local cli_locale="$1"
    local env_locale="${FLASHCARDS_MARKETING_SCREENSHOT_LOCALE:-}"
    local requested_locale=""

    if [[ -n "$cli_locale" ]]; then
        requested_locale="$cli_locale"
    elif [[ -n "$env_locale" ]]; then
        requested_locale="$env_locale"
    else
        requested_locale="en-US"
    fi

    if ! canonicalize_locale "$requested_locale"; then
        echo "Unsupported iOS marketing screenshot locale: $requested_locale" >&2
        echo "Supported locales: ${supported_locales[*]}" >&2
        exit 1
    fi
}

if [[ $# -eq 0 ]]; then
    print_usage
    exit 1
fi

requested_locale=""
positional_arguments=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --locale)
            shift
            if [[ $# -eq 0 ]]; then
                echo "Missing value after --locale." >&2
                print_usage
                exit 1
            fi
            requested_locale="$1"
            shift
            ;;
        --locale=*)
            requested_locale="${1#*=}"
            shift
            ;;
        --list-locales)
            print_supported_locales
            exit 0
            ;;
        --help | -h)
            print_usage
            exit 0
            ;;
        *)
            positional_arguments+=("$1")
            shift
            ;;
    esac
done

if [[ "${#positional_arguments[@]}" -lt 4 ]]; then
    print_usage
    exit 1
fi

test_identifier="${positional_arguments[0]}"
description="${positional_arguments[1]}"
expected_screenshot_arguments=("${positional_arguments[@]:2}")

if (( ${#expected_screenshot_arguments[@]} % 2 != 0 )); then
    print_usage
    exit 1
fi

localization_code="$(resolve_requested_locale "$requested_locale")"

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

mkdir -p "$output_directory"

echo "Running manual iOS marketing screenshot script for $description on $simulator_name."
echo "Locale: $localization_code"
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

for ((index = 0; index < ${#expected_screenshot_arguments[@]}; index += 2)); do
    screenshot_index="${expected_screenshot_arguments[$index]}"
    screenshot_slug="${expected_screenshot_arguments[$((index + 1))]}"
    output_file_name="${localization_code}-${screenshot_index}_${screenshot_slug}.png"
    output_path="$output_directory/$output_file_name"

    if [[ ! -f "$output_path" ]]; then
        echo "Expected screenshot file at $output_path." >&2
        exit 1
    fi

    echo "Saved screenshot to $output_path"
done
