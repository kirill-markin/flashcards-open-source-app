import SwiftUI

func workspaceImportNibomoFormatTitle() -> String {
    aiSettingsLocalized("settings.workspace.import.format.nibomo", "Nibomo format")
}

func workspaceImportAnkiFormatTitle() -> String {
    aiSettingsLocalized("settings.workspace.import.format.anki", "Anki format")
}

func ankiImportWorkspaceChangedMessage() -> String {
    aiSettingsLocalized(
        "settings.workspace.import.anki.workspaceChanged",
        "The workspace or account changed. Go back to Library and start the import again."
    )
}

func ankiImportWaitingMessage() -> String {
    aiSettingsLocalized("settings.workspace.import.anki.waiting", "Waiting to start Anki import…")
}

private struct AnkiImportFileError: LocalizedError {
    let fileName: String
    let underlyingError: any Error

    var errorDescription: String? {
        "\(self.fileName): \(Flashcards.errorMessage(error: self.underlyingError))"
    }
}

private func stageAnkiImportFiles(urls: [URL]) throws -> [AIChatAttachment] {
    var attachments: [AIChatAttachment] = []
    do {
        for url in urls {
            try Task.checkCancellation()
            do {
                let attachment = try aiChatMakeAttachmentFromFile(url: url)
                attachments.append(attachment)
                if case .localFile(_, _, let sizeBytes) = attachment.payload {
                    try aiChatValidateAttachmentSize(
                        byteCount: sizeBytes,
                        maximumByteCount: aiChatMaximumFileAttachmentBytes
                    )
                }
            } catch {
                throw AnkiImportFileError(fileName: url.lastPathComponent, underlyingError: error)
            }
        }
        try validateAIChatOutgoingAttachments(attachments: attachments)
        return attachments
    } catch {
        aiChatRemoveAttachmentFiles(attachments: attachments)
        throw error
    }
}

struct WorkspaceAnkiImportView: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    @State private var selectedFiles: [URL] = []
    @State private var isFileImporterPresented: Bool = false
    @State private var stagingTask: Task<Void, Never>?
    @State private var errorMessage: String?

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
                    Label(
                        aiSettingsLocalized("settings.workspace.import.anki.choose", "Choose .apkg Files"),
                        systemImage: "doc.badge.plus"
                    )
                }
                .disabled(self.stagingTask != nil)

                ForEach(self.selectedFiles, id: \.self) { url in
                    HStack {
                        Text(url.lastPathComponent)
                        Spacer()
                        Button {
                            self.selectedFiles.removeAll { $0 == url }
                            self.errorMessage = nil
                        } label: {
                            Label(
                                aiSettingsLocalized("settings.workspace.import.anki.remove", "Remove File"),
                                systemImage: "xmark.circle"
                            )
                            .labelStyle(.iconOnly)
                        }
                        .buttonStyle(.borderless)
                        .disabled(self.stagingTask != nil)
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
                .disabled(self.selectedFiles.isEmpty || self.stagingTask != nil || self.navigation.ankiImportRequest != nil)
            }
        }
        .listStyle(.insetGrouped)
        .nativeNavigationTitle(workspaceImportAnkiFormatTitle())
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
        }
    }

    private func handleFileImporterResult(_ result: Result<[URL], Error>) {
        do {
            let urls = try result.get()
            var nextFiles = self.selectedFiles
            for url in urls {
                let fileExtension = url.pathExtension.lowercased()
                guard fileExtension == "apkg" else {
                    throw AnkiImportFileError(
                        fileName: url.lastPathComponent,
                        underlyingError: aiChatUnsupportedFileTypeError(fileExtension: fileExtension)
                    )
                }
                if nextFiles.contains(url) == false {
                    nextFiles.append(url)
                }
            }
            guard nextFiles.count <= aiChatMaximumUploadsPerTurn else {
                throw AIChatAttachmentLimitError.tooManyUploads
            }
            self.selectedFiles = nextFiles
            self.errorMessage = nil
        } catch {
            if isRequestCancellationError(error: error) == false {
                self.errorMessage = Flashcards.errorMessage(error: error)
            }
        }
    }

    private func startImport() {
        guard self.stagingTask == nil, self.navigation.ankiImportRequest == nil, self.selectedFiles.isEmpty == false else {
            return
        }
        self.errorMessage = nil
        let chatStore = self.store.aiChatStore
        let accessContext = chatStore.currentAccessContext()
        guard accessContext.workspaceId != nil else {
            self.errorMessage = ankiImportWorkspaceChangedMessage()
            return
        }

        let urls = self.selectedFiles
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
                    self.errorMessage = ankiImportWorkspaceChangedMessage()
                    return
                }

                let request = AnkiImportPresentationRequest(id: UUID(), accessContext: accessContext, attachments: attachments)
                guard self.navigation.openAIAnkiImport(request: request) else {
                    aiChatRemoveAttachmentFiles(attachments: attachments)
                    self.errorMessage = ankiImportWaitingMessage()
                    return
                }
                self.selectedFiles = []
            } catch {
                if Task.isCancelled == false {
                    self.errorMessage = Flashcards.errorMessage(error: error)
                }
            }
        }
    }
}
