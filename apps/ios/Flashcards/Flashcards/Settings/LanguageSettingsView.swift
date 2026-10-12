import SwiftUI

private struct SupportedLanguageSettingsItem: Identifiable {
    let id: String
    let title: String
}

private func supportedLanguageSettingsItems() -> [SupportedLanguageSettingsItem] {
    [
        SupportedLanguageSettingsItem(
            id: "en",
            title: aiSettingsLocalized("settings.language.supported.english", "English")
        ),
        SupportedLanguageSettingsItem(
            id: "ar",
            title: aiSettingsLocalized("settings.language.supported.arabic", "Arabic")
        ),
        SupportedLanguageSettingsItem(
            id: "bg",
            title: aiSettingsLocalized("settings.language.supported.bulgarian", "Bulgarian")
        ),
        SupportedLanguageSettingsItem(
            id: "bn",
            title: aiSettingsLocalized("settings.language.supported.bangla", "Bangla")
        ),
        SupportedLanguageSettingsItem(
            id: "ca",
            title: aiSettingsLocalized("settings.language.supported.catalan", "Catalan")
        ),
        SupportedLanguageSettingsItem(
            id: "cs",
            title: aiSettingsLocalized("settings.language.supported.czech", "Czech")
        ),
        SupportedLanguageSettingsItem(
            id: "da",
            title: aiSettingsLocalized("settings.language.supported.danish", "Danish")
        ),
        SupportedLanguageSettingsItem(
            id: "el",
            title: aiSettingsLocalized("settings.language.supported.greek", "Greek")
        ),
        SupportedLanguageSettingsItem(
            id: "et",
            title: aiSettingsLocalized("settings.language.supported.estonian", "Estonian")
        ),
        SupportedLanguageSettingsItem(
            id: "fa",
            title: aiSettingsLocalized("settings.language.supported.persian", "Persian")
        ),
        SupportedLanguageSettingsItem(
            id: "fi",
            title: aiSettingsLocalized("settings.language.supported.finnish", "Finnish")
        ),
        SupportedLanguageSettingsItem(
            id: "gu",
            title: aiSettingsLocalized("settings.language.supported.gujarati", "Gujarati")
        ),
        SupportedLanguageSettingsItem(
            id: "he",
            title: aiSettingsLocalized("settings.language.supported.hebrew", "Hebrew")
        ),
        SupportedLanguageSettingsItem(
            id: "hr",
            title: aiSettingsLocalized("settings.language.supported.croatian", "Croatian")
        ),
        SupportedLanguageSettingsItem(
            id: "hu",
            title: aiSettingsLocalized("settings.language.supported.hungarian", "Hungarian")
        ),
        SupportedLanguageSettingsItem(
            id: "id",
            title: aiSettingsLocalized("settings.language.supported.indonesian", "Indonesian")
        ),
        SupportedLanguageSettingsItem(
            id: "is",
            title: aiSettingsLocalized("settings.language.supported.icelandic", "Icelandic")
        ),
        SupportedLanguageSettingsItem(
            id: "it",
            title: aiSettingsLocalized("settings.language.supported.italian", "Italian")
        ),
        SupportedLanguageSettingsItem(
            id: "kn",
            title: aiSettingsLocalized("settings.language.supported.kannada", "Kannada")
        ),
        SupportedLanguageSettingsItem(
            id: "ko",
            title: aiSettingsLocalized("settings.language.supported.korean", "Korean")
        ),
        SupportedLanguageSettingsItem(
            id: "lt",
            title: aiSettingsLocalized("settings.language.supported.lithuanian", "Lithuanian")
        ),
        SupportedLanguageSettingsItem(
            id: "lv",
            title: aiSettingsLocalized("settings.language.supported.latvian", "Latvian")
        ),
        SupportedLanguageSettingsItem(
            id: "ml",
            title: aiSettingsLocalized("settings.language.supported.malayalam", "Malayalam")
        ),
        SupportedLanguageSettingsItem(
            id: "mr",
            title: aiSettingsLocalized("settings.language.supported.marathi", "Marathi")
        ),
        SupportedLanguageSettingsItem(
            id: "nb",
            title: aiSettingsLocalized("settings.language.supported.norwegianBokmal", "Norwegian Bokmål")
        ),
        SupportedLanguageSettingsItem(
            id: "nl",
            title: aiSettingsLocalized("settings.language.supported.dutch", "Dutch")
        ),
        SupportedLanguageSettingsItem(
            id: "pa",
            title: aiSettingsLocalized("settings.language.supported.punjabi", "Punjabi")
        ),
        SupportedLanguageSettingsItem(
            id: "pl",
            title: aiSettingsLocalized("settings.language.supported.polish", "Polish")
        ),
        SupportedLanguageSettingsItem(
            id: "ro",
            title: aiSettingsLocalized("settings.language.supported.romanian", "Romanian")
        ),
        SupportedLanguageSettingsItem(
            id: "sk",
            title: aiSettingsLocalized("settings.language.supported.slovak", "Slovak")
        ),
        SupportedLanguageSettingsItem(
            id: "sl",
            title: aiSettingsLocalized("settings.language.supported.slovenian", "Slovenian")
        ),
        SupportedLanguageSettingsItem(
            id: "sv",
            title: aiSettingsLocalized("settings.language.supported.swedish", "Swedish")
        ),
        SupportedLanguageSettingsItem(
            id: "sw",
            title: aiSettingsLocalized("settings.language.supported.swahili", "Swahili")
        ),
        SupportedLanguageSettingsItem(
            id: "ta",
            title: aiSettingsLocalized("settings.language.supported.tamil", "Tamil")
        ),
        SupportedLanguageSettingsItem(
            id: "te",
            title: aiSettingsLocalized("settings.language.supported.telugu", "Telugu")
        ),
        SupportedLanguageSettingsItem(
            id: "th",
            title: aiSettingsLocalized("settings.language.supported.thai", "Thai")
        ),
        SupportedLanguageSettingsItem(
            id: "tr",
            title: aiSettingsLocalized("settings.language.supported.turkish", "Turkish")
        ),
        SupportedLanguageSettingsItem(
            id: "uk",
            title: aiSettingsLocalized("settings.language.supported.ukrainian", "Ukrainian")
        ),
        SupportedLanguageSettingsItem(
            id: "ur",
            title: aiSettingsLocalized("settings.language.supported.urdu", "Urdu")
        ),
        SupportedLanguageSettingsItem(
            id: "vi",
            title: aiSettingsLocalized("settings.language.supported.vietnamese", "Vietnamese")
        ),
        SupportedLanguageSettingsItem(
            id: "zu",
            title: aiSettingsLocalized("settings.language.supported.zulu", "Zulu")
        ),
        SupportedLanguageSettingsItem(
            id: "zh-Hans",
            title: aiSettingsLocalized("settings.language.supported.chineseSimplified", "Chinese Simplified")
        ),
        SupportedLanguageSettingsItem(
            id: "fr",
            title: aiSettingsLocalized("settings.language.supported.french", "French")
        ),
        SupportedLanguageSettingsItem(
            id: "de",
            title: aiSettingsLocalized("settings.language.supported.german", "German")
        ),
        SupportedLanguageSettingsItem(
            id: "hi",
            title: aiSettingsLocalized("settings.language.supported.hindi", "Hindi")
        ),
        SupportedLanguageSettingsItem(
            id: "ja",
            title: aiSettingsLocalized("settings.language.supported.japanese", "Japanese")
        ),
        SupportedLanguageSettingsItem(
            id: "pt-BR",
            title: aiSettingsLocalized("settings.language.supported.portugueseBrazil", "Portuguese Brazil")
        ),
        SupportedLanguageSettingsItem(
            id: "ru",
            title: aiSettingsLocalized("settings.language.supported.russian", "Russian")
        ),
        SupportedLanguageSettingsItem(
            id: "es-MX",
            title: aiSettingsLocalized("settings.language.supported.spanishMexico", "Spanish Mexico")
        ),
        SupportedLanguageSettingsItem(
            id: "es-ES",
            title: aiSettingsLocalized("settings.language.supported.spanishSpain", "Spanish Spain")
        )
    ]
}

