import SwiftUI

struct WorkspaceExportView: View {
    @State private var exportShareItem: WorkspacePackageExportShareItem?
    @State private var exportCleanupFileURL: URL?
    @State private var exportCleanupErrorMessage: String = ""

    var body: some View {
        List {
            WorkspacePackageExportSection(
                exportCleanupErrorMessage: self.exportCleanupErrorMessage,
                cleanupExportedFile: self.cleanupExportedFile,
                presentExportedFile: self.presentExportedFile
            )
        }
        .listStyle(.insetGrouped)
        .navigationTitle(aiSettingsLocalized("settings.workspace.row.export", "Export"))
        .sheet(
            item: self.$exportShareItem,
            onDismiss: {
                _ = self.cleanupExportedFile()
            }
        ) { shareItem in
            WorkspaceExportActivitySheet(activityItems: [shareItem.fileURL])
        }
    }

    @MainActor
    @discardableResult
    private func cleanupExportedFile() -> Bool {
        guard let exportedFileURL = self.exportCleanupFileURL else {
            self.exportShareItem = nil
            self.exportCleanupErrorMessage = ""
            return true
        }
        self.exportShareItem = nil

        do {
            if FileManager.default.fileExists(atPath: exportedFileURL.path) {
                try FileManager.default.removeItem(at: exportedFileURL)
            }
        } catch {
            self.exportCleanupErrorMessage = Flashcards.errorMessage(error: error)
            return false
        }

        self.exportCleanupFileURL = nil
        self.exportCleanupErrorMessage = ""
        return true
    }

    @MainActor
    private func presentExportedFile(fileURL: URL) {
        self.exportCleanupErrorMessage = ""
        self.exportCleanupFileURL = fileURL
        self.exportShareItem = WorkspacePackageExportShareItem(id: UUID(), fileURL: fileURL)
    }
}

#Preview {
    NavigationStack {
        WorkspaceExportView()
            .environment(FlashcardsStore())
    }
}
