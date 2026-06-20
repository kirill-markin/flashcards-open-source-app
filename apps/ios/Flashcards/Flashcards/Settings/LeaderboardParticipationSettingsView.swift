import SwiftUI

struct LeaderboardParticipationSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var isSaving: Bool = false
    @State private var guidanceMessage: String = ""

    var body: some View {
        List {
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
            if self.guidanceMessage.isEmpty == false {
                Text(self.guidanceMessage)
                    .foregroundStyle(.secondary)
            }

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
                self.guidanceMessage = ""
            } catch {
                self.handleLeaderboardParticipationFailure(error: error)
            }
        }
    }

    private func refreshCommunityProfile() async {
        do {
            try await store.refreshCommunityPublicProfileIfAvailable()
            self.guidanceMessage = ""
        } catch {
            self.handleLeaderboardParticipationFailure(error: error)
        }
    }

    private func handleLeaderboardParticipationFailure(error: Error) {
        if isRequestCancellationError(error: error) {
            return
        }
        if isRetryableNetworkTransportFailure(error: error) {
            self.guidanceMessage = aiSettingsLocalized("settings.sync.failed.generic", "Sync failed")
            return
        }
        if let guidanceMessage = self.store.blockedCloudIdentityConflictMessage(error: error) {
            self.guidanceMessage = guidanceMessage
            return
        }

        self.store.presentTechnicalError(error)
    }
}

#Preview {
    NavigationStack {
        LeaderboardParticipationSettingsView()
            .environment(FlashcardsStore())
    }
}
