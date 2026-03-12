import AVFoundation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct AIChatView: View {
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var flashcardsStore: FlashcardsStore
    @ObservedObject private var chatStore: AIChatStore
    @State private var isCloudSignInPresented: Bool
    @State private var isCameraPresented: Bool
    @State private var isFileImporterPresented: Bool
    @State private var isPhotoPickerPresented: Bool
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var isAutoScrollEnabled: Bool
    @State private var hasPendingAutoScroll: Bool
    @State private var hasInitialBottomSnap: Bool
    @State private var bottomMarkerMaxY: CGFloat
    @State private var scrollViewportHeight: CGFloat
    @State private var autoScrollTask: Task<Void, Never>?
    @FocusState private var isComposerFocused: Bool

    @MainActor
    init(flashcardsStore: FlashcardsStore, chatStore: AIChatStore) {
        self.flashcardsStore = flashcardsStore
        self.chatStore = chatStore
        self.isCloudSignInPresented = false
        self.isCameraPresented = false
        self.isFileImporterPresented = false
        self.isPhotoPickerPresented = false
        self.selectedPhotoItem = nil
        self.isAutoScrollEnabled = true
        self.hasPendingAutoScroll = false
        self.hasInitialBottomSnap = false
        self.bottomMarkerMaxY = 0
        self.scrollViewportHeight = 0
        self.autoScrollTask = nil
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
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New") {
                    self.chatStore.clearHistory()
                }
                .disabled(self.isNewChatDisabled)
            }
        }
        .onAppear {
            self.handleAIChatPresentationRequest(request: self.flashcardsStore.aiChatPresentationRequest)
            self.chatStore.warmUpSessionIfNeeded()
        }
        .onChange(of: self.flashcardsStore.aiChatPresentationRequest) { _, request in
            self.handleAIChatPresentationRequest(request: request)
        }
        .onChange(of: self.scenePhase) { _, nextPhase in
            guard nextPhase == .active else {
                return
            }
            guard self.flashcardsStore.selectedTab == .ai else {
                return
            }

            self.chatStore.warmUpSessionIfNeeded()
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
        .photosPicker(
            isPresented: self.$isPhotoPickerPresented,
            selection: self.$selectedPhotoItem,
            matching: .images,
            preferredItemEncoding: .current,
            photoLibrary: .shared()
        )
        .sheet(isPresented: self.$isCameraPresented) {
            AIChatCameraPicker(
                onCapture: { data in
                    self.isCameraPresented = false
                    self.handleCapturedPhotoData(data)
                },
                onFailure: { error in
                    self.isCameraPresented = false
                    self.chatStore.showError(message: localizedMessage(error: error))
                },
                onCancel: {
                    self.isCameraPresented = false
                }
            )
        }
        .sheet(isPresented: self.$isCloudSignInPresented) {
            CloudSignInSheet()
                .environmentObject(self.flashcardsStore)
        }
    }

    private var isNewChatDisabled: Bool {
        self.chatStore.messages.isEmpty
            && self.chatStore.pendingAttachments.isEmpty
            && self.chatStore.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && self.chatStore.isStreaming == false
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
        GeometryReader { geometry in
            let availableWidth = max(
                geometry.size.width - (aiChatMessageListHorizontalPadding * 2),
                0
            )

            VStack(spacing: 0) {
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

                            ForEach(Array(self.chatStore.messages.enumerated()), id: \.element.id) { index, message in
                                self.messageRow(
                                    message: message,
                                    repairStatus: self.repairStatus(for: message),
                                    availableWidth: availableWidth,
                                    showsTypingIndicator: aiChatShouldShowTypingIndicator(
                                        message: message,
                                        isLastMessage: index == self.chatStore.messages.indices.last,
                                        isStreaming: self.chatStore.isStreaming
                                    )
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
                        .padding(.horizontal, aiChatMessageListHorizontalPadding)
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
                            .frame(width: aiChatComposerSendButtonVisualSize, height: aiChatComposerSendButtonVisualSize)
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

                    Menu {
                        ForEach(aiChatAttachmentMenuActions()) { action in
                            Button {
                                self.handleAttachmentMenuAction(action)
                            } label: {
                                Label(action.title, systemImage: action.systemImage)
                            }
                        }
                    } label: {
                        Image(systemName: "paperclip")
                    }
                    .buttonStyle(.bordered)
                    .disabled(self.chatStore.isStreaming)
                    .accessibilityLabel("Add attachment")
                    .accessibilityHint("Take a photo, choose a photo, or select a file")
                    .menuOrder(.fixed)
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

    private func messageRow(
        message: AIChatMessage,
        repairStatus: AIChatRepairAttemptStatus?,
        availableWidth: CGFloat,
        showsTypingIndicator: Bool
    ) -> some View {
        HStack(alignment: .bottom, spacing: 0) {
            if message.role == .assistant {
                self.messageBubble(
                    message: message,
                    repairStatus: repairStatus,
                    availableWidth: availableWidth,
                    showsTypingIndicator: showsTypingIndicator
                )
                Spacer(minLength: 0)
            } else {
                Spacer(minLength: 0)
                self.messageBubble(
                    message: message,
                    repairStatus: repairStatus,
                    availableWidth: availableWidth,
                    showsTypingIndicator: showsTypingIndicator
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func messageBubble(
        message: AIChatMessage,
        repairStatus: AIChatRepairAttemptStatus?,
        availableWidth: CGFloat,
        showsTypingIndicator: Bool
    ) -> some View {
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

            if showsTypingIndicator {
                AIChatTypingIndicator()
            }
        }
        .frame(maxWidth: aiChatBubbleMaxWidth(availableWidth: availableWidth), alignment: .leading)
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

            let mediaType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
            let fileExtension = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            let attachment = try aiChatMakeImageAttachment(
                data: data,
                fileName: "photo.\(fileExtension)",
                mediaType: mediaType
            )
            self.chatStore.appendAttachment(attachment)
        } catch {
            self.chatStore.showError(message: localizedMessage(error: error))
        }

        self.selectedPhotoItem = nil
    }

    private func handleCapturedPhotoData(_ data: Data) {
        do {
            let attachment = try aiChatMakeImageAttachment(
                data: data,
                fileName: "photo.jpg",
                mediaType: "image/jpeg"
            )
            self.chatStore.appendAttachment(attachment)
        } catch {
            self.chatStore.showError(message: localizedMessage(error: error))
        }
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

    private func handleAttachmentMenuAction(_ action: AIChatAttachmentMenuAction) {
        self.isComposerFocused = false

        switch action {
        case .takePhoto:
            Task {
                await self.presentCameraIfAvailable()
            }
        case .choosePhoto:
            self.selectedPhotoItem = nil
            self.isPhotoPickerPresented = true
        case .chooseFile:
            self.isFileImporterPresented = true
        }
    }

    @MainActor
    private func presentCameraIfAvailable() async {
        do {
            try await aiChatEnsureCameraIsAvailable()
            self.isCameraPresented = true
        } catch {
            self.chatStore.showError(message: localizedMessage(error: error))
        }
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
private let aiChatComposerSendButtonInset: CGFloat = 8
private let aiChatComposerSendButtonVisualSize: CGFloat = 28
private let aiChatComposerSendButtonReservedTrailingPadding: CGFloat = 44
private let aiChatMessageListHorizontalPadding: CGFloat = 16
private let aiChatAutoScrollIntervalSeconds: Double = 2.0
private let aiChatAutoScrollBottomThreshold: CGFloat = 24
private let aiChatAutoScrollAnimationDurationSeconds: Double = 0.25
private let aiChatScrollCoordinateSpaceName: String = "ai-chat-scroll-view"
private let aiChatBubbleWidthFraction: CGFloat = 0.88
private let aiChatBubbleWidthMaximum: CGFloat = 720
private let aiChatTypingIndicatorDotCount: Int = 3
private let aiChatTypingIndicatorAnimationStepSeconds: Double = 0.3

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

private struct AIChatTypingIndicator: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: aiChatTypingIndicatorAnimationStepSeconds)) { context in
            let activeDotCount = aiChatTypingIndicatorActiveDotCount(date: context.date)

            HStack(spacing: 5) {
                ForEach(0..<aiChatTypingIndicatorDotCount, id: \.self) { index in
                    Circle()
                        .fill(Color.secondary)
                        .frame(width: 6, height: 6)
                        .opacity(index < activeDotCount ? 1 : 0.25)
                }
            }
            .padding(.top, 2)
            .accessibilityLabel("Assistant is typing")
        }
    }
}

func aiChatBubbleMaxWidth(availableWidth: CGFloat) -> CGFloat {
    let clampedWidth = max(availableWidth, 0)
    return min(clampedWidth * aiChatBubbleWidthFraction, aiChatBubbleWidthMaximum)
}

func aiChatShouldShowTypingIndicator(
    message: AIChatMessage,
    isLastMessage: Bool,
    isStreaming: Bool
) -> Bool {
    message.role == .assistant && isLastMessage && isStreaming
}

private func aiChatTypingIndicatorActiveDotCount(date: Date) -> Int {
    let animationStep = Int(
        floor(date.timeIntervalSinceReferenceDate / aiChatTypingIndicatorAnimationStepSeconds)
    )
    return animationStep.quotientAndRemainder(dividingBy: aiChatTypingIndicatorDotCount + 1).remainder
}

enum AIChatAttachmentMenuAction: String, CaseIterable, Identifiable {
    case takePhoto
    case choosePhoto
    case chooseFile

    var id: String {
        self.rawValue
    }

    var title: String {
        switch self {
        case .takePhoto:
            return "Take Photo"
        case .choosePhoto:
            return "Choose Photo"
        case .chooseFile:
            return "Choose File"
        }
    }

    var systemImage: String {
        switch self {
        case .takePhoto:
            return "camera"
        case .choosePhoto:
            return "photo"
        case .chooseFile:
            return "doc"
        }
    }
}

func aiChatAttachmentMenuActions() -> [AIChatAttachmentMenuAction] {
    [
        .takePhoto,
        .choosePhoto,
        .chooseFile,
    ]
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

func aiChatMakeImageAttachment(data: Data, fileName: String, mediaType: String) throws -> AIChatAttachment {
    try aiChatValidateAttachmentSize(data: data)

    return AIChatAttachment(
        id: UUID().uuidString.lowercased(),
        fileName: fileName,
        mediaType: mediaType,
        base64Data: data.base64EncodedString()
    )
}

private enum AIChatCameraAvailabilityError: LocalizedError {
    case unavailable
    case accessRestricted
    case accessDenied

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "Camera is not available on this device."
        case .accessRestricted:
            return "Camera access is restricted on this device."
        case .accessDenied:
            return "Camera access is turned off for Flashcards. Enable it in Settings > Privacy & Security > Camera."
        }
    }
}

@MainActor
private func aiChatEnsureCameraIsAvailable() async throws {
    guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
        throw AIChatCameraAvailabilityError.unavailable
    }

    let authorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    switch authorizationStatus {
    case .authorized:
        return
    case .notDetermined:
        let isGranted = await aiChatRequestCameraAccess()
        if isGranted == false {
            throw AIChatCameraAvailabilityError.accessDenied
        }
    case .restricted:
        throw AIChatCameraAvailabilityError.accessRestricted
    case .denied:
        throw AIChatCameraAvailabilityError.accessDenied
    @unknown default:
        throw AIChatCameraAvailabilityError.accessDenied
    }
}

private func aiChatRequestCameraAccess() async -> Bool {
    await withCheckedContinuation { continuation in
        AVCaptureDevice.requestAccess(for: .video) { isGranted in
            continuation.resume(returning: isGranted)
        }
    }
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

/**
 Mirrors `apps/web/src/chat/chatMessageContent.tsx::formatToolLabel`.
 Keep user-facing local tool labels aligned across web and iOS chat UIs.
 */
private func aiChatToolLabel(name: String) -> String {
    switch name {
    case "sql":
        return "SQL"
    case "get_cloud_settings":
        return "Cloud settings"
    case "list_outbox":
        return "Outbox"
    case "code_execution", "code_interpreter":
        return "Code execution"
    case "web_search":
        return "Web search"
    default:
        return name.replacingOccurrences(of: "_", with: " ").capitalized
    }
}
