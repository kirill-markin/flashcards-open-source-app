#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
marketing_background_color="rgb(31,31,31)"
marketing_margin_px="120"
marketing_output_root="$repo_root/apps/ios/docs/media/marketing-materials"
raw_screenshot_root="$repo_root/apps/ios/docs/media/app-store-screenshots"

print_usage() {
    cat <<'EOF' >&2
Usage:
  build-ios-marketing-materials.sh [--all-locales | --locale <code>] [--family <iphone|ipad>] [--skip-screenshots] [--optimization-mode <visually-lossless|lossless|none>]
  build-ios-marketing-materials.sh --list-locales

What it does:
  1. Optionally regenerates the raw localized iOS App Store screenshots.
  2. Builds one horizontal marketing PNG per locale from screenshots 1, 2, 3, and 4.
  3. Optimizes the generated PNG files.

Locale selection:
  --all-locales      Build every supported locale. This is the default if no locale flag is passed.
  --locale <code>    Build one locale. Supported canonical locales match the raw screenshot pipeline.

Family selection:
  --family <value>   Required with --skip-screenshots. Optional otherwise; when omitted, the script derives the family from the currently booted simulator.

Optimization:
  visually-lossless  Use pngquant with a high-quality range. Best size reduction for UI-heavy PNGs.
  lossless           Re-encode PNG without changing pixels. Smaller gain, but strictly lossless.
  none               Skip post-processing.

Environment:
  FLASHCARDS_MARKETING_SCREENSHOT_LOCALE   Forwarded through the raw screenshot wrappers when --locale is omitted.
  FLASHCARDS_IOS_SIMULATOR_ID              Booted simulator device UUID for screenshot capture.
EOF
}

print_supported_locales() {
    "$repo_root/scripts/capture-ios-marketing-screenshot.sh" --list-locales
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

ensure_command_exists() {
    local command_name="$1"

    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Required command is not installed: $command_name" >&2
        exit 1
    fi
}

list_booted_simulator_lines() {
    xcrun simctl list devices booted | sed -nE '/^[[:space:]]+.+ \([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\) \(Booted\)[[:space:]]*$/p'
}

resolve_booted_simulator_id() {
    if [[ -n "${FLASHCARDS_IOS_SIMULATOR_ID:-}" ]]; then
        echo "$FLASHCARDS_IOS_SIMULATOR_ID"
        return
    fi

    mapfile -t booted_ids < <(
        list_booted_simulator_lines | sed -nE 's/^.*\(([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\) \(Booted\)[[:space:]]*$/\1/p'
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
    local simulator_line=""

    simulator_line="$(list_booted_simulator_lines | rg -F "($simulator_id) (Booted)" | head -n 1 || true)"

    if [[ -z "$simulator_line" ]]; then
        echo "Failed to resolve the booted simulator line for $simulator_id." >&2
        exit 1
    fi

    echo "$simulator_line" | sed -E 's/^[[:space:]]*//; s/[[:space:]]+\([^)]*\)[[:space:]]+\(Booted\)[[:space:]]*$//'
}

resolve_device_family_from_simulator_name() {
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

resolve_requested_family() {
    local requested_family="$1"
    local should_capture_screenshots="$2"

    if [[ -n "$requested_family" && "$requested_family" != "iphone" && "$requested_family" != "ipad" ]]; then
        echo "Unsupported family: $requested_family" >&2
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

    simulator_id="$(resolve_booted_simulator_id)"
    simulator_name="$(resolve_simulator_name "$simulator_id")"
    inferred_family="$(resolve_device_family_from_simulator_name "$simulator_name")"

    if [[ -n "$requested_family" && "$requested_family" != "$inferred_family" ]]; then
        echo "Requested family '$requested_family' does not match the booted simulator family '$inferred_family'." >&2
        exit 1
    fi

    echo "$inferred_family"
}

resolve_requested_locales() {
    local use_all_locales="$1"
    local requested_locale="$2"
    local canonical_locale=""

    if [[ "$use_all_locales" == "true" && -n "$requested_locale" ]]; then
        echo "Pass either --all-locales or --locale, not both." >&2
        exit 1
    fi

    if [[ -n "$requested_locale" ]]; then
        if ! canonical_locale="$(canonicalize_locale "$requested_locale")"; then
            echo "Unsupported iOS marketing screenshot locale: $requested_locale" >&2
            echo "Supported locales: $(print_supported_locales | tr '\n' ' ' | sed -E 's/[[:space:]]+$//')" >&2
            exit 1
        fi

        printf '%s\n' "$canonical_locale"
        return
    fi

    print_supported_locales
}

resolve_screenshot_paths() {
    local family="$1"
    local locale="$2"

    local -a screenshot_paths=(
        "$raw_screenshot_root/$family/${locale}-1_review-card-front-app-store-opportunity-cost.png"
        "$raw_screenshot_root/$family/${locale}-2_review-card-result-app-store-opportunity-cost.png"
        "$raw_screenshot_root/$family/${locale}-3_cards-list-app-store-vocabulary.png"
        "$raw_screenshot_root/$family/${locale}-4_review-card-ai-draft-app-store-opportunity-cost.png"
    )

    local screenshot_path=""
    for screenshot_path in "${screenshot_paths[@]}"; do
        if [[ ! -f "$screenshot_path" ]]; then
            echo "Expected raw screenshot file at $screenshot_path" >&2
            exit 1
        fi
    done

    printf '%s\n' "${screenshot_paths[@]}"
}

capture_raw_screenshots_for_locale() {
    local locale="$1"

    echo "Capturing raw review screenshots for locale $locale"
    "$repo_root/scripts/capture-ios-review-screenshots.sh" --locale "$locale"

    echo "Capturing raw cards screenshot for locale $locale"
    "$repo_root/scripts/capture-ios-cards-screenshot.sh" --locale "$locale"
}

compose_marketing_material() {
    local output_path="$1"
    shift
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
            if [[ $# -eq 0 ]]; then
                echo "Missing value after --locale." >&2
                exit 1
            fi
            requested_locale="$1"
            shift
            ;;
        --locale=*)
            requested_locale="${1#*=}"
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
            print_supported_locales
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

ensure_command_exists "magick"

resolved_family="$(resolve_requested_family "$requested_family" "$should_capture_screenshots")"

if [[ "$use_all_locales" == "false" && -z "$requested_locale" ]]; then
    use_all_locales="true"
fi

mapfile -t resolved_locales < <(resolve_requested_locales "$use_all_locales" "$requested_locale")

output_directory="$marketing_output_root/$resolved_family"
mkdir -p "$output_directory"

for locale in "${resolved_locales[@]}"; do
    if [[ "$should_capture_screenshots" == "true" ]]; then
        capture_raw_screenshots_for_locale "$locale"
    fi

    mapfile -t screenshot_paths < <(resolve_screenshot_paths "$resolved_family" "$locale")
    output_path="$output_directory/${locale}-1-2-3-4-horizontal-dark-gray.png"

    echo "Building marketing material for locale $locale"
    compose_marketing_material "$output_path" "${screenshot_paths[@]}"
    optimize_marketing_material "$output_path" "$requested_optimization_mode"
    echo "Saved marketing material to $output_path"
done
