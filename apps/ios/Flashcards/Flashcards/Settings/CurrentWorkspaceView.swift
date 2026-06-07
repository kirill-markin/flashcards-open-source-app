import SwiftUI

struct CurrentWorkspaceView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var screenErrorMessage: String = ""
    @State private var linkedWorkspaces: [CloudWorkspaceSummary]? = nil
    @State private var isWorkspacePickerPresented: Bool = false
    @State private var isWorkspacePickerLoading: Bool = false
    @State private var workspaceNameDraft: String = ""
    @State private var renameErrorMessage: String = ""
    @State private var isRenameSubmitting: Bool = false

    private var currentWorkspaceName: String {
        self.store.workspace?.name ?? aiSettingsLocalized("common.unavailable", "Unavailable")
    }

    private var isWorkspaceManagementLocked: Bool {
        self.store.cloudSettings?.cloudState != .linked
    }

    private var isRenameDisabled: Bool {
        let trimmedWorkspaceName = self.workspaceNameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        return self.isWorkspaceManagementLocked
            || self.isRenameSubmitting
            || trimmedWorkspaceName.isEmpty
            || trimmedWorkspaceName == store.workspace?.name
    }

    var body: some View {
        List {
            if self.screenErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.screenErrorMessage)
                }
            }

            Section {
                Button {
                    self.handleWorkspaceRowTap()
                } label: {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.currentWorkspace.row.workspace", "Workspace"),
                        value: self.isWorkspacePickerLoading
                            ? aiSettingsLocalized("common.loading", "Loading...")
                            : self.currentWorkspaceName,
                        systemImage: "square.stack"
                    )
                }
                .buttonStyle(.plain)
                .foregroundStyle(self.isWorkspaceManagementLocked ? .secondary : .primary)
                .accessibilityIdentifier(UITestIdentifier.currentWorkspaceRowButton)
            }

            Section(aiSettingsLocalized("settings.currentWorkspace.section.rename", "Rename")) {
                if self.isWorkspaceManagementLocked {
                    LabeledContent(aiSettingsLocalized("settings.workspace.overview.workspace", "Workspace")) {
                        Text(self.currentWorkspaceName)
                    }

                    Text(
                        aiSettingsLocalized(
                            "settings.currentWorkspace.renameLinkedOnly",
                            "Workspace rename is available only for linked cloud workspaces."
                        )
                    )
                        .foregroundStyle(.secondary)
                } else {
                    TextField(
                        aiSettingsLocalized("settings.workspace.overview.workspaceName", "Workspace name"),
                        text: self.$workspaceNameDraft
                    )
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled(true)
                        .accessibilityIdentifier(UITestIdentifier.currentWorkspaceNameField)

                    if self.renameErrorMessage.isEmpty == false {
                        CopyableErrorMessageView(message: self.renameErrorMessage)
                    }

                    Button(
                        self.isRenameSubmitting
                            ? aiSettingsLocalized("common.saving", "Saving...")
                            : aiSettingsLocalized("settings.workspace.overview.saveName", "Save name")
                    ) {
                        Task {
                            await self.renameWorkspace()
                        }
                    }
                    .disabled(self.isRenameDisabled)
                    .accessibilityIdentifier(UITestIdentifier.currentWorkspaceSaveNameButton)
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.currentWorkspaceScreen)
        .navigationTitle(aiSettingsLocalized("settings.currentWorkspace.title", "Current Workspace"))
        .task(id: store.workspace?.workspaceId) {
            self.workspaceNameDraft = store.workspace?.name ?? ""
        }
        .task(id: store.workspace?.name) {
            self.workspaceNameDraft = store.workspace?.name ?? ""
        }
        .sheet(isPresented: self.$isWorkspacePickerPresented) {
            CurrentWorkspacePickerContainer(
                workspaces: self.linkedWorkspaces,
                isLoading: self.isWorkspacePickerLoading,
                errorMessage: self.screenErrorMessage,
                localWorkspaceName: self.currentWorkspaceName,
                onDismiss: {
                    self.isWorkspacePickerPresented = false
                }
            )
            .environment(self.store)
        }
    }

    private func handleWorkspaceRowTap() {
        guard self.isWorkspaceManagementLocked == false else {
            self.store.enqueueTransientBanner(banner: makeWorkspaceChangesRequireAccountBanner())
            return
        }

        self.presentWorkspacePicker()
    }

    private func presentWorkspacePicker() {
        self.linkedWorkspaces = nil
        self.screenErrorMessage = ""
        self.isWorkspacePickerLoading = true
        self.isWorkspacePickerPresented = true

        Task { @MainActor in
            defer {
                self.isWorkspacePickerLoading = false
            }

            do {
                self.linkedWorkspaces = try await self.store.listLinkedWorkspaces()
            } catch {
                self.screenErrorMessage = Flashcards.errorMessage(error: error)
            }
        }
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
}

