import SwiftUI

struct CurrentWorkspaceView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var linkedWorkspaces: [CloudWorkspaceSummary]? = nil
    @State private var isWorkspacePickerPresented: Bool = false
    @State private var isWorkspacePickerLoading: Bool = false
    @State private var workspacePickerGuidanceMessage: String = ""
    @State private var isRenameSheetPresented: Bool = false

    private var currentWorkspaceName: String {
        self.store.workspace?.name ?? aiSettingsLocalized("common.unavailable", "Unavailable")
    }

    private var isWorkspaceManagementLocked: Bool {
        self.store.cloudSettings?.cloudState != .linked
    }

    var body: some View {
        List {
            Section {
                LabeledContent(
                    aiSettingsLocalized("settings.currentWorkspace.currentWorkspace", "Current Workspace")
                ) {
                    Text(self.currentWorkspaceName)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Button {
                    self.handleChangeWorkspaceTap()
                } label: {
                    HStack {
                        Label(
                            aiSettingsLocalized("settings.currentWorkspace.changeWorkspace", "Change Workspace"),
                            systemImage: "arrow.triangle.2.circlepath"
                        )

                        Spacer()

                        if self.isWorkspacePickerLoading {
                            ProgressView()
                        }
                    }
                }
                .disabled(self.isWorkspacePickerLoading)
                .accessibilityIdentifier(UITestIdentifier.currentWorkspaceChangeButton)

                Button {
                    self.handleRenameWorkspaceTap()
                } label: {
                    Label(
                        aiSettingsLocalized("settings.currentWorkspace.renameWorkspace", "Rename Workspace"),
                        systemImage: "pencil"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.currentWorkspaceRenameButton)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.currentWorkspaceScreen)
        .navigationTitle(aiSettingsLocalized("settings.currentWorkspace.title", "Workspace"))
        .sheet(isPresented: self.$isWorkspacePickerPresented) {
            CurrentWorkspacePickerContainer(
                workspaces: self.linkedWorkspaces,
                isLoading: self.isWorkspacePickerLoading,
                guidanceMessage: self.workspacePickerGuidanceMessage,
                localWorkspaceName: self.currentWorkspaceName,
                onDismiss: {
                    self.isWorkspacePickerPresented = false
                }
            )
            .environment(self.store)
            .technicalErrorSheetHost(store: self.store)
        }
        .sheet(isPresented: self.$isRenameSheetPresented) {
            CurrentWorkspaceRenameSheet(
                initialWorkspaceName: self.store.workspace?.name ?? ""
            )
            .environment(self.store)
            .technicalErrorSheetHost(store: self.store)
        }
    }

    private func handleChangeWorkspaceTap() {
        guard self.authorizeWorkspaceManagementAction() else {
            return
        }

        self.presentWorkspacePicker()
    }

    private func handleRenameWorkspaceTap() {
        guard self.authorizeWorkspaceManagementAction() else {
            return
        }

        self.isRenameSheetPresented = true
    }

    private func authorizeWorkspaceManagementAction() -> Bool {
        guard self.isWorkspaceManagementLocked == false else {
            self.store.enqueueTransientBanner(banner: makeWorkspaceChangesRequireAccountBanner())
            return false
        }

        return true
    }

    private func presentWorkspacePicker() {
        self.linkedWorkspaces = nil
        self.workspacePickerGuidanceMessage = ""
        self.isWorkspacePickerLoading = true
        self.isWorkspacePickerPresented = true

        Task { @MainActor in
            defer {
                self.isWorkspacePickerLoading = false
            }

            do {
                self.linkedWorkspaces = try await self.store.listLinkedWorkspaces()
            } catch {
                if let guidanceMessage = self.store.workspaceOperationGuidanceMessage(error: error) {
                    self.workspacePickerGuidanceMessage = guidanceMessage
                } else if self.store.shouldPresentWorkspaceOperationTechnicalError(error: error) {
                    self.store.presentTechnicalError(error)
                }
            }
        }
    }
}

private struct CurrentWorkspaceRenameSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(\.dismiss) private var dismiss

    let initialWorkspaceName: String

    @State private var workspaceNameDraft: String
    @State private var guidanceMessage: String = ""
    @State private var isSubmitting: Bool = false
    @FocusState private var isWorkspaceNameFieldFocused: Bool

    private var trimmedWorkspaceName: String {
        self.workspaceNameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isSaveDisabled: Bool {
        self.isSubmitting
            || self.trimmedWorkspaceName.isEmpty
            || self.trimmedWorkspaceName
                == self.initialWorkspaceName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    init(initialWorkspaceName: String) {
        self.initialWorkspaceName = initialWorkspaceName
        self._workspaceNameDraft = State(initialValue: initialWorkspaceName)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(
                        aiSettingsLocalized("settings.workspace.overview.workspaceName", "Workspace name"),
                        text: self.$workspaceNameDraft
                    )
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled(true)
                        .submitLabel(.done)
                        .focused(self.$isWorkspaceNameFieldFocused)
                        .accessibilityIdentifier(UITestIdentifier.currentWorkspaceNameField)
                        .onSubmit {
                            self.submitRenameIfEnabled()
                        }

                    if self.guidanceMessage.isEmpty == false {
                        Text(self.guidanceMessage)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(
                aiSettingsLocalized("settings.currentWorkspace.renameWorkspace", "Rename Workspace")
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(aiSettingsLocalized("common.cancel", "Cancel")) {
                        self.dismiss()
                    }
                    .disabled(self.isSubmitting)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        self.submitRenameIfEnabled()
                    } label: {
                        if self.isSubmitting {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Text(aiSettingsLocalized("settings.workspace.overview.saveName", "Save Name"))
                        }
                    }
                    .disabled(self.isSaveDisabled)
                    .accessibilityIdentifier(UITestIdentifier.currentWorkspaceSaveNameButton)
                }
            }
        }
        .accessibilityIdentifier(UITestIdentifier.currentWorkspaceRenameSheet)
        .interactiveDismissDisabled(self.isSubmitting)
        .presentationDetents([.medium])
        .task {
            self.workspaceNameDraft = self.initialWorkspaceName
            self.guidanceMessage = ""
            await Task.yield()
            self.isWorkspaceNameFieldFocused = true
        }
    }

    @MainActor
    private func submitRenameIfEnabled() {
        guard self.isSaveDisabled == false else {
            return
        }

        self.isSubmitting = true
        self.guidanceMessage = ""

        Task {
            await self.renameWorkspace()
        }
    }

    @MainActor
    private func renameWorkspace() async {
        do {
            try await self.store.renameCurrentWorkspace(name: self.trimmedWorkspaceName)
            self.isSubmitting = false
            self.dismiss()
        } catch {
            if let guidanceMessage = self.store.workspaceOperationGuidanceMessage(error: error) {
                self.guidanceMessage = guidanceMessage
            } else if self.store.shouldPresentWorkspaceOperationTechnicalError(error: error) {
                self.store.presentTechnicalError(error)
            }

            self.isSubmitting = false
        }
    }
}

private struct CurrentWorkspacePickerContainer: View {
    let workspaces: [CloudWorkspaceSummary]?
    let isLoading: Bool
    let guidanceMessage: String
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
                    Text(
                        self.guidanceMessage.isEmpty
                            ? aiSettingsLocalized("settings.currentWorkspace.loadError", "Failed to load linked workspaces.")
                            : self.guidanceMessage
                    )
                        .foregroundStyle(.secondary)
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

    @State private var isSwitching: Bool = false
    @State private var guidanceMessage: String = ""

    private var selectionItems: [CloudWorkspaceSelectionItem] {
        makeCloudWorkspaceSelectionItems(workspaces: self.workspaces, localWorkspaceName: self.localWorkspaceName)
    }

    var body: some View {
        List {
            if self.guidanceMessage.isEmpty == false {
                Section {
                    Text(self.guidanceMessage)
                        .foregroundStyle(.secondary)
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
                    .disabled(self.isSwitching || item.showsSelectedIndicator)
                    .accessibilityAddTraits(item.showsSelectedIndicator ? .isSelected : [])
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
                self.guidanceMessage = ""
                try await self.store.switchLinkedWorkspace(selection: selection)
                self.onDismiss()
            } catch {
                if let guidanceMessage = self.store.workspaceOperationGuidanceMessage(error: error) {
                    self.guidanceMessage = guidanceMessage
                } else if self.store.shouldPresentWorkspaceOperationTechnicalError(error: error) {
                    self.store.presentTechnicalError(error)
                }
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
