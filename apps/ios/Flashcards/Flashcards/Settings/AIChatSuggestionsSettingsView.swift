import SwiftUI

private struct PendingAIChatSuggestionsSelection {
    let requestId: UUID
    let identityKey: String?
    let isEnabled: Bool
}

struct AIChatSuggestionsSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(PremiumPresenter.self) private var premiumPresenter: PremiumPresenter

    @State private var pendingSelection: PendingAIChatSuggestionsSelection? = nil

    var body: some View {
        List {
            if self.store.canCustomizeStyle == false {
                Section {
                    Text(aiSettingsLocalized(
                        "settings.aiChatSuggestions.premiumNote",
                        "Turning off AI chat suggestions is available with Premium. Your saved setting returns when Premium is active."
                    ))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(UITestIdentifier.aiChatSuggestionsPremiumNote)
                }
            }

            Section {
                Toggle(
                    aiSettingsLocalized(
                        "settings.aiChatSuggestions.toggle",
                        "Show composer suggestions"
                    ),
                    isOn: Binding(
                        get: {
                            store.effectiveAIChatComposerSuggestionsEnabled
                        },
                        set: { isEnabled in
                            self.selectAIChatSuggestionsEnabled(isEnabled: isEnabled)
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
        .onChange(of: self.store.accountPreferencesIdentityKey) { _, _ in
            self.pendingSelection = nil
        }
        .onChange(of: self.premiumPresenter.result) { _, result in
            guard let pending = self.pendingSelection, let result,
                  result.requestId == pending.requestId else {
                return
            }
            self.pendingSelection = nil
            if result.outcome == .accessGranted,
               pending.identityKey == self.store.accountPreferencesIdentityKey,
               self.store.canCustomizeStyle {
                self.selectAIChatSuggestionsEnabled(isEnabled: pending.isEnabled)
            }
        }
        .onDisappear {
            self.pendingSelection = nil
        }
    }

    private func selectAIChatSuggestionsEnabled(isEnabled: Bool) {
        if isEnabled == false && self.store.canCustomizeStyle == false {
            guard self.pendingSelection == nil else { return }
            let requestId = self.premiumPresenter.present(
                reason: .premiumFeature(requiredTierRank: premiumTierRank),
                analyticsEntryPoint: .aiChatSuggestions,
                entitlement: self.store.cloudEntitlement,
                identity: try? self.store.appleSubscriptionIdentity()
            )
            self.pendingSelection = PendingAIChatSuggestionsSelection(
                requestId: requestId,
                identityKey: self.store.accountPreferencesIdentityKey,
                isEnabled: isEnabled
            )
            return
        }
        do {
            try store.updateAIChatComposerSuggestionsEnabled(isEnabled: isEnabled)
        } catch {
            self.store.presentTechnicalError(error)
        }
    }
}

#Preview {
    NavigationStack {
        AIChatSuggestionsSettingsView()
            .environment(FlashcardsStore())
            .environment(PremiumPresenter())
    }
}
