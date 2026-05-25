import SwiftUI

struct CloudWorkspaceSelectionSheet: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let linkContext: CloudWorkspaceLinkContext
    let isSelectionDisabled: Bool
    let onSelection: (CloudWorkspaceLinkSelection) -> Void
    let onCancelled: () -> Void

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
                                    self.onSelection(item.selection)
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
        }
    }
}

private func cloudWorkspaceSelectionButtonIdentifier(selection: CloudWorkspaceLinkSelection) -> String {
    switch selection {
    case .createNew:
        return UITestIdentifier.cloudSignInCreateWorkspaceButton
    case .existing(let workspaceId):
        return "cloudSignIn.existingWorkspace.\(workspaceId)"
    }
}

struct CloudWorkspaceSelectionItem: Identifiable, Hashable {
    let id: String
    let title: String
    let subtitle: String?
    let symbolName: String?
    let showsSelectedIndicator: Bool
    let selection: CloudWorkspaceLinkSelection
}

func makeCloudWorkspaceSelectionItems(
    workspaces: [CloudWorkspaceSummary],
    localWorkspaceName: String?
) -> [CloudWorkspaceSelectionItem] {
    let existingWorkspaceItems = workspaces.map { workspace in
        CloudWorkspaceSelectionItem(
            id: workspace.workspaceId,
            title: workspace.name,
            subtitle: workspace.createdAt,
            symbolName: nil,
            showsSelectedIndicator: workspace.isSelected,
            selection: .existing(workspaceId: workspace.workspaceId)
        )
    }
    let createWorkspaceTitle = makeCreateWorkspaceSelectionTitle(localWorkspaceName: localWorkspaceName)

    return existingWorkspaceItems + [
        CloudWorkspaceSelectionItem(
            id: "create-new-workspace",
            title: createWorkspaceTitle,
            subtitle: nil,
            symbolName: "plus.circle",
            showsSelectedIndicator: false,
            selection: .createNew
        )
    ]
}

func makeCreateWorkspaceSelectionTitle(localWorkspaceName: String?) -> String {
    guard let localWorkspaceName, localWorkspaceName.isEmpty == false else {
        return aiSettingsLocalized("settings.currentWorkspace.createNew", "Create new workspace")
    }

    return aiSettingsLocalizedFormat(
        "settings.currentWorkspace.createFromCurrent",
        "Create new workspace from \"%@\"",
        localWorkspaceName
    )
}

struct CloudWorkspaceSelectionRow: View {
    let item: CloudWorkspaceSelectionItem

    var body: some View {
        HStack(spacing: 12) {
            if let symbolName = self.item.symbolName {
                Image(systemName: symbolName)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 20)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(self.item.title)
                    .foregroundStyle(.primary)

                if let subtitle = self.item.subtitle {
                    Text(subtitle)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if self.item.showsSelectedIndicator {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }
}
