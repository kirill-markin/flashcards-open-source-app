#!/usr/bin/env bash

set -euo pipefail

# shellcheck source=scripts/ios/marketing-screenshot-preflight.sh
source "$(dirname "${BASH_SOURCE[0]}")/marketing-screenshot-preflight.sh"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
marketing_background_color="rgb(31,31,31)"
marketing_margin_px="120"
marketing_output_root="$repo_root/apps/ios/docs/media/marketing-materials"
raw_screenshot_root="$repo_root/apps/ios/docs/media/app-store-screenshots"

print_usage() {
    cat <<'EOF' >&2
Usage:
  build-ios-marketing-materials.sh [--all-locales | --locale <code>] [--family <iphone|ipad|iphone-duo-outer|iphone-duo-inner>] [--duo-display outer|inner] [--skip-screenshots] [--optimization-mode <visually-lossless|lossless|none>]
  build-ios-marketing-materials.sh --list-locales
  build-ios-marketing-materials.sh --list-ipad-locales

What it does:
  1. Optionally regenerates the raw localized iOS App Store screenshots.
  2. Builds one horizontal marketing PNG per locale from screenshots 1, 2, 3, 4, and 5.
  3. Optimizes the generated PNG files.

Locale selection:
  --all-locales      Build every capture tag of the resolved family, or every saved set with --skip-screenshots.
                     This is the default if no locale flag is passed. Incomplete and duplicate sets fail.
  --locale <code>    Build one locale. Supported canonical locales match the raw screenshot pipeline.

Locale discovery:
  --list-locales       Print every capture tag, which is the iPhone family list.
  --list-ipad-locales  Print the iPad family list, without the iPhone-only capture tags.

Family selection:
  --family <value>   Required with --skip-screenshots. Optional otherwise; when omitted, the script derives the family from the currently booted simulator.
  --duo-display <outer|inner>  Required for Duo composition, which uses --skip-screenshots and matching --family.

Optimization:
  visually-lossless  Use pngquant with a high-quality range. Best size reduction for UI-heavy PNGs.
  lossless           Re-encode PNG without changing pixels. Smaller gain, but strictly lossless.
  none               Skip post-processing.

Environment:
  FLASHCARDS_MARKETING_SCREENSHOT_LOCALE   Forwarded through the raw screenshot wrappers when --locale is omitted.
  FLASHCARDS_IOS_SIMULATOR_ID              Booted simulator device UUID for screenshot capture.
EOF
}

ensure_command_exists() {
    local command_name="$1"

    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Required command is not installed: $command_name" >&2
        exit 1
    fi
}

resolve_requested_family() {
    local requested_family="$1"
    local should_capture_screenshots="$2"
    local simulator_override="$3"
    local duo_display="$4"

    if [[ -n "$requested_family" && "$requested_family" != "iphone" && "$requested_family" != "ipad" && "$requested_family" != "iphone-duo-outer" && "$requested_family" != "iphone-duo-inner" ]]; then
        echo "Unsupported family: $requested_family" >&2
        exit 1
    fi

    if [[ "$requested_family" == iphone-duo-* ]]; then
        if [[ "$requested_family" != "iphone-duo-$duo_display" ]]; then
            echo "Family '$requested_family' requires matching --duo-display outer|inner." >&2
            exit 1
        fi
    elif [[ -n "$duo_display" && "$should_capture_screenshots" == "false" ]]; then
        echo "--duo-display requires a matching Duo --family when --skip-screenshots is used." >&2
        exit 1
    fi

    if [[ "$should_capture_screenshots" == "false" ]]; then
        if [[ -z "$requested_family" ]]; then
            echo "The --family flag is required when --skip-screenshots is used." >&2
            exit 1
        fi

        echo "$requested_family"
        return
    fi

    local simulator_id=""
    local simulator_name=""
    local inferred_family=""

    simulator_id="$(resolve_booted_simulator_id "$simulator_override")"
    simulator_name="$(resolve_simulator_name "$simulator_id")"
    inferred_family="$(resolve_device_family "$simulator_name" "$duo_display")"

    if [[ -n "$requested_family" && "$requested_family" != "$inferred_family" ]]; then
        echo "Requested family '$requested_family' does not match the booted simulator family '$inferred_family'." >&2
        exit 1
    fi

    echo "$inferred_family"
}

