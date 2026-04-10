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
                        title: aiSettingsLocalized("settings.row.currentWorkspace", "Current Workspace"),
                        value: store.workspace?.name ?? aiSettingsLocalized("common.unavailable", "Unavailable"),
                        systemImage: "square.stack"
                    )
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier(UITestIdentifier.settingsCurrentWorkspaceRow)
                } else {
                    NavigationLink(value: SettingsNavigationDestination.currentWorkspace) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.row.currentWorkspace", "Current Workspace"),
                            value: store.workspace?.name ?? aiSettingsLocalized("common.unavailable", "Unavailable"),
                            systemImage: "square.stack"
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.settingsCurrentWorkspaceRow)
                }
            }

            Section {
                NavigationLink(value: SettingsNavigationDestination.workspace) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.workspaceSettings", "Workspace Settings"),
                        value: store.workspace?.name ?? aiSettingsLocalized("common.unavailable", "Unavailable"),
                        systemImage: "square.grid.2x2"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsWorkspaceSettingsRow)

                NavigationLink(value: SettingsNavigationDestination.account) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.accountSettings", "Account Settings"),
                        value: displayCloudAccountStateTitle(cloudState: store.cloudSettings?.cloudState ?? .disconnected),
                        systemImage: "person.crop.circle"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.settingsAccountSettingsRow)
            }

            Section {
                NavigationLink(value: SettingsNavigationDestination.device) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.thisDevice", "This Device"),
                        value: "SwiftUI + SQLite",
                        systemImage: "internaldrive"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.access) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.row.access", "Access"),
                        value: aiSettingsLocalized("settings.row.access.itemCount", "4 items"),
                        systemImage: "hand.raised"
                    )
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.settingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.title", "Settings"))
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
            return SyncStatusPresentation(
                title: aiSettingsLocalized("settings.sync.success", "Successfully synced"),
                tone: .success
            )
        case .guest:
            return SyncStatusPresentation(
                title: aiSettingsLocalized("settings.sync.guestAiActive", "Guest AI is active"),
                tone: .neutral
            )
        case .disconnected, .linkingReady:
            return SyncStatusPresentation(
                title: aiSettingsLocalized("settings.sync.notSyncing", "Not syncing"),
                tone: .neutral
            )
        }
    case .syncing:
        return SyncStatusPresentation(
            title: aiSettingsLocalized("settings.sync.syncing", "Syncing"),
            tone: .inProgress
        )
    case .blocked(let message):
        return SyncStatusPresentation(
            title: aiSettingsLocalizedFormat("settings.sync.blocked", "Sync blocked: %@", message),
            tone: .failure
        )
    case .failed(let message):
        return SyncStatusPresentation(
            title: aiSettingsLocalizedFormat("settings.sync.failed", "Sync failed: %@", message),
            tone: .failure
        )
    }
}

func displayCloudAccountStateTitle(cloudState: CloudAccountState) -> String {
    switch cloudState {
    case .linked:
        return localizedCloudAccountStateTitle(cloudState)
    case .guest:
        return localizedCloudAccountStateTitle(cloudState)
    case .disconnected, .linkingReady:
        return localizedCloudAccountStateTitle(.disconnected)
    }
}

func isSyncInFlight(status: SyncStatus) -> Bool {
    switch status {
    case .syncing:
        return true
    case .idle, .blocked, .failed:
        return false
    }
}

#Preview("Default") {
    NavigationStack {
        SettingsView()
            .environment(FlashcardsStore())
    }
}

#Preview("Arabic RTL") {
    NavigationStack {
        SettingsView()
            .environment(FlashcardsStore())
    }
    .arabicRTLPreview()
}
