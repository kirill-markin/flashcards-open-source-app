import SwiftUI

struct WorkspaceSettingsView: View {
    @EnvironmentObject private var store: FlashcardsStore
    @State private var overviewSnapshot: WorkspaceOverviewSnapshot? = nil
    @State private var errorMessage: String = ""

    var body: some View {
        List {
            if self.errorMessage.isEmpty == false || store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.errorMessage.isEmpty ? store.globalErrorMessage : self.errorMessage)
                }
            }

            Section("Workspace Data") {
                NavigationLink(value: SettingsNavigationDestination.workspaceDecks) {
                    SettingsNavigationRow(
                        title: "Decks",
                        value: "\(self.overviewSnapshot?.deckCount ?? 0)",
                        systemImage: "line.3.horizontal.decrease.circle"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.workspaceTags) {
                    SettingsNavigationRow(
                        title: "Tags",
                        value: "\(self.overviewSnapshot?.tagsCount ?? 0)",
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
        .task(id: store.localReadVersion) {
            await self.reloadWorkspaceOverview()
        }
    }

    @MainActor
    private func reloadWorkspaceOverview() async {
        guard let database = store.database, let workspace = store.workspace else {
            self.overviewSnapshot = nil
            self.errorMessage = ""
            return
        }

        self.errorMessage = ""

        do {
            self.overviewSnapshot = try database.loadWorkspaceOverviewSnapshot(
                workspaceId: workspace.workspaceId,
                workspaceName: workspace.name,
                now: Date()
            )
        } catch {
            self.errorMessage = Flashcards.errorMessage(error: error)
        }
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