resolve_requested_locales() {
    local family="$1"
    local use_all_locales="$2"
    local requested_locale="$3"
    local canonical_locale=""

    if [[ "$use_all_locales" == "true" && -n "$requested_locale" ]]; then
        echo "Pass either --all-locales or --locale, not both." >&2
        exit 1
    fi

    local family_locales_output=""
    family_locales_output="$(print_locales_for_family "$family")"

    if [[ -n "$requested_locale" ]]; then
        if ! canonical_locale="$(canonicalize_locale "$requested_locale")"; then
            echo "Unsupported iOS marketing screenshot locale: $requested_locale" >&2
            echo "Supported $family locales: $(printf '%s' "$family_locales_output" | tr '\n' ' ' | sed -E 's/[[:space:]]+$//')" >&2
            exit 1
        fi

        if ! is_locale_eligible_for_family "$canonical_locale" "$family"; then
            echo "Locale '$canonical_locale' is an iPhone-only capture tag and has no $family screenshots." >&2
            exit 1
        fi

        printf '%s\n' "$canonical_locale"
        return
    fi

    printf '%s\n' "$family_locales_output"
}

resolve_screenshot_paths() {
    local family="$1"
    local locale="$2"

    local screenshot_directory="$raw_screenshot_root/$family"
    if [[ ! -d "$screenshot_directory" ]]; then
        echo "Missing native $family screenshot folder: $screenshot_directory" >&2
        return 1
    fi
    local paths_output
    paths_output="$(find "$screenshot_directory" -maxdepth 1 -type f -name "${locale}-[1-5]_*.png" -print | sort)" || return
    if [[ -z "$paths_output" ]]; then
        return
    fi

    local -a screenshot_paths=()
    local screenshot_index=""
    local -a matching_paths=()

    local line
    for screenshot_index in 1 2 3 4 5; do
        matching_paths=()
        while IFS= read -r line; do
            if [[ "$line" == */"${locale}-${screenshot_index}_"*.png ]]; then
                matching_paths+=("$line")
            fi
        done <<< "$paths_output"

        if [[ "${#matching_paths[@]}" -eq 0 ]]; then
            echo "Expected raw screenshot file matching $screenshot_directory/${locale}-${screenshot_index}_*.png" >&2
            exit 1
        fi

        if [[ "${#matching_paths[@]}" -gt 1 ]]; then
            echo "Expected exactly one raw screenshot file for locale '$locale' and index '$screenshot_index' in $screenshot_directory." >&2
            printf 'Matching files:\n' >&2
            printf '%s\n' "${matching_paths[@]}" >&2
            exit 1
        fi

        screenshot_paths+=("${matching_paths[0]}")
    done

    printf '%s\n' "${screenshot_paths[@]}"
}

list_saved_locales() {
    local family="$1"
    local locales="$2"
    local locale=""
    local paths=""
    while IFS= read -r locale; do
        paths="$(resolve_screenshot_paths "$family" "$locale")" || return
        if [[ -n "$paths" ]]; then
            printf '%s\n' "$locale"
        fi
    done <<< "$locales"
}

capture_raw_screenshots_for_locale() {
    local locale="$1"

    echo "Capturing raw marketing screenshots for locale $locale"
    bash "$repo_root/scripts/ios/capture-ios-marketing-screenshots.sh" --locale "$locale"
}

