#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
locales=("en-US" "ar" "zh-CN" "de-DE" "hi-IN" "ja-JP" "ru-RU" "es-419" "es-ES" "es-US")

cd "$repo_root"

for locale in "${locales[@]}"; do
    bash "$repo_root/scripts/export-android-feature-graphic.sh" "$locale"
done
