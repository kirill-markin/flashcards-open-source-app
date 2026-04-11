#!/usr/bin/env bash

set -euo pipefail

device_serial="${1:-}"

if [[ -z "$device_serial" ]]; then
    if [[ "$(adb get-state 2>/dev/null)" != "device" ]]; then
        exit 0
    fi
    device_serial="$(adb devices | awk '/^emulator-|^[^[:space:]]+[[:space:]]+device$/{print $1; exit}')"
fi

if [[ -z "$device_serial" ]]; then
    exit 0
fi

wait_for_dialog_to_clear() {
    local xml_dump="$1"
    if ! printf '%s' "$xml_dump" | rg -q "isn't responding|android:id/aerr_wait"; then
        return 0
    fi
    return 1
}

tap_wait_if_present() {
    local xml_dump="$1"
    local bounds
    bounds="$(
        printf '%s' "$xml_dump" | tr '\n' ' ' | perl -ne '
            if (/resource-id="android:id\/aerr_wait".*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) {
                print "$1 $2 $3 $4";
                exit;
            }
        '
    )"

    if [[ -z "$bounds" ]]; then
        return 1
    fi

    local left top right bottom center_x center_y
    read -r left top right bottom <<<"$bounds"
    center_x=$(((left + right) / 2))
    center_y=$(((top + bottom) / 2))
    adb -s "$device_serial" shell input tap "$center_x" "$center_y" >/dev/null 2>&1
    return 0
}

for _ in $(seq 1 8); do
    xml_dump="$(adb -s "$device_serial" exec-out uiautomator dump /dev/tty 2>/dev/null || true)"
    if wait_for_dialog_to_clear "$xml_dump"; then
        exit 0
    fi

    if tap_wait_if_present "$xml_dump"; then
        sleep 4
        continue
    fi

    sleep 2
done

exit 0
