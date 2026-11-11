import Foundation

// There is no en.lproj/AISettings.strings: `defaultValue` is the English copy,
// so every non-English locale needs a complete <locale>.lproj/AISettings.strings.
private let aiSettingsLocalizationTable: String = "AISettings"

func aiSettingsLocalized(_ key: String, _ defaultValue: String) -> String {
    Bundle.main.localizedString(
        forKey: key,
        value: defaultValue,
        table: aiSettingsLocalizationTable
    )
}

func aiSettingsLocalizedFormat(_ key: String, _ defaultValue: String, _ arguments: CVarArg...) -> String {
    let format = aiSettingsLocalized(key, defaultValue)
    return String(format: format, locale: Locale.current, arguments: arguments)
}
