import SwiftUI

struct WorkspaceSettingsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @State private var overviewSnapshot: WorkspaceOverviewSnapshot? = nil
    @State private var errorMessage: String = ""
    @State private var isResetProgressAlertPresented: Bool = false
    @State private var isResetProgressConfirmationPresented: Bool = false

    var body: some View {
        List {
            if self.errorMessage.isEmpty == false || store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.errorMessage.isEmpty ? store.globalErrorMessage : self.errorMessage)
                }
            }

            Section {
                NavigationLink(value: SettingsNavigationDestination.workspaceOverview) {
                    SettingsNavigationRow(
                        title: "Overview",
                        value: store.workspace?.name ?? "Unavailable",
                        systemImage: "square.text.square"
                    )
                }
                .accessibilityIdentifier(UITestIdentifier.workspaceSettingsOverviewRow)
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
                NavigationLink(value: SettingsNavigationDestination.workspaceScheduler) {
                    SettingsNavigationRow(
                        title: "Scheduler",
                        value: schedulerSummaryValue(settings: store.schedulerSettings),
                        systemImage: "calendar.badge.clock"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.workspaceNotifications) {
                    SettingsNavigationRow(
                        title: "Notifications",
                        value: "This Device",
                        systemImage: "bell.badge"
                    )
                }

                NavigationLink(value: SettingsNavigationDestination.workspaceExport) {
                    SettingsNavigationRow(
                        title: "Export",
                        value: "CSV",
                        systemImage: "square.and.arrow.up"
                    )
                }
            }

            Section("Danger Zone") {
                Text("Permanently reset study progress for every card in this workspace.")
                    .foregroundStyle(.secondary)

                Button("Reset all progress", role: .destructive) {
                    self.isResetProgressAlertPresented = true
                }
                .disabled(store.cloudSettings?.cloudState != .linked || store.workspace == nil)
                .accessibilityIdentifier(UITestIdentifier.workspaceSettingsResetProgressButton)
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.workspaceSettingsScreen)
        .navigationTitle("Workspace Settings")
        .alert("Reset all progress?", isPresented: self.$isResetProgressAlertPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Continue", role: .destructive) {
                self.isResetProgressConfirmationPresented = true
            }
        } message: {
            Text("This permanently resets study progress for all cards in the current workspace.")
        }
        .fullScreenCover(isPresented: self.$isResetProgressConfirmationPresented) {
            ResetWorkspaceProgressConfirmationView(isPresented: self.$isResetProgressConfirmationPresented)
                .environment(store)
        }
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
            .environment(FlashcardsStore())
    }
}
