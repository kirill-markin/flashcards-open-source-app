#!/usr/bin/env bash

set -euo pipefail

supported_locales=(
    "en-US"
    "ar"
    "zh-Hans"
    "fr"
    "de"
    "hi"
    "ja"
    "pt-BR"
    "ru"
    "es-MX"
    "es-ES"
    "bg"
    "bn"
    "ca"
    "cs"
    "da"
    "el"
    "et"
    "fa"
    "fi"
    "gu"
    "he"
    "hr"
    "hu"
    "id"
    "is"
    "it"
    "kn"
    "ko"
    "lt"
    "lv"
    "ml"
    "mr"
    "nb"
    "nl"
    "pa"
    "pl"
    "ro"
    "sk"
    "sl"
    "sv"
    "sw"
    "ta"
    "te"
    "th"
    "tr"
    "uk"
    "ur"
    "vi"
    "zu"
)

# Capture tags without an App Store listing locale. Captured on iPhone only.
iphone_only_locales=(
    "bg"
    "et"
    "fa"
    "is"
    "lt"
    "lv"
    "sw"
    "zu"
)

print_usage() {
    cat <<'EOF' >&2
Usage:
  capture-ios-marketing-screenshot.sh [--locale <code>] <test_identifier> <description> <screenshot_index> [<screenshot_index> ...]
  capture-ios-marketing-screenshot.sh --list-locales
  capture-ios-marketing-screenshot.sh --list-ipad-locales

Supported locales:
  en-US
  ar
  zh-Hans
  fr
  de
  hi
  ja
  pt-BR
  ru
  es-MX
  es-ES
  bg
  bn
  ca
  cs
  da
  el
  et
  fa
  fi
  gu
  he
  hr
  hu
  id
  is
  it
  kn
  ko
  lt
  lv
  ml
  mr
  nb
  nl
  pa
  pl
  ro
  sk
  sl
  sv
  sw
  ta
  te
  th
  tr
  uk
  ur
  vi
  zu

iPad locales are these locales without the iPhone-only capture tags. Print them
with --list-ipad-locales. Capturing an iPhone-only tag on a booted iPad fails.

Environment:
  FLASHCARDS_MARKETING_SCREENSHOT_LOCALE   Canonical locale code or supported alias.
  FLASHCARDS_IOS_SIMULATOR_ID              Booted simulator device UUID.
EOF
}

print_supported_locales() {
    printf '%s\n' "${supported_locales[@]}"
}

is_iphone_only_locale() {
    local candidate="$1"
    local locale=""

    for locale in "${iphone_only_locales[@]}"; do
        if [[ "$locale" == "$candidate" ]]; then
            return 0
        fi
    done

    return 1
}

print_ipad_locales() {
    local locale=""

    for locale in "${supported_locales[@]}"; do
        if is_iphone_only_locale "$locale"; then
            continue
        fi

        printf '%s\n' "$locale"
    done
}

canonicalize_locale() {
    local raw_locale="$1"

    case "$raw_locale" in
        en | en-US)
            echo "en-US"
            ;;
        ar | ar-SA)
            echo "ar"
            ;;
        zh-CN | zh-Hans)
            echo "zh-Hans"
            ;;
        fr | fr-FR)
            echo "fr"
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
        pt-BR | pt)
            echo "pt-BR"
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
        bg)
            echo "bg"
            ;;
        bn | bn-BD)
            echo "bn"
            ;;
        ca)
            echo "ca"
            ;;
        cs)
            echo "cs"
            ;;
        da)
            echo "da"
            ;;
        el)
            echo "el"
            ;;
        et)
            echo "et"
            ;;
        fa)
            echo "fa"
            ;;
        fi)
            echo "fi"
            ;;
        gu | gu-IN)
            echo "gu"
            ;;
        he)
            echo "he"
            ;;
        hr)
            echo "hr"
            ;;
        hu)
            echo "hu"
            ;;
        id)
            echo "id"
            ;;
        is)
            echo "is"
            ;;
        it)
            echo "it"
            ;;
        kn | kn-IN)
            echo "kn"
            ;;
        ko)
            echo "ko"
            ;;
        lt)
            echo "lt"
            ;;
        lv)
            echo "lv"
            ;;
        ml | ml-IN)
            echo "ml"
            ;;
        mr | mr-IN)
            echo "mr"
            ;;
        nb | no)
            echo "nb"
            ;;
        nl | nl-NL)
            echo "nl"
            ;;
        pa | pa-IN)
            echo "pa"
            ;;
        pl)
            echo "pl"
            ;;
        ro)
            echo "ro"
            ;;
        sk)
            echo "sk"
            ;;
        sl | sl-SI)
            echo "sl"
            ;;
        sv)
            echo "sv"
            ;;
        sw)
            echo "sw"
            ;;
        ta | ta-IN)
            echo "ta"
            ;;
        te | te-IN)
            echo "te"
            ;;
        th)
            echo "th"
            ;;
        tr)
            echo "tr"
            ;;
        uk)
            echo "uk"
            ;;
        ur | ur-PK)
            echo "ur"
            ;;
        vi)
            echo "vi"
            ;;
        zu)
            echo "zu"
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
        --list-ipad-locales)
            print_ipad_locales
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

