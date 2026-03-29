import SwiftUI

struct WorkspaceOverviewView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @State private var overviewSnapshot: WorkspaceOverviewSnapshot? = nil
    @State private var errorMessage: String = ""
    @State private var isLoading: Bool = true
    @State private var workspaceNameDraft: String = ""
    @State private var renameErrorMessage: String = ""
    @State private var isRenameSubmitting: Bool = false
    @State private var isDeletePreviewLoading: Bool = false
    @State private var deletePreview: CloudWorkspaceDeletePreview? = nil
    @State private var deletePreviewErrorMessage: String = ""
    @State private var isDeleteWorkspaceAlertPresented: Bool = false
    @State private var isDeleteWorkspaceConfirmationPresented: Bool = false

    private var isCloudLinked: Bool {
        store.cloudSettings?.cloudState == .linked
    }

    private var isRenameDisabled: Bool {
        let trimmedWorkspaceName = self.workspaceNameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        return self.isCloudLinked == false
            || self.isRenameSubmitting
            || trimmedWorkspaceName.isEmpty
            || trimmedWorkspaceName == store.workspace?.name
    }

    var body: some View {
        List {
            if self.errorMessage.isEmpty == false || store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.errorMessage.isEmpty ? store.globalErrorMessage : self.errorMessage)
                }
            }

            Section("Workspace") {
                if self.isCloudLinked {
                    TextField("Workspace name", text: self.$workspaceNameDraft)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled(true)
                        .accessibilityIdentifier(UITestIdentifier.workspaceOverviewNameField)

                    if self.renameErrorMessage.isEmpty == false {
                        CopyableErrorMessageView(message: self.renameErrorMessage)
                    }

                    Button(self.isRenameSubmitting ? "Saving..." : "Save name") {
                        Task {
                            await self.renameWorkspace()
                        }
                    }
                    .disabled(self.isRenameDisabled)
                    .accessibilityIdentifier(UITestIdentifier.workspaceOverviewSaveNameButton)
                } else {
                    LabeledContent("Workspace") {
                        Text(self.overviewSnapshot?.workspaceName ?? store.workspace?.name ?? "Unavailable")
                    }

                    Text("Workspace rename and delete are available only for linked cloud workspaces.")
                        .foregroundStyle(.secondary)
                }

                LabeledContent("Cards") {
                    Text("\(self.overviewSnapshot?.totalCards ?? 0)")
                }

                LabeledContent("Decks") {
                    Text("\(self.overviewSnapshot?.deckCount ?? 0)")
                }

                LabeledContent("Tags") {
                    Text("\(self.overviewSnapshot?.tagsCount ?? 0)")
                }
            }

            Section("Today") {
                LabeledContent("Due") {
                    Text("\(self.overviewSnapshot?.dueCount ?? 0)")
                }

                LabeledContent("New") {
                    Text("\(self.overviewSnapshot?.newCount ?? 0)")
                }

                LabeledContent("Reviewed") {
                    Text("\(self.overviewSnapshot?.reviewedCount ?? 0)")
                }
            }

            Section("Danger Zone") {
                Text("Permanently delete this workspace and all cards, decks, reviews, and sync history inside it.")
                    .foregroundStyle(.secondary)

                if self.deletePreviewErrorMessage.isEmpty == false {
                    CopyableErrorMessageView(message: self.deletePreviewErrorMessage)
                }

                Button(self.isDeletePreviewLoading ? "Loading..." : "Delete workspace", role: .destructive) {
                    Task {
                        await self.prepareDeleteWorkspace()
                    }
                }
                .disabled(self.isCloudLinked == false || self.isDeletePreviewLoading)
                .accessibilityIdentifier(UITestIdentifier.workspaceOverviewDeleteWorkspaceButton)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Overview")
        .task(id: store.localReadVersion) {
            await self.reloadWorkspaceOverview()
        }
        .task(id: store.workspace?.workspaceId) {
            self.workspaceNameDraft = store.workspace?.name ?? ""
        }
        .alert("Delete this workspace?", isPresented: self.$isDeleteWorkspaceAlertPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Continue", role: .destructive) {
                self.isDeleteWorkspaceConfirmationPresented = true
            }
        } message: {
            if let deletePreview {
                Text("This permanently deletes \(deletePreview.activeCardCount) active cards from this workspace.")
            } else {
                Text("This permanently deletes the current workspace.")
            }
        }
        .fullScreenCover(isPresented: self.$isDeleteWorkspaceConfirmationPresented) {
            if let deletePreview {
                DeleteWorkspaceConfirmationView(preview: deletePreview)
                    .environment(store)
            }
        }
    }

    @MainActor
    private func reloadWorkspaceOverview() async {
        guard let database = store.database, let workspace = store.workspace else {
            self.overviewSnapshot = nil
            self.errorMessage = ""
            self.isLoading = false
            self.workspaceNameDraft = ""
            return
        }

        self.isLoading = true
        self.errorMessage = ""

        do {
            self.overviewSnapshot = try database.loadWorkspaceOverviewSnapshot(
                workspaceId: workspace.workspaceId,
                workspaceName: workspace.name,
                now: Date()
            )
            self.workspaceNameDraft = workspace.name
        } catch {
            self.errorMessage = Flashcards.errorMessage(error: error)
        }

        self.isLoading = false
    }

    @MainActor
    private func renameWorkspace() async {
        self.isRenameSubmitting = true
        self.renameErrorMessage = ""

        do {
            try await store.renameCurrentWorkspace(name: self.workspaceNameDraft)
        } catch {
            self.renameErrorMessage = Flashcards.errorMessage(error: error)
        }

        self.isRenameSubmitting = false
    }

    @MainActor
    private func prepareDeleteWorkspace() async {
        self.isDeletePreviewLoading = true
        self.deletePreviewErrorMessage = ""

        do {
            self.deletePreview = try await store.loadCurrentWorkspaceDeletePreview()
            self.isDeleteWorkspaceAlertPresented = true
        } catch {
            self.deletePreviewErrorMessage = Flashcards.errorMessage(error: error)
        }

        self.isDeletePreviewLoading = false
    }
}

#Preview {
    NavigationStack {
        WorkspaceOverviewView()
            .environment(FlashcardsStore())
    }
}
