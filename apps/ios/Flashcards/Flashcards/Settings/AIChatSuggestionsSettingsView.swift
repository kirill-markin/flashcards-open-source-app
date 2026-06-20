import SwiftUI

struct AIChatSuggestionsSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    var body: some View {
        List {
            Section {
                Toggle(
                    aiSettingsLocalized(
                        "settings.aiChatSuggestions.toggle",
                        "Show composer suggestions"
                    ),
                    isOn: Binding(
                        get: {
                            store.aiChatComposerSuggestionsEnabled
                        },
                        set: { isEnabled in
                            store.updateAIChatComposerSuggestionsEnabled(isEnabled: isEnabled)
                        }
                    )
                )
                .accessibilityIdentifier(UITestIdentifier.aiChatSuggestionsSettingsToggle)

                Text(
                    aiSettingsLocalized(
                        "settings.aiChatSuggestions.description",
                        "When this is off, AI chat does not show suggested prompts above the composer."
                    )
                )
                .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.aiChatSuggestionsSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.aiChatSuggestions.title", "AI Chat Suggestions"))
    }
}

#Preview {
    NavigationStack {
        AIChatSuggestionsSettingsView()
            .environment(FlashcardsStore())
    }
}
