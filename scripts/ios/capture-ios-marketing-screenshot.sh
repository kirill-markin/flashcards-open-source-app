#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=scripts/ios/marketing-screenshot-preflight.sh
source "$(dirname "${BASH_SOURCE[0]}")/marketing-screenshot-preflight.sh"

print_usage() {
    cat <<'EOF' >&2
Usage:
  capture-ios-marketing-screenshot.sh [--locale <code>] [--orientation portrait|landscape] [--duo-display outer|inner] <test_identifier> <description> <screenshot_index> [<screenshot_index> ...]
  capture-ios-marketing-screenshot.sh --list-locales
  capture-ios-marketing-screenshot.sh --list-ipad-locales

Supported locales:
EOF
    printf '  %s\n' "${supported_locales[@]}" >&2
    cat <<'EOF' >&2

iPad and Duo locales are these locales without the iPhone-only capture tags. Print
them with --list-ipad-locales. Capturing an iPhone-only tag on either fails.

Environment:
  FLASHCARDS_MARKETING_SCREENSHOT_LOCALE   Canonical locale code or supported alias.
  FLASHCARDS_IOS_SIMULATOR_ID              Booted simulator device UUID.

For iPhone Duo, select the display in Device Hub before capture and pass
--duo-display outer or --duo-display inner. The wrapper verifies native pixels.
EOF
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
orientation="${FLASHCARDS_MARKETING_SCREENSHOT_ORIENTATION:-}"
duo_display=""
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
        --orientation)
            shift
            if [[ $# -eq 0 ]]; then
                echo "Missing value after --orientation." >&2
                exit 1
            fi
            orientation="$1"
            shift
            ;;
        --orientation=*)
            orientation="${1#*=}"
            shift
            ;;
        --duo-display)
            shift
            if [[ $# -eq 0 ]]; then
                echo "Missing value after --duo-display." >&2
                exit 1
            fi
            duo_display="$1"
            shift
            ;;
        --duo-display=*)
            duo_display="${1#*=}"
            shift
            ;;
        --list-locales)
            print_locales_for_family "iphone"
            exit 0
            ;;
        --list-ipad-locales)
            print_locales_for_family "ipad"
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
if [[ -n "$orientation" && "$orientation" != portrait && "$orientation" != landscape ]]; then
    echo "Unsupported screenshot orientation: $orientation" >&2
    exit 1
fi
if [[ -n "$duo_display" && "$duo_display" != outer && "$duo_display" != inner ]]; then
    echo "Unsupported Duo display: $duo_display. Use outer or inner." >&2
    exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
project_path="$repo_root/apps/ios/Flashcards/Flashcards Open Source App.xcodeproj"
scheme_name="Flashcards Open Source App"
derived_data_path="${FLASHCARDS_IOS_DERIVED_DATA_PATH:-$repo_root/tmp/ios-derived-data}"
runtime_configuration_path="/tmp/flashcards-open-source-app-ios-marketing-screenshot-config.json"
capture_directory=""
captured_screenshot_paths=()
capture_complete=false
host_capture_pid=""
host_capture_directory=""

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
    local duo_configuration=""
    if [[ -n "$host_capture_directory" ]]; then
        duo_configuration=",
  \"targetPixelWidth\": $duo_width,
  \"targetPixelHeight\": $duo_height,
  \"hostCaptureDirectoryPath\": \"$(escape_json_string "$host_capture_directory")\""
    fi

    cat >"$runtime_configuration_path" <<EOF
{
  "includeManualScreenshotTests": true,
  "outputDirectoryPath": "$(escape_json_string "$output_directory")",
  "localizationCode": "$(escape_json_string "$localization_code")",
  "orientation": "$orientation"$duo_configuration
}
EOF
}

duo_native_dimensions() {
    case "$device_family" in
        iphone-duo-outer) echo "1398x2034" ;;
        iphone-duo-inner) echo "2853x2007" ;;
        *) return 1 ;;
    esac
}

start_duo_host_capture() {
    [[ -n "$host_capture_directory" ]] || return 0
    python3 "$repo_root/scripts/ios/duo-host-screenshot-service.py" \
        "$simulator_id" "$duo_width" "$duo_height" "$host_capture_directory" &
    host_capture_pid="$!"
    local attempt
    for ((attempt = 0; attempt < 100; attempt++)); do
        [[ -f "$host_capture_directory/ready" ]] && return 0
        if ! kill -0 "$host_capture_pid" 2>/dev/null; then
            wait "$host_capture_pid" || true
            host_capture_pid=""
            echo "Duo host screenshot service failed to start. Check simulator Connected Screens and Device Hub pose." >&2
            return 1
        fi
        sleep 0.1
    done
    echo "Duo host screenshot service did not become ready within 10 seconds." >&2
    return 1
}

stop_duo_host_capture() {
    [[ -n "$host_capture_pid" ]] || return 0
    touch "$host_capture_directory/stop"
    local service_status=0
    wait "$host_capture_pid" || service_status="$?"
    host_capture_pid=""
    return "$service_status"
}

