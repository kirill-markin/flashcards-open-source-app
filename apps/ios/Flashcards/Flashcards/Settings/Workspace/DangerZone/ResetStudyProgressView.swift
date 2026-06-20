import SwiftUI

struct ResetStudyProgressView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var isResetProgressAlertPresented: Bool = false
    @State private var isResetProgressConfirmationPresented: Bool = false

    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.row.resetStudyProgress", "Reset Study Progress")) {
                Text(
                    aiSettingsLocalized(
                        "settings.workspace.resetProgressDescription",
                        "Permanently reset study progress for every card in this workspace."
                    )
                )
                    .foregroundStyle(.secondary)

                Button(aiSettingsLocalized("settings.workspace.resetAllProgress", "Reset all progress"), role: .destructive) {
                    self.isResetProgressAlertPresented = true
                }
                .disabled(store.cloudSettings?.cloudState != .linked || store.workspace == nil)
                .accessibilityIdentifier(UITestIdentifier.workspaceSettingsResetProgressButton)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.resetStudyProgressScreen)
        .navigationTitle(aiSettingsLocalized("settings.row.resetStudyProgress", "Reset Study Progress"))
        .alert(aiSettingsLocalized("settings.workspace.resetAlertTitle", "Reset all progress?"), isPresented: self.$isResetProgressAlertPresented) {
            Button(aiSettingsLocalized("common.cancel", "Cancel"), role: .cancel) {}
            Button(aiSettingsLocalized("common.continue", "Continue"), role: .destructive) {
                self.isResetProgressConfirmationPresented = true
            }
        } message: {
            Text(
                aiSettingsLocalized(
                    "settings.workspace.resetAlertMessage",
                    "This permanently resets study progress for all cards in the current workspace."
                )
            )
        }
        .fullScreenCover(isPresented: self.$isResetProgressConfirmationPresented) {
            ResetWorkspaceProgressConfirmationView(isPresented: self.$isResetProgressConfirmationPresented)
                .environment(store)
                .technicalErrorSheetHost(store: self.store)
        }
    }
}

#Preview {
    NavigationStack {
        ResetStudyProgressView()
            .environment(FlashcardsStore())
    }
}
