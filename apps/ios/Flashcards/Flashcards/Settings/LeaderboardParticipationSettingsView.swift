import SwiftUI

struct LeaderboardParticipationSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
    @State private var isSaving: Bool = false

    var body: some View {
        List {
            if self.screenErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.screenErrorMessage)
                }
            }

            Section {
                self.leaderboardParticipationContent
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.leaderboardParticipationSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.leaderboardParticipation.title", "Leaderboard participation"))
        .task {
            await self.refreshCommunityProfile()
        }
    }

    @ViewBuilder
    private var leaderboardParticipationContent: some View {
        if store.canManageLeaderboardParticipation {
            if let communityProfile = store.communityPublicProfile {
                Toggle(
                    aiSettingsLocalized(
                        "settings.leaderboardParticipation.toggle",
                        "Show me on the leaderboard"
                    ),
                    isOn: Binding(
                        get: {
                            communityProfile.leaderboardParticipationEnabled
                        },
                        set: { isEnabled in
                            self.updateLeaderboardParticipationEnabled(isEnabled: isEnabled)
                        }
                    )
                )
                .disabled(self.isSaving)
                .accessibilityIdentifier(UITestIdentifier.leaderboardParticipationSettingsToggle)
            } else {
                LabeledContent(
                    aiSettingsLocalized(
                        "settings.leaderboardParticipation.toggle",
                        "Show me on the leaderboard"
                    )
                ) {
                    ProgressView()
                }
            }

            Text(
                aiSettingsLocalized(
                    "settings.leaderboardParticipation.description",
                    "When this is off, your anonymous activity will not appear on the leaderboard."
                )
            )
            .foregroundStyle(.secondary)
        } else {
            Text(
                aiSettingsLocalized(
                    "settings.leaderboardParticipation.signInRequired",
                    "Connect cloud sync to manage leaderboard participation."
                )
            )
            .foregroundStyle(.secondary)
        }
    }

    private func updateLeaderboardParticipationEnabled(isEnabled: Bool) {
        guard self.isSaving == false else {
            return
        }

        Task { @MainActor in
            self.isSaving = true
            defer {
                self.isSaving = false
            }

            do {
                try await store.updateLeaderboardParticipationEnabled(isEnabled: isEnabled)
                self.screenErrorMessage = ""
            } catch {
                self.screenErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }

    private func refreshCommunityProfile() async {
        do {
            try await store.refreshCommunityPublicProfileIfAvailable()
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
        }
    }
}

#Preview {
    NavigationStack {
        LeaderboardParticipationSettingsView()
            .environment(FlashcardsStore())
    }
}
