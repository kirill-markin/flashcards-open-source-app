import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct AIChatView: View {
    @ObservedObject private var flashcardsStore: FlashcardsStore
    @StateObject private var chatStore: AIChatStore
    @State private var isCloudSignInPresented: Bool
    @State private var isFileImporterPresented: Bool
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var isAutoScrollEnabled: Bool
    @State private var hasPendingAutoScroll: Bool
    @State private var hasInitialBottomSnap: Bool
    @State private var bottomMarkerMaxY: CGFloat
    @State private var scrollViewportHeight: CGFloat
    @State private var autoScrollTask: Task<Void, Never>?
    @FocusState private var isComposerFocused: Bool

    @MainActor
    init(flashcardsStore: FlashcardsStore) {
        self.flashcardsStore = flashcardsStore
        self.isCloudSignInPresented = false
        self.isFileImporterPresented = false
        self.selectedPhotoItem = nil
        self.isAutoScrollEnabled = true
        self.hasPendingAutoScroll = false
        self.hasInitialBottomSnap = false
        self.bottomMarkerMaxY = 0
        self.scrollViewportHeight = 0
        self.autoScrollTask = nil

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

                        Color.clear
                            .frame(height: 1)
                            .background(
                                GeometryReader { geometry in
                                    Color.clear.preference(
                                        key: AIChatBottomMarkerPreferenceKey.self,
                                        value: geometry.frame(in: .named(aiChatScrollCoordinateSpaceName)).maxY
                                    )
                                }
                            )
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
                .defaultScrollAnchor(.bottom)
                .coordinateSpace(name: aiChatScrollCoordinateSpaceName)
                .background(Color(.systemGroupedBackground))
                .contentShape(Rectangle())
                .scrollDismissesKeyboard(.interactively)
                .onTapGesture {
                    self.isComposerFocused = false
                }
                .background(
                    GeometryReader { geometry in
                        Color.clear.preference(
                            key: AIChatViewportHeightPreferenceKey.self,
                            value: geometry.size.height
                        )
                    }
                )
                .onPreferenceChange(AIChatBottomMarkerPreferenceKey.self) { nextBottomMarkerMaxY in
                    self.bottomMarkerMaxY = nextBottomMarkerMaxY
                    self.updateAutoScrollEnabled(proxy: proxy)
                }
                .onPreferenceChange(AIChatViewportHeightPreferenceKey.self) { nextScrollViewportHeight in
                    self.scrollViewportHeight = nextScrollViewportHeight
                    self.updateAutoScrollEnabled(proxy: proxy)
                }
                .onAppear {
                    self.handleInitialBottomSnap(proxy: proxy)
                    if self.chatStore.isStreaming {
                        self.startAutoScrollTask(proxy: proxy)
                    }
                }
                .onDisappear {
                    self.stopAutoScrollTask()
                }
                .onChange(of: self.chatStore.messages) { _, messages in
                    guard let lastMessage = messages.last else {
                        self.hasPendingAutoScroll = false
                        return
                    }

                    self.handleInitialBottomSnap(proxy: proxy)
                    self.hasPendingAutoScroll = true

                    if self.chatStore.isStreaming == false {
                        self.flushPendingAutoScroll(proxy: proxy, messageId: lastMessage.id)
                    }
                }
                .onChange(of: self.chatStore.isStreaming) { _, isStreaming in
                    if isStreaming {
                        self.startAutoScrollTask(proxy: proxy)
                        return
                    }

                    self.stopAutoScrollTask()
                    guard let lastMessageId = self.chatStore.messages.last?.id else {
                        return
                    }
                    self.flushPendingAutoScroll(proxy: proxy, messageId: lastMessageId)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            self.composerInset
        }
    }

    private var composerInset: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()

            VStack(alignment: .leading, spacing: 12) {
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

                ZStack(alignment: .bottomTrailing) {
                    TextField(
                        "Ask about cards, review history, or propose a change...",
                        text: self.$chatStore.inputText,
                        axis: .vertical
                    )
                    .focused(self.$isComposerFocused)
                    .lineLimit(1...aiChatComposerMaximumLineCount)
                    .padding(.leading, 12)
                    .padding(.trailing, aiChatComposerSendButtonReservedTrailingPadding)
                    .padding(.vertical, 12)

                    Button {
                        self.handlePrimaryComposerAction()
                    } label: {
                        Image(systemName: self.chatStore.isStreaming ? "stop.circle.fill" : "arrow.up.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(self.chatStore.isStreaming ? Color.red : Color.accentColor)
                    }
                    .buttonStyle(.plain)
                    .disabled(self.primaryComposerButtonDisabled)
                    .accessibilityLabel(self.chatStore.isStreaming ? "Stop response" : "Send message")
                    .padding(.trailing, aiChatComposerSendButtonInset)
                    .padding(.bottom, aiChatComposerSendButtonInset)
                }
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color(.separator), lineWidth: 1)
                )
                .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .simultaneousGesture(
                    TapGesture().onEnded {
                        self.isComposerFocused = true
                    }
                )

                HStack {
                    self.composerModelControl
                    Spacer()

                    HStack(spacing: 8) {
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
                    }
                }
            }
            .padding(.top, aiChatComposerTopPadding)
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
            .background(Color(.systemBackground))
        }
    }

    @ViewBuilder
    private var composerModelControl: some View {
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
    }

    private var selectedModelLabel: String {
        AIChatModelDef.all.first(where: { model in
            model.id == self.chatStore.selectedModelId
        })?.label ?? self.chatStore.selectedModelId
    }

    private var primaryComposerButtonDisabled: Bool {
        self.chatStore.isStreaming == false && self.chatStore.canSendMessage == false
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

    private func handlePrimaryComposerAction() {
        if self.chatStore.isStreaming {
            self.chatStore.cancelStreaming()
            return
        }

        self.chatStore.sendMessage()
        self.isComposerFocused = true
    }

    private func handleInitialBottomSnap(proxy: ScrollViewProxy) {
        guard self.hasInitialBottomSnap == false else {
            return
        }

        guard let lastMessageId = self.chatStore.messages.last?.id else {
            self.hasInitialBottomSnap = true
            return
        }

        self.scrollToBottomInstant(proxy: proxy, messageId: lastMessageId)
        self.hasInitialBottomSnap = true
        self.hasPendingAutoScroll = false
    }

    private func updateAutoScrollEnabled(proxy: ScrollViewProxy) {
        let distanceToBottom = self.bottomMarkerMaxY - self.scrollViewportHeight
        self.isAutoScrollEnabled = distanceToBottom <= aiChatAutoScrollBottomThreshold

        guard self.isAutoScrollEnabled else {
            return
        }

        guard self.chatStore.isStreaming == false else {
            return
        }

        guard let lastMessageId = self.chatStore.messages.last?.id else {
            return
        }

        self.flushPendingAutoScroll(proxy: proxy, messageId: lastMessageId)
    }

    private func flushPendingAutoScroll(proxy: ScrollViewProxy, messageId: String) {
        guard self.isAutoScrollEnabled else {
            return
        }

        guard self.hasPendingAutoScroll else {
            return
        }

        self.scrollToBottomSmooth(proxy: proxy, messageId: messageId)
        self.hasPendingAutoScroll = false
    }

    private func scrollToBottomInstant(proxy: ScrollViewProxy, messageId: String) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            proxy.scrollTo(messageId, anchor: .bottom)
        }
    }

    private func scrollToBottomSmooth(proxy: ScrollViewProxy, messageId: String) {
        withAnimation(.easeOut(duration: aiChatAutoScrollAnimationDurationSeconds)) {
            proxy.scrollTo(messageId, anchor: .bottom)
        }
    }

    private func startAutoScrollTask(proxy: ScrollViewProxy) {
        self.stopAutoScrollTask()
        self.autoScrollTask = Task { @MainActor in
            while Task.isCancelled == false {
                do {
                    try await Task.sleep(for: .seconds(aiChatAutoScrollIntervalSeconds))
                } catch {
                    break
                }

                guard self.chatStore.isStreaming else {
                    continue
                }

                guard let lastMessageId = self.chatStore.messages.last?.id else {
                    continue
                }

                self.flushPendingAutoScroll(proxy: proxy, messageId: lastMessageId)
            }
        }
    }

    private func stopAutoScrollTask() {
        self.autoScrollTask?.cancel()
        self.autoScrollTask = nil
    }
}

private let aiChatComposerMaximumLineCount: Int = 5
private let aiChatComposerTopPadding: CGFloat = 8
private let aiChatComposerSendButtonInset: CGFloat = 12
private let aiChatComposerSendButtonReservedTrailingPadding: CGFloat = 56
private let aiChatAutoScrollIntervalSeconds: Double = 2.0
private let aiChatAutoScrollBottomThreshold: CGFloat = 24
private let aiChatAutoScrollAnimationDurationSeconds: Double = 0.25
private let aiChatScrollCoordinateSpaceName: String = "ai-chat-scroll-view"

private struct AIChatBottomMarkerPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct AIChatViewportHeightPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
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
