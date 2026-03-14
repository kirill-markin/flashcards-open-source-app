import SwiftUI

struct AccountOpenSourceView: View {
    var body: some View {
        List {
            Section("Open Source") {
                Text("The iOS app and the backend are fully open source. You can inspect the code, use the MIT license, and run the full stack on your own servers.")
                    .foregroundStyle(.secondary)
            }

            Section("Links") {
                if let repositoryUrl = URL(string: flashcardsRepositoryUrl) {
                    Link(destination: repositoryUrl) {
                        SettingsNavigationRow(
                            title: "GitHub Repository",
                            value: "Open",
                            systemImage: "arrow.up.forward.square"
                        )
                    }
                }

                if let licenseUrl = URL(string: flashcardsRepositoryLicenseUrl) {
                    Link(destination: licenseUrl) {
                        SettingsNavigationRow(
                            title: "MIT License",
                            value: "Open",
                            systemImage: "doc.text"
                        )
                    }
                }
            }

            Section("Self-Hosting") {
                Text("If you need your own backend, you can deploy the same open-source stack yourself and point the iOS app to your domain from Advanced > Server.")
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Open Source")
    }
}

#Preview {
    NavigationStack {
        AccountOpenSourceView()
    }
}
