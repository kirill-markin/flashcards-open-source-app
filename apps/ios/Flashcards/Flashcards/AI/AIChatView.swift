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
    @State var isAutoFollowEnabled: Bool
    @State var scrollPosition: ScrollPosition
    @State var autoScrollTask: Task<Void, Never>?
    @State var shouldRestoreComposerFocusAfterDictation: Bool
    @State var composerSelection: TextSelection?
    @State var composerDictationInsertionSelection: AIChatDictationInsertionSelection?
    @State var deferredPresentationRequest: AIChatPresentationRequest?
    @FocusState var isComposerFocused: Bool

    @MainActor
    init(chatStore: AIChatStore) {
        self.chatStore = chatStore
        self.isCameraPresented = false
        self.isFileImporterPresented = false
        self.isPhotoPickerPresented = false
        self.selectedPhotoItem = nil
        self.isAutoFollowEnabled = true
        self.scrollPosition = ScrollPosition(idType: String.self)
        self.autoScrollTask = nil
        self.shouldRestoreComposerFocusAfterDictation = false
        self.composerSelection = nil
        self.composerDictationInsertionSelection = nil
        self.deferredPresentationRequest = nil
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
            self.syncChatSurface(refreshConsent: true)
            self.captureAIChatPresentationRequest(request: self.navigation.aiChatPresentationRequest)
            self.handleAIChatPresentationRequest(request: self.deferredPresentationRequest)
        }
        .onChange(of: self.navigation.aiChatPresentationRequest) { _, request in
            self.captureAIChatPresentationRequest(request: request)
            self.handleAIChatPresentationRequest(request: self.deferredPresentationRequest)
        }
        .onChange(of: self.chatStore.bootstrapPhase) { _, nextPhase in
            guard nextPhase == .ready else {
                return
            }

            self.handleAIChatPresentationRequest(request: self.deferredPresentationRequest)
        }
        .onChange(of: self.chatStore.composerPhase) { _, nextPhase in
            guard nextPhase == .idle else {
                return
            }

            self.handleAIChatPresentationRequest(request: self.deferredPresentationRequest)
        }
        .onChange(of: self.scenePhase) { _, nextPhase in
            guard nextPhase == .active else {
                self.shouldRestoreComposerFocusAfterDictation = false
                self.syncChatSurface(refreshConsent: false)
                return
            }
            self.syncChatSurface(refreshConsent: true)
        }
        .onChange(of: self.flashcardsStore.workspace?.workspaceId) { _, _ in
            self.syncChatSurface(refreshConsent: false)
        }
        .onChange(of: self.flashcardsStore.cloudSettings?.cloudState) { _, _ in
            self.syncChatSurface(refreshConsent: false)
        }
        .onChange(of: self.flashcardsStore.cloudSettings?.linkedUserId) { _, _ in
            self.syncChatSurface(refreshConsent: false)
        }
        .onChange(of: self.flashcardsStore.cloudSettings?.activeWorkspaceId) { _, _ in
            self.syncChatSurface(refreshConsent: false)
        }
        .onChange(of: self.navigation.selectedTab) { _, nextTab in
            guard nextTab == .ai else {
                self.shouldRestoreComposerFocusAfterDictation = false
                self.syncChatSurface(refreshConsent: false)
                return
            }
            self.syncChatSurface(refreshConsent: false)
        }
        .onChange(of: self.chatStore.dictationState) { _, nextState in
            self.handleDictationStateChange(nextState)
            guard nextState == .idle else {
                return
            }
            self.handleAIChatPresentationRequest(request: self.deferredPresentationRequest)
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
                    self.chatStore.showGeneralError(error: error)
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
        aiChatAccessState(hasExternalProviderConsent: self.chatStore.hasExternalProviderConsent)
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
                self.chatScrollSurface
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
                if self.flashcardsStore.isCloudSyncBlocked {
                    Button("Open account status") {
                        self.navigation.openSettings(destination: .accountStatus)
                    }
                    .buttonStyle(.glassProminent)
                } else {
                    Button("Retry") {
                        self.chatStore.retryLinkedBootstrap()
                    }
                    .buttonStyle(.glassProminent)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, aiChatMessageListHorizontalPadding)
    }

    var emptyChatState: some View {
        ContentUnavailableView {
            Text("Start a new AI chat")
                .accessibilityIdentifier(UITestIdentifier.aiEmptyState)
        } description: {
            Text("Ask about cards, review history, or attach notes for extraction.")
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
        .padding(.horizontal, aiChatMessageListHorizontalPadding)
        .accessibilityIdentifier(UITestIdentifier.aiEmptyState)
    }

    var chatScrollSurface: some View {
        ScrollView {
            self.chatScrollContent
        }
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.bottom, for: .alignment)
        .scrollPosition(self.$scrollPosition, anchor: .bottom)
        .contentMargins(.horizontal, aiChatMessageListHorizontalPadding, for: .scrollContent)
        .contentMargins(.horizontal, 0, for: .scrollIndicators)
        .contentShape(Rectangle())
        .scrollDismissesKeyboard(.interactively)
        .onTapGesture {
            self.dismissComposerFocus()
        }
        .onScrollPhaseChange { _, nextPhase, context in
            let nextScrollState = aiChatScrollState(
                scrollPhase: nextPhase,
                scrollGeometry: context.geometry,
                bottomThreshold: aiChatAutoScrollBottomThreshold
            )

            // Only user-driven scroll phases can detach auto-follow. Animated scrolls
            // are app-driven and should not flip the latch while the assistant content grows.
            if nextScrollState.isUserInitiatedScroll && nextScrollState.isNearBottom == false {
                self.isAutoFollowEnabled = false
                return
            }

            if nextPhase == .idle && nextScrollState.isNearBottom {
                self.isAutoFollowEnabled = true
                if self.chatStore.isStreaming {
                    self.scrollToBottomIfNeeded(isAnimated: false)
                }
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
                self.isAutoFollowEnabled = true
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

    @ViewBuilder
    var chatScrollContent: some View {
        if self.chatStore.messages.isEmpty {
            VStack {
                self.emptyChatState
            }
            .scrollTargetLayout()
            .frame(maxWidth: .infinity)
            .containerRelativeFrame(.vertical, alignment: .center)
            .padding(.vertical, 12)
        } else {
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
    }

    func acceptExternalAIConsent() {
        guard self.chatStore.hasExternalProviderConsent == false else {
            return
        }

        self.chatStore.acceptExternalProviderConsent()
        self.syncChatSurface(refreshConsent: false)
        self.handleAIChatPresentationRequest(request: self.navigation.aiChatPresentationRequest)
    }

    func refreshExternalAIConsentState() {
        self.chatStore.refreshExternalProviderConsentState()
        self.syncChatSurface(refreshConsent: false)
    }

    func syncChatSurface(refreshConsent: Bool) {
        if refreshConsent {
            self.chatStore.refreshExternalProviderConsentState()
        }

        self.chatStore.updateSurface(activity: self.currentSurfaceActivity())
    }

    func currentSurfaceActivity() -> AIChatSurfaceActivity {
        AIChatSurfaceActivity(
            isSceneActive: self.scenePhase == .active,
            isAITabSelected: self.navigation.selectedTab == .ai,
            hasExternalProviderConsent: self.chatStore.hasExternalProviderConsent,
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            cloudState: self.flashcardsStore.cloudSettings?.cloudState,
            linkedUserId: self.flashcardsStore.cloudSettings?.linkedUserId,
            activeWorkspaceId: self.flashcardsStore.cloudSettings?.activeWorkspaceId
        )
    }

    func ensureExternalAIConsent() -> Bool {
        self.refreshExternalAIConsentState()
        guard self.chatStore.hasExternalProviderConsent else {
            self.chatStore.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return false
        }

        return true
    }

    func captureAIChatPresentationRequest(request: AIChatPresentationRequest?) {
        guard let request else {
            return
        }

        self.deferredPresentationRequest = request
    }

    func handleAIChatPresentationRequest(request: AIChatPresentationRequest?) {
        let resolvedRequest = request ?? self.navigation.aiChatPresentationRequest ?? self.deferredPresentationRequest
        guard let resolvedRequest else {
            return
        }
        self.captureAIChatPresentationRequest(request: resolvedRequest)
        guard self.chatStore.hasExternalProviderConsent else {
            return
        }
        guard self.chatStore.isChatInteractive else {
            return
        }

        let didApplyRequest = self.chatStore.applyPresentationRequest(request: resolvedRequest)
        guard didApplyRequest else {
            return
        }
        self.deferredPresentationRequest = nil
        self.isComposerFocused = true
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

    func dismissComposerFocus() {
        self.isComposerFocused = false
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