func currentAppLanguageSettingsTitle() -> String? {
    guard let localeIdentifier = currentAppUILocaleIdentifier() else {
        return nil
    }

    return supportedLanguageSettingsItems().first { item in
        item.id == localeIdentifier
    }?.title
}

struct LanguageSettingsView: View {
    @State private var settingsErrorMessage: String = ""

    var body: some View {
        List {
            if self.settingsErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.settingsErrorMessage)
                }
            }

            Section {
                Text(self.systemDescription)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(UITestIdentifier.languageSettingsSystemText)

                Button(self.openSettingsActionTitle) {
                    Task { @MainActor in
                        self.settingsErrorMessage = ""
                        do {
                            try await openApplicationSettings()
                        } catch {
                            self.settingsErrorMessage = errorMessage(error: error)
                        }
                    }
                }
            }

            Section(aiSettingsLocalized("settings.language.section.supportedLanguages", "Supported Languages")) {
                ForEach(supportedLanguageSettingsItems()) { item in
                    LabeledContent(item.title) {
                        Text(item.id)
                            .font(.caption.monospaced())
                    }
                }
            }
            .accessibilityIdentifier(UITestIdentifier.languageSettingsSupportedLanguagesList)
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.languageSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.language.title", "Language"))
    }

    private var systemDescription: String {
        #if targetEnvironment(macCatalyst)
        return aiSettingsLocalized(
            "settings.language.macSystemDescription",
            "On Mac, change Nibomo’s language in System Settings > General > Language & Region > Applications."
        )
        #else
        return aiSettingsLocalized(
            "settings.language.systemDescription",
            "iOS controls the app language. In iOS Settings, open Nibomo and choose Language. If Language is not shown, first add a second language in Settings > General > Language & Region. iOS shows this option only when the device has more than one preferred language."
        )
        #endif
    }

    private var openSettingsActionTitle: String {
        #if targetEnvironment(macCatalyst)
        return aiSettingsLocalized("settings.language.action.openSystemSettings", "Open System Settings")
        #else
        return aiSettingsLocalized("settings.language.action.openAppSettings", "Open Nibomo settings")
        #endif
    }
}

#Preview {
    NavigationStack {
        LanguageSettingsView()
    }
}
