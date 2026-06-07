import SwiftUI

struct ReviewAnimationsSettingsView: View {
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
                self.screenErrorMessage = ""
            } catch {
                self.screenErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }

    private func refreshCloudAccountContext() async {
        do {
            try await store.refreshCloudAccountContextIfActive()
            self.screenErrorMessage = ""
        } catch {
            self.screenErrorMessage = Flashcards.errorMessage(error: error)
        }
    }
}

#Preview {
    NavigationStack {
        ReviewAnimationsSettingsView()
            .environment(FlashcardsStore())
    }
}
