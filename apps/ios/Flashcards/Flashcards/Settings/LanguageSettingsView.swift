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

struct LanguageSettingsView: View {
    var body: some View {
        List {
            Section {
                Text(
                    aiSettingsLocalized(
                        "settings.language.systemDescription",
                        "iOS controls the app language. In iOS Settings, open Nibomo and use Preferred Language. If Preferred Language is not shown, add another language in Settings > General > Language & Region first."
                    )
                )
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(UITestIdentifier.languageSettingsSystemText)

                Button(aiSettingsLocalized("settings.language.action.openAppSettings", "Open Nibomo settings")) {
                    openApplicationSettings()
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
}

#Preview {
    NavigationStack {
        LanguageSettingsView()
    }
}