private struct CurrentWorkspacePickerContainer: View {
    let workspaces: [CloudWorkspaceSummary]?
    let isLoading: Bool
    let errorMessage: String
    let localWorkspaceName: String
    let onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if self.isLoading {
                    ProgressView(aiSettingsLocalized("settings.currentWorkspace.loadingWorkspaces", "Loading workspaces..."))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                } else if let workspaces = self.workspaces {
                    CurrentWorkspacePickerSheet(
                        workspaces: workspaces,
                        localWorkspaceName: self.localWorkspaceName,
                        onDismiss: self.onDismiss
                    )
                } else {
                    CopyableErrorMessageView(
                        message: self.errorMessage.isEmpty
                            ? aiSettingsLocalized("settings.currentWorkspace.loadError", "Failed to load linked workspaces.")
                            : self.errorMessage
                    )
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            }
            .accessibilityIdentifier(UITestIdentifier.currentWorkspacePickerScreen)
            .navigationTitle(aiSettingsLocalized("settings.currentWorkspace.chooseWorkspaceTitle", "Choose Workspace"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(aiSettingsLocalized("common.close", "Close")) {
                        self.onDismiss()
                    }
                }
            }
        }
    }
}

private struct CurrentWorkspacePickerSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let workspaces: [CloudWorkspaceSummary]
    let localWorkspaceName: String
    let onDismiss: () -> Void

    @State private var errorMessage: String = ""
    @State private var isSwitching: Bool = false

    private var selectionItems: [CloudWorkspaceSelectionItem] {
        makeCloudWorkspaceSelectionItems(workspaces: self.workspaces, localWorkspaceName: self.localWorkspaceName)
    }

    var body: some View {
        List {
            if self.errorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.errorMessage)
                }
            }

            Section {
                Text(
                    aiSettingsLocalized(
                        "settings.currentWorkspace.instructions",
                        "Choose a linked workspace to open on this device, or create a new one."
                    )
                )
                    .foregroundStyle(.secondary)
            }

            Section(aiSettingsLocalized("settings.currentWorkspace.section.chooseWorkspace", "Choose workspace")) {
                ForEach(self.selectionItems) { item in
                    Button {
                        self.switchWorkspace(selection: item.selection)
                    } label: {
                        CloudWorkspaceSelectionRow(item: item)
                    }
                    .buttonStyle(.plain)
                    .disabled(self.isSwitching)
                    .accessibilityIdentifier(currentWorkspaceSelectionButtonIdentifier(selection: item.selection))
                }
            }
        }
    }

    private func switchWorkspace(selection: CloudWorkspaceLinkSelection) {
        Task { @MainActor in
            self.isSwitching = true
            defer {
                self.isSwitching = false
            }

            do {
                try await self.store.switchLinkedWorkspace(selection: selection)
                self.errorMessage = ""
                self.onDismiss()
            } catch {
                self.errorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }
}

private func currentWorkspaceSelectionButtonIdentifier(selection: CloudWorkspaceLinkSelection) -> String {
    switch selection {
    case .createNew:
        return UITestIdentifier.currentWorkspaceCreateButton
    case .existing(let workspaceId):
        return "currentWorkspace.existingWorkspace.\(workspaceId)"
    }
}

#Preview {
    NavigationStack {
        CurrentWorkspaceView()
            .environment(FlashcardsStore())
    }
}
