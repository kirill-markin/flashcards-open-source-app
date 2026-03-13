import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: FlashcardsStore

    var body: some View {
        List {
            if store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: store.globalErrorMessage)
                }
            }

            Section("Settings") {
                NavigationLink(value: SettingsNavigationDestination.workspace) {
                    SettingsNavigationRow(
                        title: "Workspace Settings",
                        value: store.workspace?.name ?? "Unavailable",
                        systemImage: "square.grid.2x2"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.account) {
                    SettingsNavigationRow(
                        title: "Account Settings",
                        value: displayCloudAccountStateTitle(cloudState: store.cloudSettings?.cloudState ?? .disconnected),
                        systemImage: "person.crop.circle"
                    )
                }
            }
        }
        .listStyle(.insetGrouped)
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

func syncStatusTitle(status: SyncStatus) -> String {
    switch status {
    case .idle:
        return "Idle"
    case .syncing:
        return "Syncing"
    case .failed(let message):
        return "Failed: \(message)"
    }
}

func displayCloudAccountStateTitle(cloudState: CloudAccountState) -> String {
    switch cloudState {
    case .linked:
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
            .environmentObject(FlashcardsStore())
    }
}
