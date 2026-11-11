import SwiftUI

struct WorkspaceExportView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    let format: WorkspacePackageExportFormat

    @State private var exportTask: Task<Void, Never>?

    @State private var exportShareItem: WorkspacePackageExportShareItem?
    @State private var exportCleanupFileURL: URL?
    @State private var exportCleanupErrorMessage: String = ""

    var body: some View {
        List {
            WorkspacePackageExportSection(
                format: self.format,
                exportTask: self.$exportTask,
                exportCleanupErrorMessage: self.exportCleanupErrorMessage,
                cleanupExportedFile: self.cleanupExportedFile,
                presentExportedFile: self.presentExportedFile
            )
            .id(self.store.workspace?.workspaceId)
        }
        .onChange(of: self.store.workspace?.workspaceId) { _, _ in
            self.exportTask?.cancel()
            self.cleanupExportedFile()
        }
        .onDisappear {
            self.exportTask?.cancel()
        }
        .listStyle(.insetGrouped)
        .nativeNavigationTitle(self.format.localizedTitle)
        #if !targetEnvironment(macCatalyst)
        .toolbar {
            AICompanionToolbarItem()
        }
        #endif
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
            let exportDirectory = exportedFileURL.deletingLastPathComponent()
            if FileManager.default.fileExists(atPath: exportDirectory.path) {
                try FileManager.default.removeItem(at: exportDirectory)
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
        WorkspaceExportView(format: .nibomo)
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
    }
}
