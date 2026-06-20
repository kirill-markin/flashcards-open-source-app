import SwiftUI

struct DeleteCurrentWorkspaceView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var isDeletePreviewLoading: Bool = false
    @State private var deletePreview: CloudWorkspaceDeletePreview? = nil
    @State private var guidanceMessage: String = ""
    @State private var isDeleteWorkspaceAlertPresented: Bool = false
    @State private var isDeleteWorkspaceConfirmationPresented: Bool = false

    private var isDeleteDisabled: Bool {
        store.cloudSettings?.cloudState != .linked || store.workspace == nil || self.isDeletePreviewLoading
    }

    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.row.deleteCurrentWorkspace", "Delete Current Workspace")) {
                Text(
                    aiSettingsLocalized(
                        "settings.workspace.overview.deleteDescription",
                        "Permanently delete this workspace and all cards, decks, reviews, and sync history inside it."
                    )
                )
                    .foregroundStyle(.secondary)

                if self.guidanceMessage.isEmpty == false {
                    Text(self.guidanceMessage)
                        .foregroundStyle(.secondary)
                }

                Button(
                    self.isDeletePreviewLoading
                        ? aiSettingsLocalized("common.loading", "Loading...")
                        : aiSettingsLocalized("settings.workspace.overview.deleteWorkspace", "Delete workspace"),
                    role: .destructive
                ) {
                    Task {
                        await self.prepareDeleteWorkspace()
                    }
                }
                .disabled(self.isDeleteDisabled)
                .accessibilityIdentifier(UITestIdentifier.workspaceOverviewDeleteWorkspaceButton)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.deleteCurrentWorkspaceScreen)
        .navigationTitle(aiSettingsLocalized("settings.row.deleteCurrentWorkspace", "Delete Current Workspace"))
        .alert(aiSettingsLocalized("settings.workspace.overview.deleteAlertTitle", "Delete this workspace?"), isPresented: self.$isDeleteWorkspaceAlertPresented) {
            Button(aiSettingsLocalized("common.cancel", "Cancel"), role: .cancel) {}
            Button(aiSettingsLocalized("common.continue", "Continue"), role: .destructive) {
                self.isDeleteWorkspaceConfirmationPresented = true
            }
        } message: {
            if let deletePreview {
                Text(
                    aiSettingsLocalizedFormat(
                        "settings.workspace.overview.deleteAlertMessageWithCount",
                        "This permanently deletes %d active cards from this workspace.",
                        deletePreview.activeCardCount
                    )
                )
            } else {
                Text(aiSettingsLocalized("settings.workspace.overview.deleteAlertMessage", "This permanently deletes the current workspace."))
            }
        }
        .fullScreenCover(isPresented: self.$isDeleteWorkspaceConfirmationPresented) {
            if let deletePreview {
                DeleteWorkspaceConfirmationView(preview: deletePreview)
                    .environment(store)
                    .technicalErrorSheetHost(store: self.store)
            }
        }
    }

    @MainActor
    private func prepareDeleteWorkspace() async {
        self.isDeletePreviewLoading = true
        self.guidanceMessage = ""

        do {
            self.deletePreview = try await store.loadCurrentWorkspaceDeletePreview()
            self.isDeleteWorkspaceAlertPresented = true
        } catch {
            if let guidanceMessage = self.store.workspaceOperationGuidanceMessage(error: error) {
                self.guidanceMessage = guidanceMessage
            } else if self.store.shouldPresentWorkspaceOperationTechnicalError(error: error) {
                self.store.presentTechnicalError(error)
            }
        }

        self.isDeletePreviewLoading = false
    }
}

#Preview {
    NavigationStack {
        DeleteCurrentWorkspaceView()
            .environment(FlashcardsStore())
    }
}
