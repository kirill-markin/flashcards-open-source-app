import SwiftUI

struct OwnOpenAIKeySettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var apiKey: String = ""
    /// The value last read from or written to the Keychain; nil until the first read succeeds.
    @State private var storedApiKey: String? = nil
    @State private var keyErrorMessage: String? = nil

    var body: some View {
        List {
            Section {
                Toggle(
                    aiSettingsLocalized("settings.ownOpenAIKey.toggle", "Use my own OpenAI key"),
                    isOn: Binding(
                        get: {
                            store.isOwnOpenAIKeyEnabled
                        },
                        set: { isEnabled in
                            withAnimation {
                                do {
                                    try store.updateOwnOpenAIKeyEnabled(isEnabled: isEnabled)
                                } catch {
                                    self.keyErrorMessage = Flashcards.errorMessage(error: error)
                                }
                            }
                        }
                    )
                )
                .accessibilityIdentifier(UITestIdentifier.ownOpenAIKeySettingsToggle)
            } footer: {
                Text(
                    aiSettingsLocalized(
                        "settings.ownOpenAIKey.description",
                        "With your own key, AI chat, dictation and card images run on your OpenAI account, with no monthly limit on any plan. Suggested replies are off while your key is on. We never store your key on our servers: it stays on this device and is sent only with your AI requests, so enter it separately on iOS, Android and the web."
                    )
                )
            }

            if store.isOwnOpenAIKeyEnabled {
                Section {
                    SecureField(
                        aiSettingsLocalized("settings.ownOpenAIKey.keyField", "OpenAI API key"),
                        text: self.$apiKey
                    )
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .disabled(self.storedApiKey == nil)
                    .accessibilityIdentifier(UITestIdentifier.ownOpenAIKeySettingsKeyField)

                    if let usage = store.currentAIMonthlyUsage {
                        Text(ownOpenAIKeyMonthMessagesText(ownKeyMessages: usage.ownKeyMessages))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if let keyErrorMessage {
                Section {
                    Text(keyErrorMessage)
                        .foregroundStyle(.red)
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.ownOpenAIKeySettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.ownOpenAIKey.title", "Your OpenAI key"))
        .onAppear {
            self.loadApiKey()
        }
        .onChange(of: self.apiKey) { _, apiKey in
            self.saveApiKey(apiKey: apiKey)
        }
        .task(id: store.isOwnOpenAIKeyEnabled) {
            guard store.isOwnOpenAIKeyEnabled else {
                return
            }

            await store.refreshAIUsage()
        }
    }

    private func loadApiKey() {
        guard self.storedApiKey == nil else {
            return
        }

        do {
            let loadedApiKey = try store.loadOwnOpenAIKey()
            self.storedApiKey = loadedApiKey
            self.apiKey = loadedApiKey
            self.keyErrorMessage = nil
        } catch {
            self.keyErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func saveApiKey(apiKey: String) {
        guard let storedApiKey = self.storedApiKey, apiKey != storedApiKey else {
            return
        }

        do {
            try store.saveOwnOpenAIKey(apiKey: apiKey)
            self.storedApiKey = apiKey
            self.keyErrorMessage = nil
        } catch {
            self.keyErrorMessage = Flashcards.errorMessage(error: error)
        }
    }
}

#Preview {
    NavigationStack {
        OwnOpenAIKeySettingsView()
            .environment(FlashcardsStore())
    }
}
