import SwiftUI

/// Pushed after an explicit "Create new workspace" tap; automatic workspace creation never asks for a name.
struct CloudWorkspaceCreateNameView: View {
    let isSubmitting: Bool
    let guidanceMessage: String
    let onCreate: (String) -> Void

    @State private var workspaceNameDraft: String = ""
    @FocusState private var isWorkspaceNameFieldFocused: Bool

    private var trimmedWorkspaceName: String {
        self.workspaceNameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isCreateDisabled: Bool {
        self.isSubmitting || self.trimmedWorkspaceName.isEmpty
    }

    var body: some View {
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
                    .accessibilityIdentifier(UITestIdentifier.cloudWorkspaceCreateNameField)
                    .onSubmit {
                        self.submitIfEnabled()
                    }

                if self.guidanceMessage.isEmpty == false {
                    Text(self.guidanceMessage)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(aiSettingsLocalized("settings.currentWorkspace.createNew", "Create new workspace"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(self.isSubmitting)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    self.submitIfEnabled()
                } label: {
                    if self.isSubmitting {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text(aiSettingsLocalized("common.create", "Create"))
                    }
                }
                .disabled(self.isCreateDisabled)
                .accessibilityIdentifier(UITestIdentifier.cloudWorkspaceCreateNameConfirmButton)
            }
        }
        .task {
            await Task.yield()
            self.isWorkspaceNameFieldFocused = true
        }
    }

    private func submitIfEnabled() {
        guard self.isCreateDisabled == false else {
            return
        }

        self.onCreate(self.trimmedWorkspaceName)
    }
}