if [[ "${#positional_arguments[@]}" -lt 3 ]]; then
    print_usage
    exit 1
fi

test_identifier="${positional_arguments[0]}"
description="${positional_arguments[1]}"
expected_screenshot_indices=("${positional_arguments[@]:2}")
cleanup_test_identifier="MarketingScreenshotsTests/testCleanupMarketingGuestSession"

localization_code="$(resolve_requested_locale "$requested_locale")"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project_path="$repo_root/apps/ios/Flashcards/Flashcards Open Source App.xcodeproj"
scheme_name="Flashcards Open Source App"
derived_data_path="$repo_root/tmp/ios-derived-data"
runtime_configuration_path="/tmp/flashcards-open-source-app-ios-marketing-screenshot-config.json"
capture_directory=""
captured_screenshot_paths=()
capture_complete=false

list_booted_simulator_lines() {
    xcrun simctl list devices booted | sed -nE '/^[[:space:]]+.+ \([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\) \(Booted\)[[:space:]]*$/p'
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

run_ios_marketing_xcodebuild_test() {
    local selected_test_identifier="$1"

    FLASHCARDS_INCLUDE_MANUAL_SCREENSHOT_TESTS=true \
    FLASHCARDS_MARKETING_SCREENSHOT_OUTPUT_DIRECTORY="$capture_directory" \
    FLASHCARDS_MARKETING_SCREENSHOT_LOCALIZATION="$localization_code" \
    xcodebuild \
      -project "$project_path" \
      -scheme "$scheme_name" \
      -derivedDataPath "$derived_data_path" \
      -destination "platform=iOS Simulator,id=$simulator_id" \
      "-only-testing:Flashcards Open Source App UI Tests/$selected_test_identifier" \
      test
}

run_ios_marketing_guest_cleanup() {
    echo "Running iOS marketing screenshot guest cleanup."
    run_ios_marketing_xcodebuild_test "$cleanup_test_identifier"
}

publish_captured_screenshots() {
    local array_index
    local screenshot_index
    local captured_path
    local file_name

    for array_index in "${!expected_screenshot_indices[@]}"; do
        screenshot_index="${expected_screenshot_indices[$array_index]}"
        captured_path="${captured_screenshot_paths[$array_index]}"
        file_name="$(basename "$captured_path")"
        if ! mv "$captured_path" "$output_directory/$file_name"; then
            echo "ERROR: Could not publish screenshot $captured_path to $output_directory/$file_name." >&2
            return 1
        fi
        if ! find "$output_directory" -maxdepth 1 -type f \
            -name "${localization_code}-${screenshot_index}_*.png" \
            ! -name "$file_name" -exec rm -f {} +; then
            echo "ERROR: Could not remove obsolete screenshot slugs for locale $localization_code, index $screenshot_index." >&2
            return 1
        fi
        echo "Saved screenshot to $output_directory/$file_name"
    done
}

cleanup_on_exit() {
    local exit_status="$?"

    set +e
    run_ios_marketing_guest_cleanup
    local cleanup_status="$?"
    cleanup_runtime_configuration
    local configuration_cleanup_status="$?"

    if [[ "$cleanup_status" -ne 0 ]]; then
        echo "ERROR: iOS marketing screenshot guest cleanup failed; captured screenshots will not be published." >&2
        if [[ "$exit_status" -eq 0 ]]; then
            exit_status="$cleanup_status"
        fi
    fi
    if [[ "$configuration_cleanup_status" -ne 0 ]]; then
        echo "ERROR: Could not remove runtime configuration $runtime_configuration_path; captured screenshots will not be published." >&2
        if [[ "$exit_status" -eq 0 ]]; then
            exit_status="$configuration_cleanup_status"
        fi
    fi

    if [[ "$exit_status" -eq 0 && "$capture_complete" == true ]]; then
        publish_captured_screenshots
        exit_status="$?"
    fi
    if ! rm -rf "$capture_directory"; then
        echo "ERROR: Could not remove iOS marketing screenshot staging directory $capture_directory." >&2
        if [[ "$exit_status" -eq 0 ]]; then
            exit_status=1
        fi
    fi

    exit "$exit_status"
}

resolve_booted_simulator_id() {
    if [[ -n "${FLASHCARDS_IOS_SIMULATOR_ID:-}" ]]; then
        echo "$FLASHCARDS_IOS_SIMULATOR_ID"
        return
    fi

    local booted_ids_output
    local line
    local -a booted_ids=()
    booted_ids_output="$(
        list_booted_simulator_lines | sed -nE 's/^.*\(([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\) \(Booted\)[[:space:]]*$/\1/p'
    )"
    booted_ids=()
    while IFS= read -r line; do
        [[ -n "$line" ]] && booted_ids+=("$line")
    done <<< "${booted_ids_output}"

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

    echo "$simulator_line" | sed -E 's/^[[:space:]]*//; s/[[:space:]]+\([^)]*\)[[:space:]]+\(Booted\)[[:space:]]*$//'
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

resolve_screenshot_path_for_index() {
    local output_directory="$1"
    local localization_code="$2"
    local screenshot_index="$3"

    if [[ ! "$screenshot_index" =~ ^[0-9]+$ ]]; then
        echo "Expected numeric screenshot index, got: $screenshot_index" >&2
        exit 1
    fi

    local -a matching_paths=()
    local matching_paths_output
    local line
    matching_paths_output="$(
        find "$output_directory" \
            -maxdepth 1 \
            -type f \
            -name "${localization_code}-${screenshot_index}_*.png" \
            -print | sort
    )"
    matching_paths=()
    while IFS= read -r line; do
        [[ -n "$line" ]] && matching_paths+=("$line")
    done <<< "${matching_paths_output}"

    if [[ "${#matching_paths[@]}" -eq 0 ]]; then
        echo "Expected screenshot file from the current run matching $output_directory/${localization_code}-${screenshot_index}_*.png." >&2
        exit 1
    fi

    if [[ "${#matching_paths[@]}" -gt 1 ]]; then
        echo "Expected exactly one screenshot file for locale '$localization_code' and index '$screenshot_index' in $output_directory." >&2
        printf 'Matching files:\n' >&2
        printf '%s\n' "${matching_paths[@]}" >&2
        exit 1
    fi

    echo "${matching_paths[0]}"
}

