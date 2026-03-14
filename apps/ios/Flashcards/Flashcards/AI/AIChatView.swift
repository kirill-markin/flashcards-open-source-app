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
    @State private var isNearBottom: Bool
    @State private var isUserScrolling: Bool
    @State private var scrollPosition: ScrollPosition
    @State private var autoScrollTask: Task<Void, Never>?
    @State private var shouldRestoreComposerFocusAfterDictation: Bool
    @State private var composerSelection: TextSelection?
    @State private var composerDictationInsertionSelection: AIChatDictationInsertionSelection?
    @State private var hasAcceptedExternalAIConsent: Bool
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
        self.isNearBottom = true
        self.isUserScrolling = false
        self.scrollPosition = ScrollPosition(idType: String.self)
        self.autoScrollTask = nil
        self.shouldRestoreComposerFocusAfterDictation = false
        self.composerSelection = nil
        self.composerDictationInsertionSelection = nil
        self.hasAcceptedExternalAIConsent = hasAIChatExternalProviderConsent(
            userDefaults: flashcardsStore.userDefaults
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            switch self.accessState {
            case .signInRequired:
                self.signInGate
            case .consentRequired:
                self.consentGate
            case .ready:
                self.chatContent
            }
        }
        .navigationTitle("AI")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaBar(edge: .bottom, spacing: 0) {
            if self.accessState == .ready {
                self.composerAccessory
            }
        }
        .toolbar {
            if self.accessState == .ready {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New") {
                        self.chatStore.clearHistory()
                    }
                    .disabled(self.isNewChatDisabled)
                }
            }
        }
        .onAppear {
            self.refreshExternalAIConsentState()
            guard self.hasAcceptedExternalAIConsent else {
                return
            }

            self.handleAIChatPresentationRequest(request: self.flashcardsStore.aiChatPresentationRequest)
            self.chatStore.warmUpSessionIfNeeded()
        }
        .onChange(of: self.flashcardsStore.aiChatPresentationRequest) { _, request in
            guard self.hasAcceptedExternalAIConsent else {
                return
            }

            self.handleAIChatPresentationRequest(request: request)
        }
        .onChange(of: self.scenePhase) { _, nextPhase in
            guard nextPhase == .active else {
                self.shouldRestoreComposerFocusAfterDictation = false
                self.chatStore.cancelDictation()
                return
            }
            self.refreshExternalAIConsentState()
            guard self.hasAcceptedExternalAIConsent else {
                return
            }
            guard self.flashcardsStore.selectedTab == .ai else {
                return
            }

            self.chatStore.warmUpSessionIfNeeded()
        }
        .onChange(of: self.flashcardsStore.selectedTab) { _, nextTab in
            guard nextTab != .ai else {
                return
            }

            self.shouldRestoreComposerFocusAfterDictation = false
            self.chatStore.cancelDictation()
        }
        .onChange(of: self.chatStore.dictationState) { _, nextState in
            self.handleDictationStateChange(nextState)
        }
        .onChange(of: self.chatStore.completedDictationTranscript) { _, nextTranscript in
            guard let nextTranscript else {
                return
            }

            self.handleCompletedDictationTranscript(nextTranscript)
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
                self.handleFileImportFailure(error)
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
                    self.chatStore.showGeneralError(message: localizedMessage(error: error))
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
        .alert(
            self.chatStore.activeAlert?.title ?? "",
            isPresented: Binding(
                get: {
                    self.chatStore.activeAlert != nil
                },
                set: { isPresented in
                    if isPresented == false {
                        self.chatStore.dismissAlert()
                    }
                }
            )
        ) {
            if self.chatStore.activeAlert?.showsSettingsAction == true {
                Button("Cancel", role: .cancel) {
                    self.chatStore.dismissAlert()
                }
                Button("Open Settings") {
                    self.chatStore.dismissAlert()
                    openApplicationSettings()
                }
            } else {
                Button("OK", role: .cancel) {
                    self.chatStore.dismissAlert()
                }
            }
        } message: {
            Text(self.chatStore.activeAlert?.message ?? "")
        }
    }

    private var isNewChatDisabled: Bool {
        self.chatStore.messages.isEmpty
            && self.chatStore.pendingAttachments.isEmpty
            && self.chatStore.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && self.chatStore.isStreaming == false
            && self.chatStore.dictationState == .idle
    }

    private var accessState: AIChatAccessState {
        aiChatAccessState(
            cloudState: self.flashcardsStore.cloudSettings?.cloudState,
            hasExternalProviderConsent: self.hasAcceptedExternalAIConsent
        )
    }

    private var signInGate: some View {
        VStack(spacing: 16) {
            Spacer()

            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 24,
                alignment: .center
            ) {
                VStack(spacing: 16) {
                    Image(systemName: "sparkles.rectangle.stack")
                        .font(.system(size: 44))
                        .foregroundStyle(.secondary)
                    Text("Sign in to use AI. It can help you explore your cards, spot weak areas, and draft changes before you save them.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Button("Sign in for AI chat") {
                        self.isCloudSignInPresented = true
                    }
                    .buttonStyle(.glassProminent)
                }
            }

            Spacer()
        }
    }

    private var consentGate: some View {
        ScrollView {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 24
            ) {
                VStack(alignment: .leading, spacing: 20) {
                    Spacer(minLength: 0)
                    Image(systemName: "lock.shield")
                        .font(.system(size: 42))
                        .foregroundStyle(.secondary)

                    Text("Before you use AI")
                        .font(.title3.weight(.semibold))

                    Text("Hosted AI is optional. Before you use it on this device, please confirm that you understand which request data can be sent to third-party AI providers configured on the current server.")
                        .foregroundStyle(.secondary)

                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(aiChatExternalProviderDisclosureItems, id: \.self) { item in
                            Label(item, systemImage: "checkmark.circle")
                        }
                        Label("The exact AI provider depends on the current hosted server configuration.", systemImage: "server.rack")
                    }
                    .font(.subheadline)

                    Text(aiChatAccuracyWarningText)
                        .foregroundStyle(.secondary)

                    Text("Cards, decks, and review continue to work without AI.")
                        .foregroundStyle(.secondary)

                    VStack(alignment: .leading, spacing: 12) {
                        if let privacyUrl = URL(string: flashcardsPrivacyPolicyUrl) {
                            Link("Privacy Policy", destination: privacyUrl)
                        }
                        if let termsUrl = URL(string: flashcardsTermsOfServiceUrl) {
                            Link("Terms of Service", destination: termsUrl)
                        }
                        if let supportUrl = URL(string: flashcardsSupportUrl) {
                            Link("Support", destination: supportUrl)
                        }
                    }
                    .font(.subheadline.weight(.medium))

                    Button("I understand and continue") {
                        self.acceptExternalAIConsent()
                    }
                    .buttonStyle(.glassProminent)

                    Spacer(minLength: 0)
                }
                .padding(.vertical, 24)
            }
        }
    }

    private var chatContent: some View {
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
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                }

                ForEach(Array(self.chatStore.messages.enumerated()), id: \.element.id) { index, message in
                    self.messageRow(
                        message: message,
                        repairStatus: self.repairStatus(for: message),
                        showsTypingIndicator: aiChatShouldShowTypingIndicator(
                            message: message,
                            isLastMessage: index == self.chatStore.messages.indices.last,
                            isStreaming: self.chatStore.isStreaming
                        )
                    )
                    .id(message.id)
                }
            }
            .scrollTargetLayout()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 12)
        }
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.bottom, for: .alignment)
        .scrollPosition(self.$scrollPosition, anchor: .bottom)
        .contentMargins(.horizontal, aiChatMessageListHorizontalPadding, for: .scrollContent)
        .contentMargins(.horizontal, 0, for: .scrollIndicators)
        .contentShape(Rectangle())
        .scrollDismissesKeyboard(.interactively)
        .onTapGesture {
            self.isComposerFocused = false
        }
        .onScrollPhaseChange { _, nextPhase, context in
            let nextScrollState = aiChatScrollState(
                scrollPhase: nextPhase,
                scrollGeometry: context.geometry,
                bottomThreshold: aiChatAutoScrollBottomThreshold
            )
            self.isUserScrolling = nextScrollState.isUserScrolling
            self.isNearBottom = nextScrollState.isNearBottom
            if nextPhase == .idle && nextScrollState.isNearBottom && self.chatStore.isStreaming {
                self.scrollToBottomIfNeeded(isAnimated: false)
            }
        }
        .onAppear {
            if self.chatStore.isStreaming {
                self.startAutoScrollTask()
            }
        }
        .onDisappear {
            self.stopAutoScrollTask()
        }
        .onChange(of: self.chatStore.messages) { _, messages in
            guard messages.isEmpty == false else {
                self.isNearBottom = true
                self.scrollToBottom(isAnimated: false)
                return
            }

            self.scrollToBottomIfNeeded(isAnimated: self.chatStore.isStreaming == false)
        }
        .onChange(of: self.chatStore.isStreaming) { _, isStreaming in
            if isStreaming {
                self.startAutoScrollTask()
                return
            }

            self.stopAutoScrollTask()
            self.scrollToBottomIfNeeded(isAnimated: true)
        }
    }

    private var composerAccessory: some View {
        ReadableContentLayout(
            maxWidth: flashcardsReadableContentMaxWidth,
            horizontalPadding: 16
        ) {
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
                                .background(.thinMaterial, in: Capsule())
                            }
                        }
                    }
                }

                ZStack(alignment: .bottomTrailing) {
                    TextField(
                        "Ask about cards, review history, or propose a change...",
                        text: self.$chatStore.inputText,
                        selection: self.$composerSelection,
                        axis: .vertical
                    )
                    .focused(self.$isComposerFocused)
                    .lineLimit(1...aiChatComposerMaximumLineCount)
                    .padding(.leading, 12)
                    .padding(.top, self.chatStore.dictationState == .idle ? 12 : aiChatComposerDictationTextFieldTopPadding)
                    .padding(.trailing, aiChatComposerSendButtonReservedTrailingPadding)
                    .padding(.bottom, 12)

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
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(alignment: .topLeading) {
                    if self.chatStore.dictationState != .idle {
                        AIChatDictationStatusLane(statusText: self.dictationStatusText)
                            .padding(.top, 12)
                            .padding(.leading, 12)
                            .padding(.trailing, aiChatComposerSendButtonReservedTrailingPadding)
                    }
                }
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
                        Menu {
                            ForEach(aiChatAttachmentMenuActions()) { action in
                                Button {
                                    self.handleAttachmentMenuAction(action)
                                } label: {
                                    Label(action.title, systemImage: action.systemImage)
                                }
                            }
                        } label: {
                            aiChatComposerAccessoryIcon(systemName: "paperclip")
                        }
                        .buttonStyle(.glass)
                        .disabled(self.chatStore.dictationState != .idle)
                        .accessibilityLabel("Add attachment")
                        .accessibilityHint("Take a photo, choose a photo, or select a file")
                        .menuOrder(.fixed)

                        Button {
                            self.handleDictationButtonTap()
                        } label: {
                            aiChatComposerAccessoryIcon(
                                systemName: self.chatStore.dictationState == .recording ? "stop.fill" : "mic"
                            )
                        }
                        .buttonStyle(.glass)
                        .tint(self.chatStore.dictationState == .recording ? .red : .accentColor)
                        .disabled(self.chatStore.dictationState == .requestingPermission || self.chatStore.dictationState == .transcribing)
                        .accessibilityLabel(self.chatStore.dictationState == .recording ? "Stop dictation" : "Start dictation")
                    }
                }
            }
            .padding(.top, aiChatComposerTopPadding)
            .padding(.bottom, 16)
        }
    }

    private var dictationStatusText: String {
        switch self.chatStore.dictationState {
        case .idle:
            return ""
        case .requestingPermission:
            return "Waiting for microphone access..."
        case .recording:
            return "Listening..."
        case .transcribing:
            return "Transcribing..."
        }
    }

    @ViewBuilder
    private var composerModelControl: some View {
        if self.chatStore.isModelLocked || self.chatStore.dictationState != .idle {
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

    private func acceptExternalAIConsent() {
        grantAIChatExternalProviderConsent(userDefaults: self.flashcardsStore.userDefaults)
        self.hasAcceptedExternalAIConsent = true
        self.handleAIChatPresentationRequest(request: self.flashcardsStore.aiChatPresentationRequest)
        self.chatStore.warmUpSessionIfNeeded()
    }

    private func refreshExternalAIConsentState() {
        self.hasAcceptedExternalAIConsent = hasAIChatExternalProviderConsent(
            userDefaults: self.flashcardsStore.userDefaults
        )
    }

    private func ensureExternalAIConsent() -> Bool {
        self.refreshExternalAIConsentState()
        guard self.hasAcceptedExternalAIConsent else {
            self.chatStore.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return false
        }

        return true
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

    private func handleDictationButtonTap() {
        if self.chatStore.dictationState == .idle {
            guard self.ensureExternalAIConsent() else {
                return
            }
            self.shouldRestoreComposerFocusAfterDictation = self.isComposerFocused
            self.composerDictationInsertionSelection = aiChatDictationInsertionSelection(
                text: self.chatStore.inputText,
                selection: self.composerSelection
            )
            if self.isComposerFocused == false {
                self.composerSelection = nil
                self.composerDictationInsertionSelection = nil
            }
        }

        self.chatStore.toggleDictation()
        self.restoreComposerFocusIfNeeded()
    }

    private func handleDictationStateChange(_ nextState: AIChatDictationState) {
        guard self.shouldRestoreComposerFocusAfterDictation else {
            return
        }

        self.restoreComposerFocusIfNeeded()

        if nextState == .idle {
            self.shouldRestoreComposerFocusAfterDictation = false
        }
    }

    private func restoreComposerFocusIfNeeded() {
        guard self.shouldRestoreComposerFocusAfterDictation else {
            return
        }

        Task { @MainActor in
            self.isComposerFocused = true
        }
    }

    private func handleCompletedDictationTranscript(_ completedTranscript: AIChatCompletedDictationTranscript) {
        let insertionResult = insertAIChatDictationTranscript(
            draft: self.chatStore.inputText,
            transcript: completedTranscript.transcript,
            selection: self.composerDictationInsertionSelection
        )
        self.chatStore.inputText = insertionResult.text
        self.composerSelection = aiChatTextSelection(
            text: insertionResult.text,
            selection: insertionResult.selection
        )
        self.composerDictationInsertionSelection = insertionResult.selection
        self.chatStore.consumeCompletedDictationTranscript(id: completedTranscript.id)
        self.restoreComposerFocusIfNeeded()
    }

    private func messageRow(
        message: AIChatMessage,
        repairStatus: AIChatRepairAttemptStatus?,
        showsTypingIndicator: Bool
    ) -> some View {
        HStack(alignment: .bottom, spacing: 0) {
            if message.role == .assistant {
                self.messageBubble(
                    message: message,
                    repairStatus: repairStatus,
                    showsTypingIndicator: showsTypingIndicator
                )
                Spacer(minLength: 0)
            } else {
                Spacer(minLength: 0)
                self.messageBubble(
                    message: message,
                    repairStatus: repairStatus,
                    showsTypingIndicator: showsTypingIndicator
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func messageBubble(
        message: AIChatMessage,
        repairStatus: AIChatRepairAttemptStatus?,
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
        .frame(maxWidth: aiChatBubbleMaximumWidth, alignment: .leading)
        .padding(12)
        .background(
            message.role == .user
                ? AnyShapeStyle(Color.accentColor.opacity(0.12))
                : AnyShapeStyle(.thinMaterial),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
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
            let summaryText = aiChatToolSummaryText(name: toolCall.name, input: toolCall.input)
            let sections = aiChatToolSections(input: toolCall.input, output: toolCall.output)
            VStack(alignment: .leading, spacing: 0) {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(alignment: .firstTextBaseline, spacing: 12) {
                                    Text(section.title)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.secondary)
                                    Spacer(minLength: 0)
                                    Button(section.copyButtonTitle) {
                                        UIPasteboard.general.string = section.text
                                    }
                                    .buttonStyle(.plain)
                                    .font(.caption.weight(.semibold))
                                    .accessibilityLabel(section.copyAccessibilityLabel)
                                }

                                Text(section.text)
                                    .font(.caption.monospaced())
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .textSelection(.enabled)
                            }

                            if index < sections.count - 1 {
                                Divider()
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4)
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(summaryText)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(aiChatToolStatusLabel(status: toolCall.status))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    .font(.subheadline)
                }
                .tint(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(
                        aiChatToolBorderColor(status: toolCall.status),
                        style: aiChatToolBorderStrokeStyle(status: toolCall.status)
                    )
            )
        }
    }

    private func handleSelectedPhotoItem(_ item: PhotosPickerItem) async {
        do {
            guard self.ensureExternalAIConsent() else {
                self.selectedPhotoItem = nil
                return
            }
            guard let data = try await item.loadTransferable(type: Data.self) else {
                self.chatStore.showGeneralError(message: "Failed to read the selected photo.")
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
            self.chatStore.showGeneralError(message: localizedMessage(error: error))
        }

        self.selectedPhotoItem = nil
    }

    private func handleCapturedPhotoData(_ data: Data) {
        do {
            guard self.ensureExternalAIConsent() else {
                return
            }
            let attachment = try aiChatMakeImageAttachment(
                data: data,
                fileName: "photo.jpg",
                mediaType: "image/jpeg"
            )
            self.chatStore.appendAttachment(attachment)
        } catch {
            self.chatStore.showGeneralError(message: localizedMessage(error: error))
        }
    }

    private func handleImportedFiles(_ urls: [URL]) async {
        do {
            guard self.ensureExternalAIConsent() else {
                return
            }
            for url in urls {
                let attachment = try aiChatMakeAttachmentFromFile(url: url)
                self.chatStore.appendAttachment(attachment)
            }
        } catch {
            self.handleFileImportFailure(error)
        }
    }

    private func handlePrimaryComposerAction() {
        if self.chatStore.isStreaming {
            self.chatStore.cancelStreaming()
            return
        }

        guard self.ensureExternalAIConsent() else {
            return
        }
        self.chatStore.sendMessage()
        self.isComposerFocused = true
    }

    private func handleAttachmentMenuAction(_ action: AIChatAttachmentMenuAction) {
        guard self.ensureExternalAIConsent() else {
            return
        }
        self.isComposerFocused = false

        switch action {
        case .takePhoto:
            Task {
                await self.presentCameraIfAvailable()
            }
        case .choosePhoto:
            self.selectedPhotoItem = nil
            Task {
                await self.presentPhotoPickerIfAvailable()
            }
        case .chooseFile:
            self.isFileImporterPresented = true
        }
    }

    @MainActor
    private func presentCameraIfAvailable() async {
        let initialStatus = accessPermissionStatus(kind: .camera)
        let requestedStatus = initialStatus == .askEveryTime
            ? await requestAccessPermission(kind: .camera)
            : nil
        let presentationResult = aiChatCameraPresentationResult(
            initialStatus: initialStatus,
            requestedStatus: requestedStatus
        )
        switch presentationResult {
        case .present:
            self.isCameraPresented = true
        case .stopSilently:
            return
        case .showAlert(let alert):
            self.chatStore.showAlert(alert)
        }
    }

    @MainActor
    private func presentPhotoPickerIfAvailable() async {
        let initialStatus = accessPermissionStatus(kind: .photos)
        let requestedStatus = initialStatus == .askEveryTime
            ? await requestAccessPermission(kind: .photos)
            : nil
        let presentationResult = aiChatPhotoPresentationResult(
            initialStatus: initialStatus,
            requestedStatus: requestedStatus
        )
        switch presentationResult {
        case .present:
            self.isPhotoPickerPresented = true
        case .stopSilently:
            return
        case .showAlert(let alert):
            self.chatStore.showAlert(alert)
        }
    }

    private func handleFileImportFailure(_ error: Error) {
        self.chatStore.showAlert(aiChatFileImportAlert(error: error))
    }

    private func scrollToBottomIfNeeded(isAnimated: Bool) {
        guard self.isNearBottom else {
            return
        }

        guard self.isUserScrolling == false else {
            return
        }

        guard self.chatStore.messages.isEmpty == false else {
            self.scrollToBottom(isAnimated: isAnimated)
            return
        }

        self.scrollToBottom(isAnimated: isAnimated)
    }

    private func scrollToBottom(isAnimated: Bool) {
        if isAnimated {
            withAnimation(.easeOut(duration: aiChatAutoScrollAnimationDurationSeconds)) {
                self.scrollPosition.scrollTo(edge: .bottom)
            }
            return
        }

        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            self.scrollPosition.scrollTo(edge: .bottom)
        }
    }

    private func startAutoScrollTask() {
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

                self.scrollToBottomIfNeeded(isAnimated: true)
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
private let aiChatComposerStatusLaneHeight: CGFloat = 24
private let aiChatComposerStatusLaneSpacing: CGFloat = 8
private let aiChatComposerDictationTextFieldTopPadding: CGFloat = 12 + aiChatComposerStatusLaneHeight + aiChatComposerStatusLaneSpacing
private let aiChatMessageListHorizontalPadding: CGFloat = 16
private let aiChatAutoScrollIntervalSeconds: Double = 2.0
private let aiChatAutoScrollBottomThreshold: CGFloat = 24
private let aiChatAutoScrollAnimationDurationSeconds: Double = 0.25
private let aiChatBubbleMaximumWidth: CGFloat = 720
private let aiChatTypingIndicatorDotCount: Int = 3
private let aiChatTypingIndicatorAnimationStepSeconds: Double = 0.3

struct AIChatToolSection: Hashable, Sendable, Identifiable {
    let id: String
    let title: String
    let text: String
    let copyButtonTitle: String
    let copyAccessibilityLabel: String
}

private struct AIChatScrollState: Equatable {
    let isNearBottom: Bool
    let isUserScrolling: Bool
}

private func aiChatScrollState(
    scrollPhase: ScrollPhase,
    scrollGeometry: ScrollGeometry,
    bottomThreshold: CGFloat
) -> AIChatScrollState {
    let distanceToBottom = max(scrollGeometry.contentSize.height - scrollGeometry.visibleRect.maxY, 0)
    return AIChatScrollState(
        isNearBottom: distanceToBottom <= bottomThreshold,
        isUserScrolling: scrollPhase.isScrolling
    )
}

private struct AIChatDictationStatusLane: View {
    let statusText: String

    var body: some View {
        TimelineView(.animation(minimumInterval: aiChatTypingIndicatorAnimationStepSeconds)) { context in
            let activeDotCount = aiChatTypingIndicatorActiveDotCount(date: context.date)

            HStack(spacing: 10) {
                HStack(alignment: .bottom, spacing: 6) {
                    ForEach(0..<5, id: \.self) { index in
                        Capsule()
                            .fill(Color.accentColor.opacity(index < activeDotCount + 1 ? 0.95 : 0.35))
                            .frame(width: 6, height: index < activeDotCount + 1 ? 18 : 10)
                    }
                }
                Text(self.statusText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .frame(
                maxWidth: .infinity,
                minHeight: aiChatComposerStatusLaneHeight,
                alignment: .leading
            )
        }
    }
}

private func aiChatComposerAccessoryIcon(systemName: String) -> some View {
    Image(systemName: systemName)
        .font(.system(size: 15, weight: .medium))
        .frame(width: 16, height: 16)
}

func aiChatDictationInsertionSelection(
    text: String,
    selection: TextSelection?
) -> AIChatDictationInsertionSelection? {
    guard let selection else {
        return nil
    }

    switch selection.indices {
    case .selection(let range):
        guard
            let startUtf16Offset = aiChatUtf16Offset(text: text, index: range.lowerBound),
            let endUtf16Offset = aiChatUtf16Offset(text: text, index: range.upperBound)
        else {
            return nil
        }

        return AIChatDictationInsertionSelection(
            startUtf16Offset: startUtf16Offset,
            endUtf16Offset: endUtf16Offset
        )
    case .multiSelection:
        return nil
    @unknown default:
        return nil
    }
}

private func aiChatUtf16Offset(text: String, index: String.Index) -> Int? {
    guard let utf16Index = index.samePosition(in: text.utf16) else {
        return nil
    }

    return text.utf16.distance(from: text.utf16.startIndex, to: utf16Index)
}

private func aiChatTextSelection(
    text: String,
    selection: AIChatDictationInsertionSelection
) -> TextSelection {
    let insertionIndex = String.Index(utf16Offset: selection.endUtf16Offset, in: text)
    return TextSelection(insertionPoint: insertionIndex)
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

enum AIChatAttachmentPresentationResult: Equatable {
    case present
    case stopSilently
    case showAlert(AIChatAlert)
}

func aiChatCameraPresentationResult(
    initialStatus: AccessPermissionStatus,
    requestedStatus: AccessPermissionStatus?
) -> AIChatAttachmentPresentationResult {
    switch initialStatus {
    case .allowed:
        return .present
    case .askEveryTime:
        guard let requestedStatus else {
            return .stopSilently
        }

        switch requestedStatus {
        case .allowed:
            return .present
        case .blocked, .askEveryTime:
            return .stopSilently
        case .limited, .unavailable:
            return .showAlert(.generalError(message: "Camera is not available on this device."))
        }
    case .blocked, .limited:
        return .showAlert(.attachmentSettings(source: .camera))
    case .unavailable:
        return .showAlert(.generalError(message: "Camera is not available on this device."))
    }
}

func aiChatPhotoPresentationResult(
    initialStatus: AccessPermissionStatus,
    requestedStatus: AccessPermissionStatus?
) -> AIChatAttachmentPresentationResult {
    switch initialStatus {
    case .allowed, .limited:
        return .present
    case .askEveryTime:
        guard let requestedStatus else {
            return .stopSilently
        }

        switch requestedStatus {
        case .allowed, .limited:
            return .present
        case .blocked, .askEveryTime:
            return .stopSilently
        case .unavailable:
            return .showAlert(.generalError(message: "Photo access is not available on this device."))
        }
    case .blocked:
        return .showAlert(.attachmentSettings(source: .photos))
    case .unavailable:
        return .showAlert(.generalError(message: "Photo access is not available on this device."))
    }
}

func aiChatFileImportAlert(error: Error) -> AIChatAlert {
    if aiChatIsFilePermissionError(error: error) {
        return .attachmentSettings(source: .files)
    }

    return .generalError(message: localizedMessage(error: error))
}

func aiChatIsFilePermissionError(error: Error) -> Bool {
    let nsError = error as NSError
    if nsError.domain == NSCocoaErrorDomain {
        let noPermissionCodes = [
            CocoaError.Code.fileReadNoPermission.rawValue,
            CocoaError.Code.fileWriteNoPermission.rawValue,
        ]
        return noPermissionCodes.contains(nsError.code)
    }

    if nsError.domain == NSPOSIXErrorDomain {
        let noPermissionCodes = [
            Int(EACCES),
            Int(EPERM),
        ]
        return noPermissionCodes.contains(nsError.code)
    }

    return false
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
 Mirrors:
 - `apps/web/src/chat/chatMessageContent.tsx::formatToolLabel`
 - `apps/web/src/chat/chatMessageContent.tsx::extractToolCallPreview`

 Keep user-facing local tool labels aligned across web and iOS chat UIs.
 */
func aiChatToolLabel(name: String) -> String {
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

func aiChatToolPreview(name: String, input: String?) -> String? {
    guard let input, input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
        return nil
    }

    if name != "sql" {
        return input
    }

    guard let data = input.data(using: .utf8),
          let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let sql = payload["sql"] as? String else {
        return input
    }

    let trimmedSql = sql.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedSql.isEmpty ? input : trimmedSql
}

func aiChatToolSummaryText(name: String, input: String?) -> String {
    let toolLabel = aiChatToolLabel(name: name)
    guard let toolPreview = aiChatToolPreview(name: name, input: input) else {
        return toolLabel
    }

    return "\(toolLabel): \(toolPreview)"
}

func aiChatToolSections(input: String?, output: String?) -> [AIChatToolSection] {
    var sections: [AIChatToolSection] = []

    if let input, input.isEmpty == false {
        sections.append(
            AIChatToolSection(
                id: "request",
                title: "Request",
                text: input,
                copyButtonTitle: "Copy",
                copyAccessibilityLabel: "Copy request"
            )
        )
    }

    if let output, output.isEmpty == false {
        sections.append(
            AIChatToolSection(
                id: "response",
                title: "Response",
                text: output,
                copyButtonTitle: "Copy",
                copyAccessibilityLabel: "Copy response"
            )
        )
    }

    return sections
}

private func aiChatToolStatusLabel(status: AIChatToolCallStatus) -> String {
    switch status {
    case .started:
        return "Running"
    case .completed:
        return "Done"
    }
}

private func aiChatToolBorderColor(status: AIChatToolCallStatus) -> Color {
    switch status {
    case .started:
        return Color.secondary.opacity(0.4)
    case .completed:
        return Color(.separator)
    }
}

private func aiChatToolBorderStrokeStyle(status: AIChatToolCallStatus) -> StrokeStyle {
    switch status {
    case .started:
        return StrokeStyle(lineWidth: 1, dash: [6, 4])
    case .completed:
        return StrokeStyle(lineWidth: 1)
    }
}
