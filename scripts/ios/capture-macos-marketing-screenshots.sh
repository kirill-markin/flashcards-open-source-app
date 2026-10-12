#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
locale="en-US"
all_locales=false
signing_xcconfig=""
mac_id=""
size="1440x900"
output_directory="$repo_root/apps/ios/docs/media/app-store-screenshots/macos"
derived_data_path="${FLASHCARDS_MACOS_MARKETING_DERIVED_DATA_PATH:-$repo_root/tmp/macos-marketing-derived-data}"
skip_build=false
runtime_configuration_path="/tmp/flashcards-open-source-app-macos-marketing-screenshot-config.json"
lock_directory="$runtime_configuration_path.lock"

usage() {
    echo "Usage: $0 --signing-xcconfig <external-file> --mac-id <registered-id> [--locale <Store-id-or-capture-tag> | --all-locales] [--size 1440x900] [--output-directory <path>] [--skip-build]"
    echo "       $0 --list-locales"
}

store_locales() {
    node --input-type=module - "$repo_root/scripts/ios/app-store-localization-inputs.mts" "$1" <<'JS'
import { pathToFileURL } from "node:url";
const { LOCALES } = await import(pathToFileURL(process.argv[2]).href);
const requested = process.argv[3];
if (requested === "list") console.log(LOCALES.map(([, , tag]) => tag).join("\n"));
else {
    const matching = LOCALES.find(([, store, tag]) => store === requested || tag === requested);
    if (!matching) throw new Error(`Unsupported Mac Store locale: ${requested}`);
    console.log(matching[2]);
}
JS
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --locale|--signing-xcconfig|--mac-id|--size|--output-directory)
            [[ $# -ge 2 ]] || { echo "Missing value for $1" >&2; exit 1; }
            case "$1" in
                --locale) locale="$2" ;;
                --signing-xcconfig) signing_xcconfig="$2" ;;
                --mac-id) mac_id="$2" ;;
                --size) size="$2" ;;
                --output-directory) output_directory="$2" ;;
            esac
            shift 2 ;;
        --all-locales) all_locales=true; shift ;;
        --skip-build) skip_build=true; shift ;;
        --list-locales) store_locales list; exit 0 ;;
        --help|-h) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
    esac
done
[[ -f "$signing_xcconfig" && -n "$mac_id" ]] || { usage; exit 1; }
case "$size" in 1280x800|1440x900|2560x1600|2880x1800) ;; *) echo "Unsupported native Mac window size: $size" >&2; exit 1 ;; esac
IFS=x read -r width height <<< "$size"
locales=()
if [[ "$all_locales" == true ]]; then
    locale_lines="$(store_locales list)"
    while IFS= read -r tag; do locales+=("$tag"); done <<< "$locale_lines"
else
    locales+=("$(store_locales "$locale")")
fi
mkdir -p "$repo_root/tmp" "$output_directory"
output_directory="$(cd "$output_directory" && pwd)"
mkdir "$lock_directory" || { echo "Another Mac capture owns $lock_directory. Do not remove it while that run is active." >&2; exit 1; }
run_directory="$(mktemp -d "$repo_root/tmp/macos-marketing-capture.XXXXXX")"
capture_directory=""
cleanup_needed=false
xctestrun=""

write_configuration() {
    python3 - "$runtime_configuration_path" "$capture_directory" "$locale" "$width" "$height" <<'PY'
import json, sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps(dict(includeManualScreenshotTests=True,
    outputDirectoryPath=sys.argv[2], localizationCode=sys.argv[3], orientation="landscape",
    targetPixelWidth=int(sys.argv[4]), targetPixelHeight=int(sys.argv[5]))))
PY
}

run_capture_test() {
    local identifier="$1"
    last_result_path="$run_directory/${locale}-${identifier##*/}-$(uuidgen).xcresult"
    xcodebuild -xctestrun "$xctestrun" \
        -destination "platform=macOS,variant=Mac Catalyst,id=$mac_id" \
        -resultBundlePath "$last_result_path" \
        "-only-testing:Flashcards Open Source App UI Tests/MarketingScreenshotsTests/$identifier" \
        test-without-building
}

cleanup_guest() {
    run_capture_test testCleanupMarketingGuestSession
}