simulator_id="$(resolve_booted_simulator_id)"
simulator_name="$(resolve_simulator_name "$simulator_id")"
device_family="$(resolve_device_family "$simulator_name")"

if [[ "$device_family" == "ipad" ]] && is_iphone_only_locale "$localization_code"; then
    echo "Capture tag '$localization_code' is iPhone-only and has no $device_family screenshots." >&2
    echo "Boot an iPhone simulator, or capture the $device_family tags from --list-ipad-locales." >&2
    exit 1
fi

output_directory="$repo_root/apps/ios/docs/media/app-store-screenshots/$device_family"

mkdir -p "$output_directory"
mkdir -p "$repo_root/tmp"
capture_directory="$(mktemp -d "$repo_root/tmp/ios-marketing-capture.XXXXXX")"
trap cleanup_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
write_runtime_configuration "$capture_directory" "$localization_code"

echo "Running manual iOS marketing screenshot script for $description on $simulator_name."
echo "Locale: $localization_code"
xcrun simctl bootstatus "$simulator_id" -b

run_ios_marketing_guest_cleanup
run_ios_marketing_xcodebuild_test "$test_identifier"

for screenshot_index in "${expected_screenshot_indices[@]}"; do
    output_path="$(resolve_screenshot_path_for_index "$capture_directory" "$localization_code" "$screenshot_index")"
    captured_screenshot_paths+=("$output_path")
done
capture_complete=true
