import SwiftUI

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
