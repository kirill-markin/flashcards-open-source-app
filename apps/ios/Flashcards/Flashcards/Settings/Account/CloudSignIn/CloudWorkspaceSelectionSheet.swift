import SwiftUI

struct CloudWorkspaceSelectionSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let linkContext: CloudWorkspaceLinkContext
    let isSelectionDisabled: Bool
    let onSelection: (CloudWorkspaceLinkSelection) -> Void
    let onCancelled: () -> Void

    @State private var isCreateNameStepPresented: Bool = false

    private var selectionItems: [CloudWorkspaceSelectionItem] {
        makeCloudWorkspaceSelectionItems(
            workspaces: self.linkContext.workspaces,
            localWorkspaceName: self.store.workspace?.name
        )
    }

    var body: some View {
        NavigationStack {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 0
            ) {
                List {
                    Section(aiSettingsLocalized("settings.account.cloudSignIn.section.workspace", "Workspace")) {
                        Text(
                            aiSettingsLocalized(
                                "settings.account.cloudSignIn.workspaceDescription",
                                "Choose one option to continue: link this device to an existing cloud workspace or create a new cloud workspace."
                            )
                        )
                            .foregroundStyle(.secondary)
                    }

                    if self.selectionItems.isEmpty == false {
                        Section(aiSettingsLocalized("settings.currentWorkspace.section.chooseWorkspace", "Choose workspace")) {
                            ForEach(self.selectionItems) { item in
                                Button {
                                    self.handleSelection(selection: item.selection)
                                } label: {
                                    CloudWorkspaceSelectionRow(item: item)
                                }
                                .buttonStyle(.plain)
                                .disabled(self.isSelectionDisabled)
                                .accessibilityIdentifier(cloudWorkspaceSelectionButtonIdentifier(selection: item.selection))
                            }
                        }
                    }
                }
            }
            .accessibilityIdentifier(UITestIdentifier.cloudWorkspaceChooserScreen)
            .navigationTitle(aiSettingsLocalized("settings.currentWorkspace.chooseWorkspaceTitle", "Choose workspace"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(aiSettingsLocalized("common.close", "Close")) {
                        self.onCancelled()
                    }
                }
            }
            .navigationDestination(isPresented: self.$isCreateNameStepPresented) {
                CloudWorkspaceCreateNameView(
                    isSubmitting: self.isSelectionDisabled,
                    guidanceMessage: "",
                    onCreate: { name in
                        self.onSelection(.createNewNamed(name: name))
                    }
                )
            }
        }
    }

    private func handleSelection(selection: CloudWorkspaceLinkSelection) {
        switch selection {
        case .createNew:
            self.isCreateNameStepPresented = true
        case .existing, .createNewNamed:
            self.onSelection(selection)
        }
    }
}

private func cloudWorkspaceSelectionButtonIdentifier(selection: CloudWorkspaceLinkSelection) -> String {
    switch selection {
    case .createNew, .createNewNamed:
        return UITestIdentifier.cloudSignInCreateWorkspaceButton
    case .existing(let workspaceId):
        return "cloudSignIn.existingWorkspace.\(workspaceId)"
    }
}
