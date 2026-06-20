import SwiftUI

struct NotificationDiagnosticsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var snapshot: NotificationDiagnosticsSnapshot?
    @State private var isLoading: Bool = false

    var body: some View {
        List {
            if let snapshot {
                ForEach(snapshot.sections) { section in
                    Section(section.title) {
                        ForEach(section.rows) { row in
                            LabeledContent(row.title) {
                                Text(row.value)
                                    .font(.caption.monospaced())
                                    .multilineTextAlignment(.trailing)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                }
            } else {
                Section {
                    HStack(spacing: 12) {
                        ProgressView()
                        Text(aiSettingsLocalized("settings.notificationDiagnostics.loading", "Loading diagnostics..."))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.notificationDiagnosticsScreen)
        .navigationTitle(aiSettingsLocalized("settings.notificationDiagnostics.title", "Notification Diagnostics"))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { @MainActor in
                        await self.reloadSnapshot()
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(self.isLoading)
                .accessibilityLabel(aiSettingsLocalized("settings.notificationDiagnostics.refresh", "Refresh"))
            }
        }
        .task(id: store.workspace?.workspaceId) {
            await self.reloadSnapshot()
        }
    }

    @MainActor
    private func reloadSnapshot() async {
        self.isLoading = true
        self.snapshot = await loadNotificationDiagnosticsSnapshot(
            userDefaults: store.userDefaults,
            decoder: store.decoder,
            workspaceId: store.workspace?.workspaceId,
            workspaceName: store.workspace?.name,
            reviewSettings: store.reviewNotificationsSettings,
            strictRemindersSettings: store.strictRemindersSettings
        )
        self.isLoading = false
    }
}

#Preview {
    NavigationStack {
        NotificationDiagnosticsView()
            .environment(FlashcardsStore())
    }
}
