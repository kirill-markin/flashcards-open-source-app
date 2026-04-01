import AVFoundation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct AIChatView: View {
    @Environment(FlashcardsStore.self) var flashcardsStore: FlashcardsStore
    @Environment(AppNavigationModel.self) var navigation: AppNavigationModel
    @Environment(\.scenePhase) var scenePhase
    let chatStore: AIChatStore
    @State var isCameraPresented: Bool
    @State var isFileImporterPresented: Bool
    @State var isPhotoPickerPresented: Bool
    @State var selectedPhotoItem: PhotosPickerItem?
    @State var isNearBottom: Bool
    @State var isUserScrolling: Bool
    @State var scrollPosition: ScrollPosition
    @State var autoScrollTask: Task<Void, Never>?
    @State var shouldRestoreComposerFocusAfterDictation: Bool
    @State var composerSelection: TextSelection?
    @State var composerDictationInsertionSelection: AIChatDictationInsertionSelection?
    @State var hasAcceptedExternalAIConsent: Bool
    @FocusState var isComposerFocused: Bool

    @MainActor
    init(chatStore: AIChatStore) {
        self.chatStore = chatStore
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
        self._hasAcceptedExternalAIConsent = State(initialValue: chatStore.hasExternalProviderConsent)
    }

    var body: some View {
        VStack(spacing: 0) {
            switch self.accessState {
            case .consentRequired:
                self.consentGate
            case .ready:
                self.chatContent
            }
        }
        .accessibilityIdentifier(UITestIdentifier.aiScreen)
        .navigationTitle("AI")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaBar(edge: .bottom, spacing: 0) {
            if self.accessState == .ready && self.chatStore.isChatInteractive {
                self.composerAccessory
            }
        }
        .toolbar {
            if self.accessState == .ready {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New") {
                        self.chatStore.clearHistory()
                    }
                    .accessibilityIdentifier(UITestIdentifier.aiNewChatButton)
                    .disabled(self.isNewChatDisabled || self.chatStore.isChatInteractive == false)
                }
            }
        }
        .onAppear {
            self.refreshExternalAIConsentState()
            self.chatStore.refreshAccessContextIfNeeded()
            guard self.hasAcceptedExternalAIConsent else {
                return
            }

            self.handleAIChatPresentationRequest(request: self.navigation.aiChatPresentationRequest)
            if self.chatStore.isChatInteractive {
                self.chatStore.warmUpSessionIfNeeded()
            }
        }
        .onChange(of: self.navigation.aiChatPresentationRequest) { _, request in
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
            guard self.navigation.selectedTab == .ai else {
                return
            }

            self.chatStore.refreshAccessContextIfNeeded()
            if self.chatStore.isChatInteractive {
                self.chatStore.warmUpSessionIfNeeded()
            }
        }
        .onChange(of: self.flashcardsStore.workspace?.workspaceId) { _, _ in
            self.chatStore.refreshAccessContextIfNeeded()
        }
        .onChange(of: self.flashcardsStore.cloudSettings?.cloudState) { _, _ in
            self.chatStore.refreshAccessContextIfNeeded()
        }
        .onChange(of: self.flashcardsStore.cloudSettings?.linkedUserId) { _, _ in
            self.chatStore.refreshAccessContextIfNeeded()
        }
        .onChange(of: self.flashcardsStore.cloudSettings?.activeWorkspaceId) { _, _ in
            self.chatStore.refreshAccessContextIfNeeded()
        }
        .onChange(of: self.navigation.selectedTab) { _, nextTab in
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
                    self.chatStore.showGeneralError(message: Flashcards.errorMessage(error: error))
                },
                onCancel: {
                    self.isCameraPresented = false
                }
            )
        }
        .alert(
            self.chatStore.activeAlert?.title ?? "",
            isPresented: self.isAlertPresentedBinding
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

    var isNewChatDisabled: Bool {
        self.chatStore.messages.isEmpty
            && self.chatStore.pendingAttachments.isEmpty
            && self.chatStore.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && self.chatStore.isStreaming == false
            && self.chatStore.dictationState == .idle
    }

    var isAlertPresentedBinding: Binding<Bool> {
        Binding(
            get: {
                self.chatStore.activeAlert != nil
            },
            set: { isPresented in
                if isPresented == false {
                    self.chatStore.dismissAlert()
                }
            }
        )
    }

    var accessState: AIChatAccessState {
        aiChatAccessState(hasExternalProviderConsent: self.hasAcceptedExternalAIConsent)
    }

    var consentGate: some View {
        ScrollView {
            ReadableContentLayout(
                maxWidth: flashcardsReadableFormMaxWidth,
                horizontalPadding: 24
            ) {
                VStack(alignment: .leading, spacing: 16) {
                    Image(systemName: "lock.shield")
                        .font(.system(size: 40))
                        .foregroundStyle(.secondary)

                    Text("Before you use AI")
                        .font(.title3.weight(.semibold))

                    Text("AI can be wrong. Review important results before relying on them.")
                        .foregroundStyle(.secondary)

                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(aiChatExternalProviderDisclosureItems, id: \.self) { item in
                            Label(item, systemImage: "checkmark.circle")
                        }
                    }
                    .font(.subheadline)

                    Button("OK") {
                        self.acceptExternalAIConsent()
                    }
                    .buttonStyle(.glassProminent)
                    .accessibilityIdentifier(UITestIdentifier.aiConsentAcceptButton)

                    VStack(alignment: .leading, spacing: 10) {
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
                }
                .padding(.vertical, 24)
            }
        }
    }

    var chatContent: some View {
        Group {
            switch self.chatStore.bootstrapPhase {
            case .loading:
                self.loadingChatState
            case .failed:
                self.failedChatState
            case .ready:
                if self.chatStore.messages.isEmpty {
                    self.emptyChatState
                } else {
                    self.messageList
                }
            }
        }
    }

    var loadingChatState: some View {
        ContentUnavailableView {
            ProgressView()
            Text("Loading chat")
        } description: {
            Text("We are loading the latest AI chat for this account before enabling the composer.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, aiChatMessageListHorizontalPadding)
    }

    var failedChatState: some View {
        ContentUnavailableView {
            Label("Chat unavailable", systemImage: "exclamationmark.triangle")
        } description: {
            VStack(spacing: 12) {
                Text(self.chatStore.bootstrapFailureMessage ?? "Failed to load AI chat.")
                Button("Retry") {
                    self.chatStore.retryLinkedBootstrap()
                }
                .buttonStyle(.glassProminent)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, aiChatMessageListHorizontalPadding)
    }

    var emptyChatState: some View {
        ContentUnavailableView {
            Text("Try asking")
        } description: {
            VStack(spacing: 8) {
                Text("Summarize weak areas from my due cards.")
                Text("Find cards tagged with grammar and suggest cleanup.")
                Text("Propose a new deck filter and explain the exact change.")
            }
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, aiChatMessageListHorizontalPadding)
        .accessibilityIdentifier(UITestIdentifier.aiEmptyState)
        .contentShape(Rectangle())
        .onTapGesture {
            self.isComposerFocused = false
        }
    }

    var messageList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
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

    func acceptExternalAIConsent() {
        grantAIChatExternalProviderConsent(userDefaults: self.flashcardsStore.userDefaults)
        self.refreshExternalAIConsentState()
        self.chatStore.activateWorkspace()
        self.handleAIChatPresentationRequest(request: self.navigation.aiChatPresentationRequest)
        if self.chatStore.isChatInteractive {
            self.chatStore.warmUpSessionIfNeeded()
        }
    }

    func refreshExternalAIConsentState() {
        self.hasAcceptedExternalAIConsent = hasAIChatExternalProviderConsent(
            userDefaults: self.flashcardsStore.userDefaults
        )
    }

    func ensureExternalAIConsent() -> Bool {
        self.refreshExternalAIConsentState()
        guard self.hasAcceptedExternalAIConsent else {
            self.chatStore.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return false
        }

        return true
    }

    func handleAIChatPresentationRequest(request: AIChatPresentationRequest?) {
        guard let request else {
            return
        }

        self.chatStore.applyPresentationRequest(request: request)
        self.navigation.clearAIChatPresentationRequest()
    }

    func repairStatus(for message: AIChatMessage) -> AIChatRepairAttemptStatus? {
        guard message.role == .assistant else {
            return nil
        }

        guard self.chatStore.messages.last?.id == message.id else {
            return nil
        }

        return self.chatStore.repairStatus
    }

    func handlePrimaryComposerAction() {
        guard self.chatStore.isChatInteractive else {
            return
        }
        if self.chatStore.canStopResponse {
            self.chatStore.cancelStreaming()
            return
        }

        guard self.ensureExternalAIConsent() else {
            return
        }
        self.chatStore.sendMessage()
        self.isComposerFocused = true
    }

}

let aiChatComposerMaximumLineCount: Int = 5
let aiChatComposerTopPadding: CGFloat = 8
let aiChatComposerSendButtonInset: CGFloat = 8
let aiChatComposerSendButtonVisualSize: CGFloat = 28
let aiChatComposerSendButtonReservedTrailingPadding: CGFloat = 44
let aiChatComposerStatusLaneHeight: CGFloat = 24
let aiChatComposerStatusLaneSpacing: CGFloat = 8
let aiChatComposerDictationTextFieldTopPadding: CGFloat = 12 + aiChatComposerStatusLaneHeight + aiChatComposerStatusLaneSpacing
let aiChatMessageListHorizontalPadding: CGFloat = 16
let aiChatAutoScrollIntervalSeconds: Double = 2.0
let aiChatAutoScrollBottomThreshold: CGFloat = 24
let aiChatAutoScrollAnimationDurationSeconds: Double = 0.25
let aiChatBubbleMaximumWidth: CGFloat = 720
let aiChatTypingIndicatorDotCount: Int = 3
let aiChatTypingIndicatorAnimationStepSeconds: Double = 0.3
