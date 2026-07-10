import SwiftUI
import UIKit

struct LocalSyncDiagnosticsView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    @State private var snapshot: LocalSyncDiagnosticsSnapshot?
    @State private var isLoading: Bool = false

    var body: some View {
        List {
            if let snapshot {
                ForEach(snapshot.displaySections) { section in
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
                        Text(aiSettingsLocalized("settings.localSyncDiagnostics.loading", "Loading diagnostics..."))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.localSyncDiagnosticsScreen)
        .navigationTitle(aiSettingsLocalized("settings.localSyncDiagnostics.title", "Local Sync Diagnostics"))
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    self.copySnapshot()
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .disabled(self.snapshot == nil)
                .accessibilityLabel(aiSettingsLocalized("settings.localSyncDiagnostics.copy", "Copy diagnostics"))

                Button {
                    Task { @MainActor in
                        await self.reloadSnapshot()
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(self.isLoading)
                .accessibilityLabel(aiSettingsLocalized("settings.localSyncDiagnostics.refresh", "Refresh"))
            }
        }
        .task(id: store.workspace?.workspaceId) {
            await self.reloadSnapshot()
        }
    }

    @MainActor
    private func reloadSnapshot() async {
        self.isLoading = true
        do {
            self.snapshot = try await store.loadLocalSyncDiagnosticsSnapshot()
        } catch {
            store.presentTechnicalError(error)
        }
        self.isLoading = false
    }

    @MainActor
    private func copySnapshot() {
        guard let snapshot else {
            return
        }

        do {
            UIPasteboard.general.string = try localSyncDiagnosticsReportText(snapshot: snapshot)
        } catch {
            store.presentTechnicalError(error)
        }
    }
}

#Preview {
    NavigationStack {
        LocalSyncDiagnosticsView()
            .environment(FlashcardsStore())
    }
}
