import SwiftUI
import UniformTypeIdentifiers

func aiImportWorkspaceChangedMessage() -> String {
    aiSettingsLocalized(
        "settings.workspace.import.anki.workspaceChanged",
        "The workspace or account changed. Go back to Library and start the import again."
    )
}

func aiImportWaitingMessage() -> String {
    aiSettingsLocalized("settings.workspace.import.anki.waiting", "Waiting to start Anki import…")
}

struct WorkspaceAnkiImportView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    @State private var selectedFiles: [WorkspaceAnkiImportFile] = []
    @State private var isDropTargeted: Bool = false
    @State private var isFileImporterPresented: Bool = false
    @State private var stagingTask: Task<Void, Never>?
    @State private var dropTask: Task<Void, Never>?
    @State private var errorMessage: String?

    private var isBusy: Bool {
        self.stagingTask != nil || self.dropTask != nil
    }

    var body: some View {
        List {
            if let errorMessage = self.errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }

            Section {
                Button {
                    self.isFileImporterPresented = true
                } label: {
                    Label {
                        Text(aiSettingsLocalized("settings.workspace.import.anki.choose", "Choose .apkg Files"))
                    } icon: {
                        if self.dropTask != nil {
                            ProgressView()
                        } else {
                            Image(systemName: "doc.badge.plus")
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .disabled(self.isBusy)
                .accessibilityIdentifier(UITestIdentifier.workspaceImportChooseAnkiFilesButton)
                .onDrop(
                    of: aiChatAnkiPackageImporterContentTypes() + [.fileURL],
                    isTargeted: self.$isDropTargeted,
                    perform: self.handleDrop
                )
                .listRowBackground(self.isDropTargeted && !self.isBusy ? Color.accentColor.opacity(0.14) : nil)

                ForEach(self.selectedFiles) { file in
                    HStack {
                        Text(file.url.lastPathComponent)
                        Spacer()
                        Button {
                            self.selectedFiles.removeAll { $0.id == file.id }
                            file.removeStagedCopy()
                            self.errorMessage = nil
                        } label: {
                            Label(
                                aiSettingsLocalized("settings.workspace.import.anki.remove", "Remove File"),
                                systemImage: "xmark.circle"
                            )
                            .labelStyle(.iconOnly)
                        }
                        .buttonStyle(.borderless)
                        .disabled(self.isBusy)
                    }
                }
            }

            Section {
                Button(action: self.startImport) {
                    HStack {
                        if self.stagingTask != nil {
                            ProgressView()
                        }
                        Text(aiSettingsLocalized("settings.workspace.import.anki.start", "Start Import"))
                    }
                }
                .disabled(self.selectedFiles.isEmpty || self.isBusy || self.navigation.aiImportRequest != nil)
            }
        }
        .listStyle(.insetGrouped)
        .nativeNavigationTitle(WorkspaceImportFormat.anki.localizedTitle)
        #if !targetEnvironment(macCatalyst)
        .toolbar {
            AICompanionToolbarItem()
        }
        #endif
        .fileImporter(
            isPresented: self.$isFileImporterPresented,
            allowedContentTypes: aiChatAnkiPackageImporterContentTypes(),
            allowsMultipleSelection: true,
            onCompletion: self.handleFileImporterResult
        )
        .onDisappear {
            self.stagingTask?.cancel()
            self.dropTask?.cancel()
            self.clearSelectedFiles()
        }
    }

    private func handleFileImporterResult(_ result: Result<[URL], Error>) {
        guard !self.isBusy else { return }
        do {
            let files = try result.get().map { url in
                try validateAnkiImportFileExtension(fileName: url.lastPathComponent)
                return WorkspaceAnkiImportFile(url: url, stagedDirectory: nil)
            }
            var nextFiles = self.selectedFiles
            var selectedURLs = Set(nextFiles.map(\.url))
            for file in files where selectedURLs.insert(file.url).inserted {
                nextFiles.append(file)
            }
            try self.validateSelectionCount(count: nextFiles.count)
            self.selectedFiles = nextFiles
            self.errorMessage = nil
        } catch {
            if !isRequestCancellationError(error: error) {
                self.errorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        guard !self.isBusy, !providers.isEmpty else { return false }
        do {
            try self.validateSelectionCount(count: self.selectedFiles.count + providers.count)
        } catch {
            self.errorMessage = Flashcards.errorMessage(error: error)
            return false
        }

        let contentTypes = aiChatAnkiPackageImporterContentTypes()
        let drops = providers.map { provider in
            loadWorkspaceImportDrop(provider: provider, contentTypes: contentTypes, readFile: stageAnkiImportDropFile(url:fileName:))
        }
        let fileTask = Task.detached(priority: .userInitiated) {
            try await collectAnkiImportDropFiles(drops: drops)
        }
        self.errorMessage = nil
        self.dropTask = Task {
            defer { self.dropTask = nil }
            do {
                let files = try await fileTask.value
                if Task.isCancelled {
                    files.forEach { $0.removeStagedCopy() }
                } else {
                    self.selectedFiles.append(contentsOf: files)
                }
            } catch {
                if !Task.isCancelled {
                    self.errorMessage = Flashcards.errorMessage(error: error)
                }
            }
        }
        return true
    }

    private func validateSelectionCount(count: Int) throws {
        guard count <= aiChatMaximumUploadsPerTurn else {
            throw AIChatAttachmentLimitError.tooManyUploads
        }
    }

    private func clearSelectedFiles() {
        self.selectedFiles.forEach { $0.removeStagedCopy() }
        self.selectedFiles = []
    }

    private func startImport() {
        guard !self.isBusy, self.navigation.aiImportRequest == nil, !self.selectedFiles.isEmpty else {
            return
        }
        self.errorMessage = nil
        let chatStore = self.store.aiChatStore
        let accessContext = chatStore.currentAccessContext()
        guard accessContext.workspaceId != nil else {
            self.errorMessage = aiImportWorkspaceChangedMessage()
            return
        }

        let urls = self.selectedFiles.map(\.url)
        let fileTask = Task.detached(priority: .userInitiated) {
            try stageAnkiImportFiles(urls: urls)
        }
        self.stagingTask = Task {
            defer { self.stagingTask = nil }
            do {
                let attachments = try await withTaskCancellationHandler {
                    try await fileTask.value
                } onCancel: {
                    fileTask.cancel()
                }
                guard Task.isCancelled == false else {
                    aiChatRemoveAttachmentFiles(attachments: attachments)
                    return
                }
                guard accessContext == chatStore.currentAccessContext() else {
                    aiChatRemoveAttachmentFiles(attachments: attachments)
                    self.errorMessage = aiImportWorkspaceChangedMessage()
                    return
                }

                let request = AIImportPresentationRequest(
                    id: UUID(),
                    accessContext: accessContext,
                    attachments: attachments,
                    requestText: aiSettingsLocalized(
                        "settings.workspace.import.anki.request",
                        "Import all attached Anki decks into this workspace."
                    )
                )
                guard self.navigation.openAIImport(request: request) else {
                    aiChatRemoveAttachmentFiles(attachments: attachments)
                    self.errorMessage = aiImportWaitingMessage()
                    return
                }
                self.clearSelectedFiles()
            } catch {
                if Task.isCancelled == false {
                    self.errorMessage = Flashcards.errorMessage(error: error)
                }
            }
        }
    }
}
