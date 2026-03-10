import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct AIChatView: View {
    @ObservedObject private var flashcardsStore: FlashcardsStore
    @StateObject private var chatStore: AIChatStore
    @State private var isCloudSignInPresented: Bool
    @State private var isFileImporterPresented: Bool
    @State private var selectedPhotoItem: PhotosPickerItem?
    @FocusState private var isComposerFocused: Bool

    @MainActor
    init(flashcardsStore: FlashcardsStore) {
        self.flashcardsStore = flashcardsStore
        self.isCloudSignInPresented = false
        self.isFileImporterPresented = false
        self.selectedPhotoItem = nil

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let historyStore = AIChatHistoryStore(
            userDefaults: UserDefaults.standard,
            encoder: encoder,
            decoder: decoder
        )
        let chatService = AIChatService(
            session: URLSession.shared,
            encoder: encoder,
            decoder: decoder
        )
        let workspaceRuntime: any AIToolExecuting & AIChatSnapshotLoading
        if let databaseURL = flashcardsStore.localDatabaseURL {
            workspaceRuntime = LocalAIToolExecutor(
                databaseURL: databaseURL,
                encoder: encoder,
                decoder: decoder
            )
        } else {
            workspaceRuntime = UnavailableAIToolExecutor()
        }
        _chatStore = StateObject(
            wrappedValue: AIChatStore(
                flashcardsStore: flashcardsStore,
                historyStore: historyStore,
                chatService: chatService,
                toolExecutor: workspaceRuntime,
                snapshotLoader: workspaceRuntime
            )
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            if self.chatStore.errorMessage.isEmpty == false {
                Text(self.chatStore.errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }

            if self.flashcardsStore.cloudSettings?.cloudState == .linked {
                self.chatContent
            } else {
                self.signInGate
            }
        }
        .navigationTitle("AI")
        .onAppear {
            self.handleAIChatPresentationRequest(request: self.flashcardsStore.aiChatPresentationRequest)
        }
        .onChange(of: self.flashcardsStore.aiChatPresentationRequest) { _, request in
            self.handleAIChatPresentationRequest(request: request)
        }
        .onChange(of: self.selectedPhotoItem) { _, newItem in
            guard let newItem else {
                return
            }

            Task {
                await self.handleSelectedPhotoItem(newItem)
            }
        }
        .fileImporter(
            isPresented: self.$isFileImporterPresented,
            allowedContentTypes: aiChatImporterContentTypes(),
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls):
                Task {
                    await self.handleImportedFiles(urls)
                }
            case .failure(let error):
                self.chatStore.showError(message: localizedMessage(error: error))
            }
        }
        .sheet(isPresented: self.$isCloudSignInPresented) {
            CloudSignInSheet()
                .environmentObject(self.flashcardsStore)
        }
    }

    private var signInGate: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "sparkles.rectangle.stack")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text("Sign in to use AI. It can help you explore your cards, spot weak areas, and draft changes before you save them.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 24)
            Button("Sign in for AI chat") {
                self.isCloudSignInPresented = true
            }
            .buttonStyle(.borderedProminent)
            Spacer()
        }
    }

    private var chatContent: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Local workspace AI")
                    .font(.headline)
                Spacer()
                Button("Clear") {
                    self.chatStore.clearHistory()
                }
                .disabled(self.chatStore.messages.isEmpty)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
            .onTapGesture {
                self.isComposerFocused = false
            }

            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if self.chatStore.messages.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Try asking")
                                    .font(.headline)
                                Text("Summarize weak areas from my due cards.")
                                Text("Find cards tagged with grammar and suggest cleanup.")
                                Text("Propose a new deck filter and explain the exact change.")
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .foregroundStyle(.secondary)
                        }

                        ForEach(self.chatStore.messages) { message in
                            self.messageRow(
                                message: message,
                                repairStatus: self.repairStatus(for: message)
                            )
                            .id(message.id)
                        }
                    }
                    .padding(16)
                }
                .background(Color(.systemGroupedBackground))
                .contentShape(Rectangle())
                .onTapGesture {
                    self.isComposerFocused = false
                }
                .onChange(of: self.chatStore.messages) { _, messages in
                    guard let lastMessage = messages.last else {
                        return
                    }

                    if self.chatStore.isStreaming {
                        proxy.scrollTo(lastMessage.id, anchor: .bottom)
                    } else {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 12) {
                if self.chatStore.isModelLocked {
                    Text("Model: \(self.selectedModelLabel)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    Picker(
                        "Model",
                        selection: Binding(
                            get: {
                                self.chatStore.selectedModelId
                            },
                            set: { nextModelId in
                                self.chatStore.setSelectedModel(modelId: nextModelId)
                            }
                        )
                    ) {
                        ForEach(AIChatModelDef.all) { model in
                            Text(model.label).tag(model.id)
                        }
                    }
                    .pickerStyle(.menu)
                }

                if self.chatStore.pendingAttachments.isEmpty == false {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(self.chatStore.pendingAttachments) { attachment in
                                HStack(spacing: 6) {
                                    Image(systemName: attachment.isImage ? "photo" : "doc")
                                        .foregroundStyle(.secondary)
                                    Text(attachment.fileName)
                                        .font(.caption)
                                        .lineLimit(1)
                                    Button {
                                        self.chatStore.removeAttachment(id: attachment.id)
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .foregroundStyle(.secondary)
                                    }
                                    .buttonStyle(.plain)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                                .background(Color(.secondarySystemGroupedBackground))
                                .clipShape(Capsule())
                            }
                        }
                    }
                }

                ZStack(alignment: .topLeading) {
                    TextEditor(text: self.$chatStore.inputText)
                        .focused(self.$isComposerFocused)
                        .frame(minHeight: 88, maxHeight: 140)
                        .padding(4)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color(.separator), lineWidth: 1)
                        )

                    if self.chatStore.inputText.isEmpty {
                        Text("Ask about cards, review history, or propose a change...")
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 14)
                    }
                }

                HStack {
                    PhotosPicker(
                        selection: self.$selectedPhotoItem,
                        matching: .images,
                        photoLibrary: .shared()
                    ) {
                        Label("Photo", systemImage: "photo")
                    }
                    .buttonStyle(.bordered)
                    .disabled(self.chatStore.isStreaming)

                    Button {
                        self.isFileImporterPresented = true
                    } label: {
                        Label("File", systemImage: "paperclip")
                    }
                    .buttonStyle(.bordered)
                    .disabled(self.chatStore.isStreaming)

                    if self.chatStore.isStreaming {
                        Button("Cancel") {
                            self.chatStore.cancelStreaming()
                        }
                        .buttonStyle(.bordered)
                    }

                    Spacer()

                    Button("Send") {
                        self.chatStore.sendMessage()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(self.chatStore.canSendMessage == false)
                }
            }
            .padding(16)
        }
    }

    private var selectedModelLabel: String {
        AIChatModelDef.all.first(where: { model in
            model.id == self.chatStore.selectedModelId
        })?.label ?? self.chatStore.selectedModelId
    }

    private func handleAIChatPresentationRequest(request: AIChatPresentationRequest?) {
        guard let request else {
            return
        }

        self.chatStore.applyPresentationRequest(request: request)
        self.flashcardsStore.clearAIChatPresentationRequest()
    }

    private func repairStatus(for message: AIChatMessage) -> AIChatRepairAttemptStatus? {
        guard message.role == .assistant else {
            return nil
        }

        guard self.chatStore.messages.last?.id == message.id else {
            return nil
        }

        return self.chatStore.repairStatus
    }

    private func messageRow(message: AIChatMessage, repairStatus: AIChatRepairAttemptStatus?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message.role == .user ? "You" : "Assistant")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            ForEach(Array(message.content.enumerated()), id: \.offset) { _, part in
                self.messageContent(part: part)
            }

            if let repairStatus {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text(repairStatus.displayText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(message.role == .user ? Color.accentColor.opacity(0.12) : Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(message.isError ? Color.red.opacity(0.5) : Color.clear, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func messageContent(part: AIChatContentPart) -> some View {
        switch part {
        case .text(let text):
            Text(text)
                .textSelection(.enabled)
        case .image:
            Label("Image attached", systemImage: "photo")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        case .file(let fileName, _, _):
            Label(fileName, systemImage: "doc")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        case .toolCall(let toolCall):
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    if let input = toolCall.input, input.isEmpty == false {
                        Text(input)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                    }

                    if let output = toolCall.output, output.isEmpty == false {
                        Divider()
                        Text(output)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
            } label: {
                HStack {
                    Text(aiChatToolLabel(name: toolCall.name))
                    Spacer()
                    Text(toolCall.status == .started ? "Running" : "Done")
                        .foregroundStyle(.secondary)
                }
                .font(.subheadline)
            }
        }
    }

    private func handleSelectedPhotoItem(_ item: PhotosPickerItem) async {
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                self.chatStore.showError(message: "Failed to read the selected photo.")
                self.selectedPhotoItem = nil
                return
            }

            try aiChatValidateAttachmentSize(data: data)
            let mediaType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
            let fileExtension = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            self.chatStore.appendAttachment(
                AIChatAttachment(
                    id: UUID().uuidString.lowercased(),
                    fileName: "photo.\(fileExtension)",
                    mediaType: mediaType,
                    base64Data: data.base64EncodedString()
                )
            )
        } catch {
            self.chatStore.showError(message: localizedMessage(error: error))
        }

        self.selectedPhotoItem = nil
    }

    private func handleImportedFiles(_ urls: [URL]) async {
        do {
            for url in urls {
                let attachment = try aiChatMakeAttachmentFromFile(url: url)
                self.chatStore.appendAttachment(attachment)
            }
        } catch {
            self.chatStore.showError(message: localizedMessage(error: error))
        }
    }
}

private func aiChatImporterContentTypes() -> [UTType] {
    let baseTypes = aiChatSupportedFileExtensions.compactMap { fileExtension in
        UTType(filenameExtension: fileExtension)
    }

    return baseTypes.sorted { left, right in
        left.identifier < right.identifier
    }
}

private func aiChatMakeAttachmentFromFile(url: URL) throws -> AIChatAttachment {
    let fileExtension = url.pathExtension.lowercased()
    guard aiChatSupportedFileExtensions.contains(fileExtension) else {
        throw NSError(
            domain: "AIChatAttachment",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Unsupported file type: .\(fileExtension)"]
        )
    }

    let didAccess = url.startAccessingSecurityScopedResource()
    defer {
        if didAccess {
            url.stopAccessingSecurityScopedResource()
        }
    }

    let data = try Data(contentsOf: url)
    try aiChatValidateAttachmentSize(data: data)
    let contentType = UTType(filenameExtension: fileExtension)

    return AIChatAttachment(
        id: UUID().uuidString.lowercased(),
        fileName: url.lastPathComponent,
        mediaType: contentType?.preferredMIMEType ?? "application/octet-stream",
        base64Data: data.base64EncodedString()
    )
}

private func aiChatValidateAttachmentSize(data: Data) throws {
    if data.count > aiChatMaximumAttachmentBytes {
        throw NSError(
            domain: "AIChatAttachment",
            code: 2,
            userInfo: [
                NSLocalizedDescriptionKey: "File is too large. Maximum allowed size is 20 MB.",
            ]
        )
    }
}

private func aiChatToolLabel(name: String) -> String {
    switch name {
    case "get_workspace_context":
        return "Workspace context"
    case "list_cards":
        return "List cards"
    case "get_cards":
        return "Get cards"
    case "search_cards":
        return "Search cards"
    case "list_due_cards":
        return "List due cards"
    case "list_decks":
        return "List decks"
    case "search_decks":
        return "Search decks"
    case "get_decks":
        return "Get decks"
    case "list_review_history":
        return "Review history"
    case "get_scheduler_settings":
        return "Scheduler settings"
    case "get_cloud_settings":
        return "Cloud settings"
    case "list_outbox":
        return "Outbox"
    case "summarize_deck_state":
        return "Deck summary"
    case "create_cards":
        return "Create cards"
    case "update_cards":
        return "Update cards"
    case "delete_cards":
        return "Delete cards"
    case "create_decks":
        return "Create decks"
    case "update_decks":
        return "Update decks"
    case "delete_decks":
        return "Delete decks"
    case "code_execution", "code_interpreter":
        return "Code execution"
    case "web_search":
        return "Web search"
    default:
        return name.replacingOccurrences(of: "_", with: " ").capitalized
    }
}