compose_marketing_material() {
    local output_path="$1"
    local family="$2"
    shift 2
    local -a screenshot_paths=("$@")

    if [[ "${#screenshot_paths[@]}" -eq 0 ]]; then
        echo "No screenshot paths were provided for marketing material composition." >&2
        exit 1
    fi

    local screenshot_dimensions=""
    local screenshot_width=""
    local screenshot_height=""

    screenshot_dimensions="$(magick identify -format '%w %h' "${screenshot_paths[0]}")"
    read -r screenshot_width screenshot_height <<< "$screenshot_dimensions"

    local screenshot_path=""
    local current_dimensions=""
    local current_width=""
    local current_height=""
    for screenshot_path in "${screenshot_paths[@]}"; do
        current_dimensions="$(magick identify -format '%w %h' "$screenshot_path")"
        read -r current_width current_height <<< "$current_dimensions"

        if [[ "$current_width" != "$screenshot_width" || "$current_height" != "$screenshot_height" ]]; then
            echo "All screenshots must have the same dimensions. Expected ${screenshot_width}x${screenshot_height}, got ${current_width}x${current_height} for $screenshot_path" >&2
            exit 1
        fi

        if [[ "$family" == iphone-duo-outer && "${current_width}x${current_height}" != "1398x2034" ]] ||
           [[ "$family" == iphone-duo-inner && "${current_width}x${current_height}" != "2853x2007" ]]; then
            echo "Wrong raw Duo dimensions for $screenshot_path: got ${current_width}x${current_height} for $family." >&2
            exit 1
        fi
    done

    local screenshot_count="${#screenshot_paths[@]}"
    local canvas_width=$((screenshot_width * screenshot_count + marketing_margin_px * (screenshot_count + 1)))
    local canvas_height=$((screenshot_height + marketing_margin_px * 2))

    local -a compose_arguments=(
        magick
        -size "${canvas_width}x${canvas_height}"
        "xc:${marketing_background_color}"
    )

    local screenshot_index=0
    local x_position=""
    for screenshot_path in "${screenshot_paths[@]}"; do
        x_position=$((marketing_margin_px + screenshot_index * (screenshot_width + marketing_margin_px)))
        compose_arguments+=(
            "$screenshot_path"
            -geometry "+${x_position}+${marketing_margin_px}"
            -composite
        )
        screenshot_index=$((screenshot_index + 1))
    done

    compose_arguments+=("$output_path")
    "${compose_arguments[@]}"
}

optimize_marketing_material() {
    local output_path="$1"
    local optimization_mode="$2"

    case "$optimization_mode" in
        visually-lossless)
            ensure_command_exists "pngquant"
            pngquant --force --skip-if-larger --quality=85-98 --speed 1 --output "$output_path" "$output_path"
            ;;
        lossless)
            local temporary_path=""
            local original_size=""
            local optimized_size=""

            temporary_path="$(mktemp -t flashcards-open-source-app-ios-marketing-materials-lossless).png"
            magick "$output_path" \
                -strip \
                -define png:compression-level=9 \
                -define png:compression-filter=5 \
                -define png:compression-strategy=1 \
                "$temporary_path"

            original_size="$(stat -f '%z' "$output_path")"
            optimized_size="$(stat -f '%z' "$temporary_path")"

            if (( optimized_size < original_size )); then
                mv "$temporary_path" "$output_path"
            else
                rm -f "$temporary_path"
            fi
            ;;
        none)
            ;;
        *)
            echo "Unsupported optimization mode: $optimization_mode" >&2
            exit 1
            ;;
    esac
}

