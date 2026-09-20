#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
locales=("en-US" "ar" "zh-CN" "fr-FR" "de-DE" "hi-IN" "ja-JP" "pt-BR" "ru-RU" "es-419" "es-ES" "es-US" "bg" "bn-BD" "ca" "cs-CZ" "da-DK" "el-GR" "et" "fa" "fi-FI" "gu" "iw-IL" "hr" "hu-HU" "id" "is-IS" "it-IT" "kn-IN" "ko-KR" "lt" "lv" "ml-IN" "mr-IN" "nl-NL" "no-NO" "pa" "pl-PL" "ro" "sk" "sl" "sv-SE" "sw" "ta-IN" "te-IN" "th" "tr-TR" "uk" "ur" "vi" "zu")

cd "$repo_root"

for locale in "${locales[@]}"; do
    bash "$repo_root/scripts/android/export-android-feature-graphic.sh" "$locale"
done
