#!/usr/bin/env bash

supported_locales=(
    "en-US"
    "ar"
    "zh-Hans"
    "zh-Hant"
    "fr"
    "de"
    "hi"
    "ja"
    "pt-BR"
    "pt-PT"
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
    "ms"
    "nb"
    "nl"
    "or"
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

is_locale_eligible_for_family() {
    local locale="$1"
    local family="$2"

    [[ "$family" == "iphone" ]] || ! is_iphone_only_locale "$locale"
}

print_locales_for_family() {
    local family="$1"
    local locale=""

    for locale in "${supported_locales[@]}"; do
        if is_locale_eligible_for_family "$locale" "$family"; then
            printf '%s\n' "$locale"
        fi
    done
}

canonicalize_locale() {
    local raw_locale="$1"

    case "$raw_locale" in
        en | en-US | en-AU | en-CA | en-GB)
            echo "en-US"
            ;;
        ar | ar-SA)
            echo "ar"
            ;;
        zh-CN | zh-Hans)
            echo "zh-Hans"
            ;;
        zh-Hant)
            echo "zh-Hant"
            ;;
        fr | fr-FR | fr-CA)
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
        pt-PT)
            echo "pt-PT"
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
        ms)
            echo "ms"
            ;;
        nb | no)
            echo "nb"
            ;;
        nl | nl-NL)
            echo "nl"
            ;;
        or | or-IN)
            echo "or"
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

list_booted_simulator_lines() {
    xcrun simctl list devices booted | sed -nE '/^[[:space:]]+.+ \([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\) \(Booted\)[[:space:]]*$/p'
}

resolve_booted_simulator_id() {
    local simulator_override="$1"
    if [[ -n "$simulator_override" ]]; then
        echo "$simulator_override"
        return
    fi

    local booted_ids_output
    local line
    local -a booted_ids=()
    booted_ids_output="$(
        list_booted_simulator_lines | sed -nE 's/^.*\(([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\) \(Booted\)[[:space:]]*$/\1/p'
    )"
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
    simulator_line="$(list_booted_simulator_lines | grep -m 1 -F "($simulator_id) (Booted)" || true)"

    if [[ -z "$simulator_line" ]]; then
        echo "Failed to resolve the booted simulator line for $simulator_id." >&2
        exit 1
    fi

    echo "$simulator_line" | sed -E 's/^[[:space:]]*//; s/[[:space:]]+\([^)]*\)[[:space:]]+\(Booted\)[[:space:]]*$//'
}

resolve_device_family() {
    local simulator_name="$1"
    local duo_display="$2"

    if [[ "$simulator_name" == *"iPhone"* && "$simulator_name" == *"Duo"* ]]; then
        if [[ -z "$duo_display" ]]; then
            echo "iPhone Duo requires --duo-display outer|inner after selecting that display in Device Hub." >&2
            exit 1
        fi
        echo "iphone-duo-$duo_display"
        return
    fi

    if [[ -n "$duo_display" ]]; then
        echo "--duo-display requires a booted iPhone Duo simulator; found '$simulator_name'." >&2
        exit 1
    fi

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