requested_locale=""
requested_family=""
requested_duo_display=""
requested_optimization_mode="visually-lossless"
should_capture_screenshots="true"
use_all_locales="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --all-locales)
            use_all_locales="true"
            shift
            ;;
        --locale)
            shift
            if [[ $# -eq 0 || -z "$1" ]]; then
                echo "Missing value after --locale." >&2
                exit 1
            fi
            requested_locale="$1"
            shift
            ;;
        --locale=*)
            requested_locale="${1#*=}"
            if [[ -z "$requested_locale" ]]; then
                echo "Missing value after --locale=." >&2
                exit 1
            fi
            shift
            ;;
        --family)
            shift
            if [[ $# -eq 0 ]]; then
                echo "Missing value after --family." >&2
                exit 1
            fi
            requested_family="$1"
            shift
            ;;
        --family=*)
            requested_family="${1#*=}"
            shift
            ;;
        --duo-display)
            shift
            if [[ $# -eq 0 ]]; then
                echo "Missing value after --duo-display." >&2
                exit 1
            fi
            requested_duo_display="$1"
            shift
            ;;
        --duo-display=*)
            requested_duo_display="${1#*=}"
            shift
            ;;
        --optimization-mode)
            shift
            if [[ $# -eq 0 ]]; then
                echo "Missing value after --optimization-mode." >&2
                exit 1
            fi
            requested_optimization_mode="$1"
            shift
            ;;
        --optimization-mode=*)
            requested_optimization_mode="${1#*=}"
            shift
            ;;
        --skip-screenshots)
            should_capture_screenshots="false"
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
            echo "Unknown argument: $1" >&2
            print_usage
            exit 1
            ;;
    esac
done

if [[ -n "$requested_duo_display" && "$requested_duo_display" != outer && "$requested_duo_display" != inner ]]; then
    echo "Unsupported Duo display: $requested_duo_display. Use outer or inner." >&2
    exit 1
fi

ensure_command_exists "magick"

resolved_family="$(resolve_requested_family "$requested_family" "$should_capture_screenshots" "${FLASHCARDS_IOS_SIMULATOR_ID:-}" "$requested_duo_display")"
if [[ "$resolved_family" == iphone-duo-* && "$should_capture_screenshots" == "true" ]]; then
    echo "Capture Duo screenshots explicitly first, then run this builder with --skip-screenshots, matching --family, and --duo-display." >&2
    exit 1
fi

if [[ "$use_all_locales" == "false" && -z "$requested_locale" ]]; then
    use_all_locales="true"
fi

resolved_locales_output="$(resolve_requested_locales "$resolved_family" "$use_all_locales" "$requested_locale")"
if [[ "$should_capture_screenshots" == "false" && -z "$requested_locale" ]]; then
    resolved_locales_output="$(list_saved_locales "$resolved_family" "$resolved_locales_output")"
    if [[ -z "$resolved_locales_output" ]]; then
        echo "No saved $resolved_family screenshot sets under $raw_screenshot_root/$resolved_family." >&2
        exit 1
    fi
fi
resolved_locales=()
while IFS= read -r line; do
    [[ -n "$line" ]] && resolved_locales+=("$line")
done <<< "${resolved_locales_output}"

output_directory="$marketing_output_root/$resolved_family"
mkdir -p "$output_directory"

for locale in "${resolved_locales[@]}"; do
    if [[ "$should_capture_screenshots" == "true" ]]; then
        capture_raw_screenshots_for_locale "$locale"
    fi

    screenshot_paths_output="$(resolve_screenshot_paths "$resolved_family" "$locale")"
    if [[ -z "$screenshot_paths_output" ]]; then
        echo "No saved screenshots for $resolved_family/$locale under $raw_screenshot_root/$resolved_family. Capture the selected five-shot set first." >&2
        exit 1
    fi
    screenshot_paths=()
    while IFS= read -r line; do
        [[ -n "$line" ]] && screenshot_paths+=("$line")
    done <<< "${screenshot_paths_output}"
    output_path="$output_directory/${locale}-1-2-3-4-5-horizontal-dark-gray.png"

    echo "Building marketing material for locale $locale"
    compose_marketing_material "$output_path" "$resolved_family" "${screenshot_paths[@]}"
    optimize_marketing_material "$output_path" "$requested_optimization_mode"
    echo "Saved marketing material to $output_path"
done
