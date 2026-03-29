import SwiftUI

enum SyncStatusTone: Equatable {
    case success
    case inProgress
    case failure
    case neutral
}

struct SyncStatusPresentation: Equatable {
    let title: String
    let tone: SyncStatusTone
}

struct SettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    private var isWorkspaceManagementLocked: Bool {
        self.store.cloudSettings?.cloudState != .linked
    }

    var body: some View {
        List {
            if store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: store.globalErrorMessage)
                }
            }

            Section {
                if self.isWorkspaceManagementLocked {
                    SettingsNavigationRow(
                        title: "Current Workspace",
                        value: store.workspace?.name ?? "Unavailable",
                        systemImage: "square.stack"
                    )
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(UITestIdentifier.settingsCurrentWorkspaceRow)
                } else {
                    NavigationLink(value: SettingsNavigationDestination.currentWorkspace) {
                        SettingsNavigationRow(
                            title: "Current Workspace",
                            value: store.workspace?.name ?? "Unavailable",
                            systemImage: "square.stack"
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.settingsCurrentWorkspaceRow)
                }
            }

            Section {
                NavigationLink(value: SettingsNavigationDestination.workspace) {
                    SettingsNavigationRow(
                        title: "Workspace Settings",
                        value: store.workspace?.name ?? "Unavailable",
                        systemImage: "square.grid.2x2"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsWorkspaceSettingsRow)

                NavigationLink(value: SettingsNavigationDestination.account) {
                    SettingsNavigationRow(
                        title: "Account Settings",
                        value: displayCloudAccountStateTitle(cloudState: store.cloudSettings?.cloudState ?? .disconnected),
                        systemImage: "person.crop.circle"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsAccountSettingsRow)
            }

            Section {
                NavigationLink(value: SettingsNavigationDestination.device) {
                    SettingsNavigationRow(
                        title: "This Device",
                        value: "SwiftUI + SQLite",
                        systemImage: "internaldrive"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.access) {
                    SettingsNavigationRow(
                        title: "Access",
                        value: "4 items",
                        systemImage: "hand.raised"
                    )
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.settingsScreen)
        .navigationTitle("Settings")
    }
}

struct SettingsNavigationRow: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            Label(title, systemImage: systemImage)

            Spacer()

            Text(value)
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }
}

func makeSyncStatusPresentation(status: SyncStatus, cloudState: CloudAccountState) -> SyncStatusPresentation {
    switch status {
    case .idle:
        switch cloudState {
        case .linked:
            return SyncStatusPresentation(title: "Successfully synced", tone: .success)
        case .guest:
            return SyncStatusPresentation(title: "Guest AI is active", tone: .neutral)
        case .disconnected, .linkingReady:
            return SyncStatusPresentation(title: "Not syncing", tone: .neutral)
        }
    case .syncing:
        return SyncStatusPresentation(title: "Syncing", tone: .inProgress)
    case .failed(let message):
        return SyncStatusPresentation(title: "Sync failed: \(message)", tone: .failure)
    }
}

func displayCloudAccountStateTitle(cloudState: CloudAccountState) -> String {
    switch cloudState {
    case .linked:
        return cloudState.title
    case .guest:
        return cloudState.title
    case .disconnected, .linkingReady:
        return CloudAccountState.disconnected.title
    }
}

func isSyncInFlight(status: SyncStatus) -> Bool {
    switch status {
    case .syncing:
        return true
    case .idle, .failed:
        return false
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environment(FlashcardsStore())
    }
}
