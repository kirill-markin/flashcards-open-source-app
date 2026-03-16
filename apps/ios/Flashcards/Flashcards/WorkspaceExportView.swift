import SwiftUI
import UIKit

struct WorkspaceExportView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @State private var errorMessage: String = ""
    @State private var isExporting: Bool = false
    @State private var exportedFileURL: URL? = nil
    @State private var isShareSheetPresented: Bool = false

    var body: some View {
        List {
            if self.errorMessage.isEmpty == false || store.globalErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.errorMessage.isEmpty ? store.globalErrorMessage : self.errorMessage)
                }
            }

            Section("Available Formats") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("CSV")
                        .font(.headline)

                    Text("Exports front text, back text, and tags for all active cards in the current workspace.")
                        .foregroundStyle(.secondary)

                    Button(self.isExporting ? "Exporting..." : "Export CSV") {
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
        .navigationTitle("Export")
        .sheet(
            isPresented: self.$isShareSheetPresented,
            onDismiss: {
                self.cleanupExportedFile()
            }
        ) {
            if let exportedFileURL = self.exportedFileURL {
                WorkspaceExportActivitySheet(activityItems: [exportedFileURL])
            } else {
                Text("Export file is unavailable.")
            }
        }
    }

    @MainActor
    private func exportCsv() async {
        guard let database = store.database, let workspace = store.workspace else {
            self.errorMessage = "Workspace is unavailable"
            return
        }

        self.cleanupExportedFile()
        self.errorMessage = ""
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
            self.errorMessage = Flashcards.errorMessage(error: error)
        }

        self.isExporting = false
    }

    @MainActor
    private func cleanupExportedFile() {
        guard let exportedFileURL = self.exportedFileURL else {
            return
        }

        do {
            if FileManager.default.fileExists(atPath: exportedFileURL.path) {
                try FileManager.default.removeItem(at: exportedFileURL)
            }
        } catch {
            self.errorMessage = Flashcards.errorMessage(error: error)
        }

        self.exportedFileURL = nil
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
