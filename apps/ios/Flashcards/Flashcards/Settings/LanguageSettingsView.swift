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
            id: "zh-Hans",
            title: aiSettingsLocalized("settings.language.supported.chineseSimplified", "Chinese Simplified")
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
                        "iOS controls the app language. In iOS Settings, open Flashcards and use Preferred Language. If Preferred Language is not shown, add another language in Settings > General > Language & Region first."
                    )
                )
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(UITestIdentifier.languageSettingsSystemText)

                Button(aiSettingsLocalized("settings.language.action.openAppSettings", "Open Flashcards settings")) {
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