cleanup_runtime_configuration() {
    rm -f "$runtime_configuration_path"
}

run_ios_marketing_xcodebuild_test() {
    local selected_test_identifier="$1"
    local test_action="test"
    if [[ "${FLASHCARDS_IOS_MARKETING_TEST_WITHOUT_BUILDING:-0}" == 1 ]]; then
        test_action="test-without-building"
    fi

    FLASHCARDS_INCLUDE_MANUAL_SCREENSHOT_TESTS=true \
    FLASHCARDS_MARKETING_SCREENSHOT_OUTPUT_DIRECTORY="$capture_directory" \
    FLASHCARDS_MARKETING_SCREENSHOT_LOCALIZATION="$localization_code" \
    xcodebuild \
      -project "$project_path" \
      -scheme "$scheme_name" \
      -derivedDataPath "$derived_data_path" \
      -destination "platform=iOS Simulator,id=$simulator_id" \
      "-only-testing:Flashcards Open Source App UI Tests/$selected_test_identifier" \
      "$test_action"
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
    stop_duo_host_capture
    local host_capture_status="$?"
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
    if [[ "$host_capture_status" -ne 0 ]]; then
        echo "ERROR: Duo host screenshot service failed; captured screenshots will not be published." >&2
        if [[ "$exit_status" -eq 0 ]]; then
            exit_status="$host_capture_status"
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

verify_duo_screenshot_dimensions() {
    local screenshot_path="$1"
    local expected_dimensions=""
    local width=""
    local height=""

    [[ "$device_family" == iphone-duo-* ]] || return 0
    expected_dimensions="$(duo_native_dimensions)"

    width="$(sips -g pixelWidth "$screenshot_path" | sed -nE 's/^[[:space:]]*pixelWidth: ([0-9]+)$/\1/p')"
    height="$(sips -g pixelHeight "$screenshot_path" | sed -nE 's/^[[:space:]]*pixelHeight: ([0-9]+)$/\1/p')"
    if [[ "${width}x${height}" != "$expected_dimensions" ]]; then
        echo "Wrong active iPhone Duo display for $screenshot_path: expected $device_family $expected_dimensions, got ${width:-unknown}x${height:-unknown}. Select the matching display in Device Hub and recapture." >&2
        exit 1
    fi
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

simulator_id="$(resolve_booted_simulator_id "${FLASHCARDS_IOS_SIMULATOR_ID:-}")"
simulator_name="$(resolve_simulator_name "$simulator_id")"
device_family="$(resolve_device_family "$simulator_name" "$duo_display")"
if [[ -z "$orientation" ]]; then
    if [[ "$device_family" == ipad || "$device_family" == iphone-duo-inner ]]; then
        orientation="landscape"
    else
        orientation="portrait"
    fi
fi
if [[ "$device_family" == iphone-duo-outer && "$orientation" != portrait ]] ||
   [[ "$device_family" == iphone-duo-inner && "$orientation" != landscape ]]; then
    echo "$device_family requires its native display orientation." >&2
    exit 1
fi

if ! is_locale_eligible_for_family "$localization_code" "$device_family"; then
    echo "Capture tag '$localization_code' is iPhone-only and has no $device_family screenshots." >&2
    echo "Boot an iPhone simulator, or capture the $device_family tags from --list-ipad-locales." >&2
    exit 1
fi

if [[ "$device_family" == ipad && "$orientation" != landscape ]]; then
    echo "iPad marketing captures require landscape. Capture native landscape pixels." >&2
    exit 1
fi

output_directory="$repo_root/apps/ios/docs/media/app-store-screenshots/$device_family"
if [[ "$orientation" == landscape && "$device_family" != ipad && "$device_family" != iphone-duo-inner ]]; then
    echo "Landscape marketing captures are supported only on iPad and iPhone Duo inner; ordinary iPhone keeps its portrait policy." >&2
    exit 1
fi

mkdir -p "$output_directory"
mkdir -p "$repo_root/tmp"
capture_directory="$(mktemp -d "$repo_root/tmp/ios-marketing-capture.XXXXXX")"
trap cleanup_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ "$device_family" == iphone-duo-* ]]; then
    IFS=x read -r duo_width duo_height <<< "$(duo_native_dimensions)"
    host_capture_directory="$capture_directory/host-capture"
    mkdir -p "$host_capture_directory/requests" "$host_capture_directory/responses"
fi
write_runtime_configuration "$capture_directory" "$localization_code"

echo "Running manual iOS marketing screenshot script for $description on $simulator_name."
echo "Locale: $localization_code"
xcrun simctl bootstatus "$simulator_id" -b

run_ios_marketing_guest_cleanup
start_duo_host_capture
run_ios_marketing_xcodebuild_test "$test_identifier"

for screenshot_index in "${expected_screenshot_indices[@]}"; do
    output_path="$(resolve_screenshot_path_for_index "$capture_directory" "$localization_code" "$screenshot_index")"
    verify_duo_screenshot_dimensions "$output_path"
    captured_screenshot_paths+=("$output_path")
done
capture_complete=true
