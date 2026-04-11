#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 1 ]]; then
    echo "Usage: bash scripts/export-android-feature-graphic.sh <locale>" >&2
    exit 1
fi

locale="$1"
supported_locales=("en-US" "ar" "zh-CN" "de-DE" "hi-IN" "ja-JP" "ru-RU" "es-419" "es-ES" "es-US")
is_supported="false"

for supported_locale in "${supported_locales[@]}"; do
    if [[ "$supported_locale" == "$locale" ]]; then
        is_supported="true"
        break
    fi
done

if [[ "$is_supported" != "true" ]]; then
    echo "Unsupported locale: $locale" >&2
    echo "Supported locales: ${supported_locales[*]}" >&2
    exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template_path="$repo_root/apps/android/docs/media/play-store-feature-graphic/index.html"
output_path="$repo_root/apps/android/docs/media/play-store-feature-graphic/$locale-feature-graphic.png"
template_url="file://$template_path?locale=$locale"

cd "$repo_root"

npx --yes playwright screenshot \
  --browser=chromium \
  --channel=chrome \
  --viewport-size="1024,500" \
  --wait-for-selector=".canvas[data-ready=\"true\"]" \
  "$template_url" \
  "$output_path"

pixel_width="$(sips -g pixelWidth "$output_path" | awk '/pixelWidth/ { print $2 }')"
pixel_height="$(sips -g pixelHeight "$output_path" | awk '/pixelHeight/ { print $2 }')"

if [[ "$pixel_width" != "1024" || "$pixel_height" != "500" ]]; then
    echo "Exported feature graphic has unexpected size: ${pixel_width}x${pixel_height}" >&2
    exit 1
fi

echo "Saved feature graphic to $output_path"
