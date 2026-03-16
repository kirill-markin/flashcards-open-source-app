import SwiftUI

struct AccountSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    var body: some View {
        List {
            if store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: store.globalErrorMessage)
                }
            }

            Section("Account Settings") {
                NavigationLink(value: SettingsNavigationDestination.accountStatus) {
                    SettingsNavigationRow(
                        title: "Account Status",
                        value: displayCloudAccountStateTitle(cloudState: store.cloudSettings?.cloudState ?? .disconnected),
                        systemImage: "person.crop.circle"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.accountLegalSupport) {
                    SettingsNavigationRow(
                        title: "Legal & Support",
                        value: "Privacy + Support",
                        systemImage: "doc.text"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.accountOpenSource) {
                    SettingsNavigationRow(
                        title: "Open Source",
                        value: "GitHub + MIT",
                        systemImage: "chevron.left.forwardslash.chevron.right"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.accountAdvanced) {
                    SettingsNavigationRow(
                        title: "Advanced",
                        value: "Server",
                        systemImage: "gearshape.2"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.accountAgentConnections) {
                    SettingsNavigationRow(
                        title: "Agent Connections",
                        value: "Connections",
                        systemImage: "link"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.accountDangerZone) {
                    SettingsNavigationRow(
                        title: "Danger Zone",
                        value: "Delete",
                        systemImage: "exclamationmark.triangle"
                    )
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Account Settings")
    }
}

#Preview {
    NavigationStack {
        AccountSettingsView()
            .environment(FlashcardsStore())
    }
}
