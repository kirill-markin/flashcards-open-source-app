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

            Section {
                NavigationLink(value: SettingsNavigationDestination.accountStatus) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.account.row.accountStatus", "Account Status"),
                        value: displayCloudAccountStateTitle(cloudState: store.cloudSettings?.cloudState ?? .disconnected),
                        systemImage: "person.crop.circle"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.accountSettingsAccountStatusRow)
            }

            Section(aiSettingsLocalized("settings.account.section.support", "Support")) {
                NavigationLink(value: SettingsNavigationDestination.accountLegalSupport) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.account.row.legalSupport", "Legal & Support"),
                        value: aiSettingsLocalized("settings.account.row.legalSupportValue", "Privacy + Support"),
                        systemImage: "doc.text"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.accountOpenSource) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.account.row.openSource", "Open Source"),
                        value: aiSettingsLocalized("settings.account.row.openSourceValue", "GitHub + MIT"),
                        systemImage: "chevron.left.forwardslash.chevron.right"
                    )
                }
            }

            Section {
                NavigationLink(value: SettingsNavigationDestination.accountAdvanced) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.account.row.advanced", "Advanced"),
                        value: aiSettingsLocalized("settings.account.row.serverValue", "Server"),
                        systemImage: "gearshape.2"
                    )
                }
            }

            Section(aiSettingsLocalized("settings.account.section.connections", "Connections")) {
                NavigationLink(value: SettingsNavigationDestination.accountAgentConnections) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.account.row.agentConnections", "Agent Connections"),
                        value: aiSettingsLocalized("settings.account.row.agentConnectionsValue", "Connections"),
                        systemImage: "link"
                    )
                }
            }

            Section {
                NavigationLink(value: SettingsNavigationDestination.accountDangerZone) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.account.row.dangerZone", "Danger Zone"),
                        value: aiSettingsLocalized("settings.account.row.dangerZoneValue", "Delete"),
                        systemImage: "exclamationmark.triangle"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.accountSettingsDangerZoneRow)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.accountSettingsScreen)
        .navigationTitle(aiSettingsLocalized("settings.account.title", "Account Settings"))
    }
}

#Preview {
    NavigationStack {
        AccountSettingsView()
            .environment(FlashcardsStore())
    }
}