on_exit() {
    local status="$?"
    set +e
    if [[ "$cleanup_needed" == true ]]; then
        cleanup_guest
        local cleanup_status="$?"
        [[ "$cleanup_status" -eq 0 ]] || status="$cleanup_status"
    fi
    rm -f "$runtime_configuration_path"
    local config_status="$?"
    rmdir "$lock_directory"
    local lock_status="$?"
    if [[ "$status" -eq 0 && ( "$config_status" -ne 0 || "$lock_status" -ne 0 ) ]]; then status=1; fi
    echo "Mac capture evidence and staging retained at $run_directory"
    exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$skip_build" == false ]]; then
    xcodebuild -project "$repo_root/apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
        -scheme "Flashcards Open Source App" -configuration Debug \
        -destination "platform=macOS,variant=Mac Catalyst,id=$mac_id" \
        -derivedDataPath "$derived_data_path" -xcconfig "$signing_xcconfig" \
        "-only-testing:Flashcards Open Source App UI Tests/MarketingScreenshotsTests" build-for-testing
fi
xctestruns=()
while IFS= read -r path; do xctestruns+=("$path"); done < <(find "$derived_data_path/Build/Products" -maxdepth 1 -name '*.xctestrun' -type f)
[[ "${#xctestruns[@]}" -eq 1 ]] || { echo "Expected one generated xctestrun under $derived_data_path/Build/Products; rebuild in a clean dedicated Mac capture DerivedData." >&2; exit 1; }
xctestrun="${xctestruns[0]}"
app_path="$derived_data_path/Build/Products/Debug-maccatalyst/Nibomo.app"
# Refuse production identity before any UI-test reset or cleanup can launch.
python3 - "$app_path" "$mac_id" "$xctestrun" <<'PY'
import plistlib, subprocess, sys
from pathlib import Path
app = Path(sys.argv[1]).resolve()
manifest_path = Path(sys.argv[3]).resolve()
manifest = plistlib.loads(manifest_path.read_bytes())
target = manifest["Flashcards Open Source App UI Tests"]
target_path = target["UITargetAppPath"].replace("__TESTROOT__", str(manifest_path.parent))
if Path(target_path).resolve() != app:
    raise SystemExit(f"Unsafe xctestrun target {target_path}: expected verified capture app {app}")
info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
bundle = info["CFBundleIdentifier"]
if bundle != "com.flashcards-open-source-app.app.marketing-capture":
    raise SystemExit(f"Unsafe capture bundle {bundle}: require separately provisioned marketing-capture identity")
profile = plistlib.loads(subprocess.check_output(["security", "cms", "-D", "-i", str(app / "Contents/embedded.provisionprofile")]))
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
entitlements = plistlib.loads(subprocess.check_output(["codesign", "-d", "--entitlements", ":-", str(app)], stderr=subprocess.DEVNULL))
for key in ["application-identifier", "com.apple.application-identifier"]:
    expected = profile["Entitlements"][key]
    if entitlements.get(key) != expected or not expected.endswith("." + bundle):
        raise SystemExit(f"Capture signature/profile mismatch for {key}")
if sys.argv[2] not in profile["ProvisionedDevices"]:
    raise SystemExit("Execution Mac is absent from genuine capture profile")
print(f"Verified isolated signed capture app: {bundle}")
PY

for locale in "${locales[@]}"; do
    capture_directory="$run_directory/$locale"
    mkdir "$capture_directory"
    write_configuration
    cleanup_needed=true
    cleanup_guest
    run_capture_test testGenerateMarketingScreenshots
    xcrun xcresulttool export attachments --path "$last_result_path" --output-path "$capture_directory/attachments"
    python3 - "$capture_directory" "$locale" <<'PY'
import json, re, shutil, sys
from pathlib import Path
root, locale = Path(sys.argv[1]), sys.argv[2]
records = json.loads((root / "attachments/manifest.json").read_text())
for index in range(1, 6):
    matches = [attachment for record in records for attachment in record["attachments"]
        if attachment["suggestedHumanReadableName"].startswith(f"{locale}-{index}_")
        and attachment["suggestedHumanReadableName"].endswith(".png")]
    if len(matches) != 1:
        raise SystemExit(f"Expected one named native {locale}-{index} attachment; found {len(matches)}")
    attachment = matches[0]
    match = re.fullmatch(r"(.+)_\d+_[0-9A-F-]{36}\.png", attachment["suggestedHumanReadableName"])
    if match is None: raise SystemExit(f"Unexpected exported attachment name: {attachment}")
    name = match[1] + ".png"
    shutil.copyfile(root / "attachments" / attachment["exportedFileName"], root / name)
PY
    python3 - "$capture_directory" "$locale" "$width" "$height" <<'PY'
from pathlib import Path
import struct, sys
root, locale, width, height = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
for index in range(1, 6):
    paths = list(root.glob(f"{locale}-{index}_*.png"))
    if len(paths) != 1: raise SystemExit(f"Expected one native {locale}-{index} PNG; found {len(paths)}")
    data = paths[0].read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n" or struct.unpack(">II", data[16:24]) != (width, height) or data[25] not in (0, 2, 3):
        raise SystemExit(f"Wrong dimensions or alpha channel in {paths[0]}")
    offset = 8
    while offset < len(data):
        length = struct.unpack(">I", data[offset:offset+4])[0]
        if data[offset+4:offset+8] == b"tRNS": raise SystemExit(f"Transparency in {paths[0]}")
        offset += length + 12
    if offset != len(data): raise SystemExit(f"Invalid PNG chunks in {paths[0]}")
PY
    cleanup_guest
    cleanup_needed=false
    rm "$runtime_configuration_path"
    for index in 1 2 3 4 5; do
        for screenshot in "$capture_directory/$locale-$index"_*.png; do
            filename="$(basename "$screenshot")"
            cp "$screenshot" "$output_directory/$filename"
            find "$output_directory" -maxdepth 1 -type f -name "$locale-$index"_\*.png ! -name "$filename" -delete
            echo "Saved native Mac screenshot: $output_directory/$filename"
        done
    done
done
