#!/usr/bin/env bash

set -euo pipefail

locale_prefix="${1:-}"

if [[ -z "$locale_prefix" ]]; then
    echo "Usage: $0 <locale-prefix>" >&2
    exit 1
fi

if [[ "$(adb get-state 2>/dev/null)" != "device" ]]; then
    echo "No Android device or emulator is connected." >&2
    exit 1
fi

case "$locale_prefix" in
    en)
        device_locale="en-US"
        ;;
    ar)
        device_locale="ar-EG"
        ;;
    zh-CN)
        device_locale="zh-Hans-CN"
        ;;
    *)
        device_locale="$locale_prefix"
        ;;
esac

adb shell cmd locale set-device-locale "$device_locale" >/dev/null

for _ in $(seq 1 20); do
    current_locale="$(adb shell cmd locale get-device-locale 2>/dev/null | tr -d '\r')"
    if [[ "$current_locale" == "$device_locale" ]]; then
        sleep 5
        exit 0
    fi
    sleep 1
done

echo "Timed out while waiting for device locale '$device_locale'." >&2
exit 1
