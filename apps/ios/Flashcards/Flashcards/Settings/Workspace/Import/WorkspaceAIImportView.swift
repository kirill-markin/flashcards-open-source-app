import SwiftUI
import UniformTypeIdentifiers

struct WorkspaceAIImportView: View {
    let source: AIImportSource

    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    @State private var selectedFiles: [WorkspaceAIImportFile] = []
    @State private var pastedText: String = ""
    @State private var isDropTargeted: Bool = false
    @State private var isFileImporterPresented: Bool = false
    @State private var stagingTask: Task<Void, Never>?
    @State private var dropTask: Task<Void, Never>?
    @State private var errorMessage: String?

    private var isBusy: Bool {
        self.stagingTask != nil || self.dropTask != nil
    }

    private var hasInput: Bool {
        switch self.source.input {
        case .files:
            return self.selectedFiles.isEmpty == false
        case .pastedText:
            return self.pastedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        }
    }

    private var importerContentTypes: [UTType] {
        guard case .files(let extensions) = self.source.input else {
            return []
        }
        return extensions.flatMap(aiChatFileImporterContentTypes(fileExtension:))
    }

    var body: some View {
        List {
            if let errorMessage = self.errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }

            switch self.source.input {
            case .files:
                self.filesSection
            case .pastedText:
                self.pastedTextSection
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
                .disabled(self.hasInput == false || self.isBusy || self.navigation.aiImportRequest != nil)
            }
        }
        .listStyle(.insetGrouped)
        .nativeNavigationTitle(self.source.localizedTitle)
        #if !targetEnvironment(macCatalyst)
        .toolbar {
            AICompanionToolbarItem()
        }
        #endif
        .fileImporter(
            isPresented: self.$isFileImporterPresented,
            allowedContentTypes: self.importerContentTypes,
            allowsMultipleSelection: true,
            onCompletion: self.handleFileImporterResult
        )
        .onDisappear {
            self.stagingTask?.cancel()
            self.dropTask?.cancel()
            self.clearSelectedFiles()
        }
    }

    private var filesSection: some View {
        Section {
            Button {
                self.isFileImporterPresented = true
            } label: {
                Label {
                    Text(aiSettingsLocalized("settings.workspace.import.aiImport.choose", "Choose files"))
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
            .accessibilityIdentifier(UITestIdentifier.workspaceAIImportChooseFilesButton)
            .onDrop(
                of: self.importerContentTypes + [.fileURL],
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
        } footer: {
            Text(self.source.localizedDescription)
        }
    }

    private var pastedTextSection: some View {
        let label = aiSettingsLocalized("settings.workspace.import.aiImport.textLabel", "Exported text")
        return Section {
            TextEditor(text: self.$pastedText)
                .frame(minHeight: 160)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(self.isBusy)
                .accessibilityLabel(label)
                .accessibilityIdentifier(UITestIdentifier.workspaceAIImportTextField)
                .onChange(of: self.pastedText) {
                    self.errorMessage = nil
                }
        } header: {
            Text(label)
        } footer: {
            Text(self.source.localizedDescription)
        }
    }

    private func handleFileImporterResult(_ result: Result<[URL], Error>) {
        guard !self.isBusy else { return }
        do {
            let files = try result.get().map { url in
                try validateAIImportFileExtension(fileName: url.lastPathComponent, source: self.source)
                return WorkspaceAIImportFile(url: url, stagedDirectory: nil)
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

        let source = self.source
        let contentTypes = self.importerContentTypes
        let drops = providers.map { provider in
            loadWorkspaceImportDrop(provider: provider, contentTypes: contentTypes) { url, fileName in
                try stageAIImportDropFile(url: url, fileName: fileName, source: source)
            }
        }
        let fileTask = Task.detached(priority: .userInitiated) {
            try await collectAIImportDropFiles(drops: drops)
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

    private func clearInput() {
        self.clearSelectedFiles()
        self.pastedText = ""
    }

    private func startImport() {
        guard !self.isBusy, self.navigation.aiImportRequest == nil, self.hasInput else {
            return
        }
        self.errorMessage = nil
        let chatStore = self.store.aiChatStore
        let accessContext = chatStore.currentAccessContext()
        guard accessContext.workspaceId != nil else {
            self.errorMessage = aiImportWorkspaceChangedMessage()
            return
        }

        let source = self.source
        let fileTask: Task<[AIChatAttachment], any Error>
        switch source.input {
        case .files:
            let urls = self.selectedFiles.map(\.url)
            fileTask = Task.detached(priority: .userInitiated) {
                try stageAIImportFiles(urls: urls, source: source)
            }
        case .pastedText(let fileName):
            let text = self.pastedText
            fileTask = Task.detached(priority: .userInitiated) {
                let attachment = try stageAIImportPastedText(text: text, fileName: fileName)
                return [attachment]
            }
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
                    requestText: source.localizedRequestText
                )
                guard self.navigation.openAIImport(request: request) else {
                    aiChatRemoveAttachmentFiles(attachments: attachments)
                    self.errorMessage = aiImportWaitingMessage()
                    return
                }
                self.clearInput()
            } catch {
                if Task.isCancelled == false {
                    self.errorMessage = Flashcards.errorMessage(error: error)
                }
            }
        }
    }
}
