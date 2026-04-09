import SwiftUI

struct AccountAdvancedSettingsView: View {
    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.account.advanced.section.advanced", "Advanced")) {
                Text(
                    aiSettingsLocalized(
                        "settings.account.advanced.description",
                        "These settings are intended for technical users who know exactly which server they want to use."
                    )
                )
                    .foregroundStyle(.secondary)

                NavigationLink(value: SettingsNavigationDestination.accountServer) {
                    SettingsNavigationRow(
                        title: aiSettingsLocalized("settings.account.advanced.server", "Server"),
                        value: aiSettingsLocalized("settings.account.advanced.serverValue", "Custom domain"),
                        systemImage: "network"
                    )
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.account.advanced.title", "Advanced"))
    }
}

#Preview {
    NavigationStack {
        AccountAdvancedSettingsView()
    }
}
