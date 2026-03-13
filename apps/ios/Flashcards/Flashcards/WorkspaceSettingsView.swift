import SwiftUI

struct WorkspaceSettingsView: View {
    @EnvironmentObject private var store: FlashcardsStore

    private var tagsCount: Int {
        workspaceTagsSummary(cards: store.cards).tags.count
    }

    var body: some View {
        List {
            if store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: store.globalErrorMessage)
                }
            }

            Section("Workspace Data") {
                NavigationLink(value: SettingsNavigationDestination.workspaceDecks) {
                    SettingsNavigationRow(
                        title: "Decks",
                        value: "\(store.homeSnapshot.deckCount)",
                        systemImage: "line.3.horizontal.decrease.circle"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.workspaceTags) {
                    SettingsNavigationRow(
                        title: "Tags",
                        value: "\(self.tagsCount)",
                        systemImage: "tag"
                    )
                }
            }

            Section("Settings") {
                NavigationLink(value: SettingsNavigationDestination.workspaceOverview) {
                    SettingsNavigationRow(
                        title: "Overview",
                        value: store.workspace?.name ?? "Unavailable",
                        systemImage: "square.text.square"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.workspaceScheduler) {
                    SettingsNavigationRow(
                        title: "Scheduler",
                        value: schedulerSummaryValue(settings: store.schedulerSettings),
                        systemImage: "calendar.badge.clock"
                    )
                }
            }

            Section("Device") {
                NavigationLink(value: SettingsNavigationDestination.workspaceDevice) {
                    SettingsNavigationRow(
                        title: "This Device",
                        value: "SwiftUI + SQLite",
                        systemImage: "internaldrive"
                    )
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Workspace Settings")
    }
}

private func schedulerSummaryValue(settings: WorkspaceSchedulerSettings?) -> String {
    guard let settings else {
        return "Unavailable"
    }

    return "\(settings.algorithm.uppercased()) \(formatSchedulerRetentionValue(value: settings.desiredRetention))"
}

#Preview {
    NavigationStack {
        WorkspaceSettingsView()
            .environmentObject(FlashcardsStore())
    }
}
