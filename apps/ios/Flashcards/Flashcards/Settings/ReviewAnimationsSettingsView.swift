import SwiftUI

struct ReviewAnimationsSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var isSaving: Bool = false
    @State private var guidanceMessage: String = ""

    var body: some View {
        List {
            Section {
                if self.guidanceMessage.isEmpty == false {
                    Text(self.guidanceMessage)
                        .foregroundStyle(.secondary)
                }

                Toggle(
                    aiSettingsLocalized(
                        "settings.reviewAnimations.toggle",
                        "Show animations after rating a card"
                    ),
                    isOn: Binding(
                        get: {
                            store.accountPreferences.reviewReactionAnimationsEnabled
                        },
                        set: { isEnabled in
                            self.updateReviewAnimationsEnabled(isEnabled: isEnabled)
                        }
                    )
                )
                .disabled(self.isSaving || store.canPersistAccountPreferences == false)
                .accessibilityIdentifier(UITestIdentifier.reviewAnimationsSettingsToggle)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.reviewAnimationsSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.reviewAnimations.title", "Review Animations"))
        .task {
            await self.refreshCloudAccountContext()
        }
    }

    private func updateReviewAnimationsEnabled(isEnabled: Bool) {
        guard self.isSaving == false else {
            return
        }

        Task { @MainActor in
            self.isSaving = true
            defer {
                self.isSaving = false
            }

            do {
                try await store.updateReviewReactionAnimationsEnabled(isEnabled: isEnabled)
                self.guidanceMessage = ""
            } catch {
                self.handleReviewAnimationsFailure(error: error)
            }
        }
    }

    private func refreshCloudAccountContext() async {
        do {
            try await store.refreshCloudAccountContextIfActive()
            self.guidanceMessage = ""
        } catch {
            self.handleReviewAnimationsFailure(error: error)
        }
    }

    private func handleReviewAnimationsFailure(error: Error) {
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
        ReviewAnimationsSettingsView()
            .environment(FlashcardsStore())
    }
}
