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
runtime_configuration_path="/tmp/flashcards-open-source-app-ios-marketing-screenshot-config.json"

list_booted_simulator_lines() {
    xcrun simctl list devices booted | sed -nE '/^[[:space:]]+.+ \([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\) \(Booted\)$/p'
}

escape_json_string() {
    local raw_value="$1"
    local escaped_value="$raw_value"

    escaped_value="${escaped_value//\\/\\\\}"
    escaped_value="${escaped_value//\"/\\\"}"
    escaped_value="${escaped_value//$'\n'/\\n}"
    escaped_value="${escaped_value//$'\r'/\\r}"
    escaped_value="${escaped_value//$'\t'/\\t}"

    printf '%s' "$escaped_value"
}

write_runtime_configuration() {
    local output_directory="$1"
    local localization_code="$2"

    cat >"$runtime_configuration_path" <<EOF
{
  "includeManualScreenshotTests": true,
  "outputDirectoryPath": "$(escape_json_string "$output_directory")",
  "localizationCode": "$(escape_json_string "$localization_code")"
}
EOF
}

cleanup_runtime_configuration() {
    rm -f "$runtime_configuration_path"
}

resolve_booted_simulator_id() {
    if [[ -n "${FLASHCARDS_IOS_SIMULATOR_ID:-}" ]]; then
        echo "$FLASHCARDS_IOS_SIMULATOR_ID"
        return
    fi

    mapfile -t booted_ids < <(
        list_booted_simulator_lines | sed -nE 's/^.*\(([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\) \(Booted\)$/\1/p'
    )

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
    simulator_line="$(list_booted_simulator_lines | rg -F "($simulator_id) (Booted)" | head -n 1 || true)"

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
trap cleanup_runtime_configuration EXIT
write_runtime_configuration "$output_directory" "$localization_code"

echo "Running manual iOS marketing screenshot script for $description on $simulator_name."
echo "Locale: $localization_code"
xcrun simctl bootstatus "$simulator_id" -b

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
