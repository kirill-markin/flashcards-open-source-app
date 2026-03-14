import SwiftUI

struct AccountAdvancedSettingsView: View {
    var body: some View {
        List {
            Section("Advanced") {
                Text("These settings are intended for technical users who know exactly which server they want to use.")
                    .foregroundStyle(.secondary)

                NavigationLink(value: SettingsNavigationDestination.accountServer) {
                    SettingsNavigationRow(
                        title: "Server",
                        value: "Custom domain",
                        systemImage: "network"
                    )
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Advanced")
    }
}

#Preview {
    NavigationStack {
        AccountAdvancedSettingsView()
    }
}
