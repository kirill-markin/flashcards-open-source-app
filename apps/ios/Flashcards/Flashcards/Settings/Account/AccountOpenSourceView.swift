import SwiftUI

struct AccountOpenSourceView: View {
    var body: some View {
        List {
            Section(aiSettingsLocalized("settings.account.openSource.section.openSource", "Open Source")) {
                Text(
                    aiSettingsLocalized(
                        "settings.account.openSource.description",
                        "The iOS app and the backend are fully open source. You can inspect the code, use the MIT license, and run the full stack on your own servers."
                    )
                )
                    .foregroundStyle(.secondary)
            }

            Section(aiSettingsLocalized("settings.account.openSource.section.links", "Links")) {
                if let repositoryUrl = URL(string: flashcardsRepositoryUrl) {
                    Link(destination: repositoryUrl) {
                        SettingsNavigationRow(
                            title: aiSettingsLocalized("settings.account.openSource.repository", "GitHub Repository (MIT License)"),
                            value: aiSettingsLocalized("common.open", "Open"),
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }
            }

            Section(aiSettingsLocalized("settings.account.openSource.section.selfHosting", "Self-Hosting")) {
                Text(
                    aiSettingsLocalized(
                        "settings.account.openSource.selfHosting",
                        "If you need your own backend, you can deploy the same open-source stack yourself and point the iOS app to your domain from Advanced > Server."
                    )
                )
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.account.openSource.title", "Open Source"))
    }
}

#Preview {
    NavigationStack {
        AccountOpenSourceView()
    }
}
