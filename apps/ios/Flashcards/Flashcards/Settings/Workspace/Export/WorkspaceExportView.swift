import SwiftUI
import UIKit

struct WorkspaceExportView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @State private var guidanceMessage: String = ""
    @State private var isExporting: Bool = false
    @State private var exportedFileURL: URL? = nil
    @State private var isShareSheetPresented: Bool = false

    var body: some View {
        List {
            if self.guidanceMessage.isEmpty == false {
                Section {
                    Text(self.guidanceMessage)
                        .foregroundStyle(.secondary)
                }
            }

            Section(aiSettingsLocalized("settings.workspace.export.section.availableFormats", "Available Formats")) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("CSV")
                        .font(.headline)

                    Text(
                        aiSettingsLocalized(
                            "settings.workspace.export.description",
                            "Exports front text, back text, and tags for all active cards in the current workspace."
                        )
                    )
                        .foregroundStyle(.secondary)

                    Button(
                        self.isExporting
                            ? aiSettingsLocalized("settings.workspace.export.exporting", "Exporting...")
                            : aiSettingsLocalized("settings.workspace.export.exportCsv", "Export CSV")
                    ) {
                        Task {
                            await self.exportCsv()
                        }
                    }
                    .disabled(self.isExporting)
                }
                .padding(.vertical, 4)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.workspace.row.export", "Export"))
        .sheet(
            isPresented: self.$isShareSheetPresented,
            onDismiss: {
                self.cleanupExportedFile()
            }
        ) {
            if let exportedFileURL = self.exportedFileURL {
                WorkspaceExportActivitySheet(activityItems: [exportedFileURL])
            } else {
                Text(aiSettingsLocalized("settings.workspace.export.fileUnavailable", "Export file is unavailable."))
            }
        }
    }

    @MainActor
    private func exportCsv() async {
        guard let database = store.database, let workspace = store.workspace else {
            self.guidanceMessage = aiSettingsLocalized("settings.workspace.export.workspaceUnavailable", "Workspace is unavailable")
            return
        }

        guard self.cleanupExportedFile() else {
            return
        }
        self.guidanceMessage = ""
        self.isExporting = true

        do {
            let fileManager = FileManager.default
            self.exportedFileURL = try prepareWorkspaceCardsCsvExport(
                database: database,
                workspace: workspace,
                now: Date(),
                calendar: Calendar.current,
                fileManager: fileManager,
                temporaryDirectory: fileManager.temporaryDirectory
            )
            self.isShareSheetPresented = true
        } catch {
            self.store.presentTechnicalError(error)
        }

        self.isExporting = false
    }

    @MainActor
    @discardableResult
    private func cleanupExportedFile() -> Bool {
        guard let exportedFileURL = self.exportedFileURL else {
            return true
        }

        do {
            if FileManager.default.fileExists(atPath: exportedFileURL.path) {
                try FileManager.default.removeItem(at: exportedFileURL)
            }
        } catch {
            self.store.presentTechnicalError(error)
            return false
        }

        self.exportedFileURL = nil
        return true
    }
}

private struct WorkspaceExportActivitySheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

#Preview {
    NavigationStack {
        WorkspaceExportView()
            .environment(FlashcardsStore())
    }
}
