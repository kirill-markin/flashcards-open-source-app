import AVFoundation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct AIChatView: View {
    @Environment(FlashcardsStore.self) var flashcardsStore: FlashcardsStore
    @Environment(PremiumPresenter.self) var premiumPresenter: PremiumPresenter
    @Environment(AppNavigationModel.self) var navigation: AppNavigationModel
    @Environment(\.scenePhase) var scenePhase
    @Environment(\.tabBarPlacement) var tabBarPlacement
    @Environment(\.isKeyboardDocked) private var isKeyboardDocked
    let chatStore: AIChatStore
    let isCompanion: Bool
    let companionHostTab: AppTab?

    var isPresentationActive: Bool {
        self.isCompanion
            ? self.navigation.isAICompanionVisible
                && (self.companionHostTab == nil || self.navigation.selectedTab == self.companionHostTab)
            : self.navigation.selectedTab == .ai
    }
    @State var isCameraPresented: Bool
    @State var isFileImporterPresented: Bool
    @State var isPhotoPickerPresented: Bool
    @State var selectedPhotoItem: PhotosPickerItem?
    @State var isDropTargeted: Bool
    @State var isComposerDropHovering: Bool
    @State var isAutoFollowEnabled: Bool
    @State var hasActiveUserScrollGesture: Bool
    @State var composerAttachmentViewportWidth: CGFloat?
    @State private var presentationRequestCoordinator: AIChatPresentationRequestCoordinator
    @State var isComposerFocused: Bool
    #if targetEnvironment(macCatalyst)
    @State var macComposerReturnKeyOwner = MacComposerReturnKeyOwner()
    @State private var restoresMacComposerFocus = false
    #endif
    @State var refocusesComposerAfterSend: Bool

    @MainActor
    init(chatStore: AIChatStore, isCompanion: Bool = false, companionHostTab: AppTab? = nil) {
        self.chatStore = chatStore
        self.isCompanion = isCompanion
        self.companionHostTab = companionHostTab
        self.isCameraPresented = false
        self.isFileImporterPresented = false
        self.isPhotoPickerPresented = false
        self.selectedPhotoItem = nil
        self.isDropTargeted = false
        self.isComposerDropHovering = false
        self.isAutoFollowEnabled = true
        self.hasActiveUserScrollGesture = false
        self.composerAttachmentViewportWidth = nil
        self.presentationRequestCoordinator = AIChatPresentationRequestCoordinator()
        self.isComposerFocused = false
        self.refocusesComposerAfterSend = false
    }

    var body: some View {
        self.bodyPresentationModifiers
            #if targetEnvironment(macCatalyst)
            .macToolbarContribution(self.macChatToolbar)
            #endif
    }

    var bodyPresentationModifiers: some View {
        self.bodyLifecycleModifiers
            .fileImporter(
                isPresented: self.$isFileImporterPresented,
                allowedContentTypes: aiChatImporterContentTypes(),
                allowsMultipleSelection: true
            ) { result in
                self.handleFileImportResult(result: result)
            }
            .photosPicker(
                isPresented: self.$isPhotoPickerPresented,
                selection: self.$selectedPhotoItem,
                matching: .images,
                preferredItemEncoding: .current,
                photoLibrary: .shared()
            )
            .sheet(isPresented: self.$isCameraPresented, content: self.cameraPickerSheetContent)
            .alert(
                self.activeAlertTitle,
                isPresented: self.isAlertPresentedBinding,
                actions: self.alertActionsContent,
                message: self.alertMessageContent
            )
            .reviewKeyboardBlockingPresentation(
                isPresented: self.isFileImporterPresented
                    || self.isPhotoPickerPresented
                    || self.isCameraPresented
                    || self.isAlertPresentedBinding.wrappedValue
            )
    }

    var bodyLifecycleModifiers: some View {
        self.bodyBaseModifiers
            .onAppear(perform: self.handleViewAppear)
            .onDisappear {
                self.recordComposerPresentation(operation: .presentation, isVisible: false)
            }
            .onChange(of: self.isComposerFocused) { _, _ in
                self.recordComposerPresentation(operation: .focus, isVisible: self.isPresentationActive)
            }
            .onChange(of: self.chatStore.quotaRefusal, initial: true) { _, refusal in
                self.handleQuotaRefusal(refusal)
            }
            .onChange(of: self.navigation.aiChatPresentationRequest) { _, request in
                self.handlePresentationRequestChange(request: request)
            }
            .onChange(of: self.readyAnkiImportRequestID, initial: true) { _, requestID in
                self.handleAnkiImportRequest(id: requestID)
            }
            .onChange(of: self.chatStore.bootstrapPhase) { _, nextPhase in
                self.handleBootstrapPhaseChange(nextPhase: nextPhase)
            }
            .onChange(of: self.chatStore.composerPhase) { previousPhase, nextPhase in
                self.handleComposerPhaseChange(previousPhase: previousPhase, nextPhase: nextPhase)
            }
            .onChange(of: self.chatStore.hasExternalProviderConsent) { _, hasConsent in
                self.handleExternalProviderConsentChange(hasConsent: hasConsent)
            }
            .onChange(of: self.scenePhase) { _, nextPhase in
                self.handleScenePhaseChange(nextPhase: nextPhase)
            }
            #if targetEnvironment(macCatalyst)
            .onChange(of: self.composerTextFieldDisabled) { _, _ in
                self.restoreMacComposerFocusIfReady()
            }
            #endif
            .onChange(of: self.flashcardsStore.workspace?.workspaceId) { _, _ in
                self.handleSurfaceInputsChange()
            }
            .onChange(of: self.flashcardsStore.cloudSettings?.cloudState) { _, _ in
                self.handleSurfaceInputsChange()
            }
            .onChange(of: self.flashcardsStore.cloudSettings?.linkedUserId) { _, _ in
                self.handleSurfaceInputsChange()
            }
            .onChange(of: self.flashcardsStore.cloudSettings?.activeWorkspaceId) { _, _ in
                self.handleSurfaceInputsChange()
            }
            .onChange(of: self.isPresentationActive) { _, isVisible in
                self.handleChatVisibilityChange(isVisible: isVisible)
            }
            .onChange(of: self.chatStore.dictationState) { _, nextState in
                self.handleDictationStateViewChange(nextState: nextState)
            }
            .onChange(of: self.chatStore.completedDictationTranscript) { _, nextTranscript in
                self.handleCompletedDictationTranscriptChange(nextTranscript: nextTranscript)
            }
            .onChange(of: self.selectedPhotoItem) { _, newItem in
                self.handleSelectedPhotoItemChange(newItem: newItem)
            }
    }

    @ViewBuilder
    var bodyBaseModifiers: some View {
        if self.isCompanion {
            if UIDevice.current.userInterfaceIdiom == .pad {
                self.companionBody
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if self.usesCompactCompanionToolbar == false {
                            self.companionHeader
                                .frame(maxWidth: .infinity)
                                .background(.bar)
                        }
                    }
                    #if !targetEnvironment(macCatalyst)
                    .toolbar {
                        if self.usesCompactCompanionToolbar {
                            self.companionToolbarContent
                        }
                    }
                    #endif
            } else {
                self.companionBody
                    .nativeTopBar(alignment: .center) {
                        self.companionHeader
                    }
            }
        } else {
            self.bodyCommonModifiers
                .nativeNavigationTitle(aiSettingsLocalized("ai.title", "AI"))
                .navigationBarTitleDisplayMode(.inline)
                #if !targetEnvironment(macCatalyst)
                .toolbar {
                    self.toolbarContent
                }
                #endif
        }
    }

    #if targetEnvironment(macCatalyst)
    private var macChatToolbar: MacToolbarContribution? {
        guard self.isPresentationActive else { return nil }
        var actions = [MacToolbarAction(
            identifier: UITestIdentifier.aiHistoryButton, symbol: "list.bullet",
            label: aiSettingsLocalized("ai.history.button", "History"),
            isEnabled: self.chatStore.dictationState == .idle,
            perform: { _ in self.openChatHistory() }
        )]
        if self.accessState == .ready {
            actions.append(MacToolbarAction(
                identifier: UITestIdentifier.aiNewChatButton, symbol: "square.and.pencil",
                label: aiSettingsLocalized("ai.newChat", "New"),
                isEnabled: self.isNewChatDisabled == false && self.chatStore.isChatInteractive,
                perform: { _ in self.startNewChat() }
            ))
        }
        if self.isCompanion {
            return MacToolbarContribution(tab: self.companionHostTab ?? self.navigation.selectedTab, role: .companion, companionActions: actions)
        }
        return MacToolbarContribution(tab: .ai, trailing: [MacToolbarGroup(identifier: "nibomo.aiActions", actions: actions)])
    }
    #endif

    var companionBody: some View {
        self.bodyCommonModifiers
            .overlay(alignment: .trailing) {
                if UIDevice.current.userInterfaceIdiom == .pad {
                    HStack(spacing: 0) { Divider() }
                        .frame(width: 1)
                        .ignoresSafeArea(.container, edges: .bottom)
                }
            }
    }

    var bodyCommonModifiers: some View {
        self.bodyContent
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityIdentifier(UITestIdentifier.aiScreen)
            .nativeBottomBar(alignment: .center, usesColumnLayout: UIDevice.current.userInterfaceIdiom == .pad) {
                self.bottomBarContent
            }
            .overlay {
                if (self.isDropTargeted || self.isComposerDropHovering) && self.chatStore.canAttachToDraft {
                    self.dropOverlay
                }
            }
            .onDrop(
                of: [.item],
                delegate: AIChatAttachmentDropDelegate(
                    isTargeted: self.$isDropTargeted,
                    canAttachToDraft: self.chatStore.canAttachToDraft,
                    onDrop: self.attachItemProviders
                )
            )
            .ignoresSafeArea(UIDevice.current.userInterfaceIdiom == .pad || self.isKeyboardDocked || self.navigation.canPresentAICompanion == false ? [] : .keyboard, edges: .bottom)
    }

    var dropOverlay: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(.regularMaterial)
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(.tint, style: StrokeStyle(lineWidth: 2, dash: [8, 6]))
            }
            .overlay {
                Label(aiSettingsLocalized("ai.drop.overlay", "Drop files to attach"), systemImage: "paperclip")
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .allowsHitTesting(false)
    }

    var usesStudySpacing: Bool {
        self.isCompanion && UIDevice.current.userInterfaceIdiom == .pad
    }

    var chatContentHorizontalPadding: CGFloat {
        self.usesStudySpacing ? 20 : aiChatMessageListHorizontalPadding
    }

    var bodyContent: some View {
        VStack(spacing: 0) {
            switch self.accessState {
            case .consentRequired:
                self.consentGate
            case .ready:
                if self.isPresentationActive && self.navigation.ankiImportRequest != nil {
                    HStack {
                        ProgressView(ankiImportWaitingMessage())
                        Spacer()
                        Button(aiSettingsLocalized("common.cancel", "Cancel"), action: self.navigation.cancelAnkiImport)
                    }
                    .padding(.horizontal, self.chatContentHorizontalPadding)
                    .padding(.vertical, 8)
                }
                self.chatContent
            }
        }
    }

    var isNewChatDisabled: Bool {
        self.chatStore.canStartNewChat == false
    }

    var composerSelection: TextSelection? {
        get { self.chatStore.composerSelection }
        nonmutating set { self.chatStore.composerSelection = newValue }
    }

    var composerDiagnosticPresentation: NativeEditorPresentation {
        NativeEditorPresentation(
            host: self.isCompanion ? .aiCompanion : .aiTab,
            hostTab: self.isCompanion ? self.companionHostTab ?? self.navigation.selectedTab : .ai,
            isFocused: self.isComposerFocused,
            isVisible: self.isPresentationActive,
            isSceneActive: self.scenePhase == .active
        )
    }

    func recordComposerPresentation(operation: NativeEditorOperation, isVisible: Bool) {
        let current = self.composerDiagnosticPresentation
        let presentation = NativeEditorPresentation(
            host: current.host, hostTab: current.hostTab, isFocused: current.isFocused,
            isVisible: isVisible, isSceneActive: current.isSceneActive
        )
        guard self.isPresentationActive
            || (self.chatStore.editorDiagnosticPresentation?.host == current.host
                && self.chatStore.editorDiagnosticPresentation?.hostTab == current.hostTab) else {
            return
        }
        self.chatStore.editorDiagnosticPresentation = presentation
        FlashcardsObservability.addBreadcrumb(.nativeEditor(NativeEditorObservation(
            editor: .aiComposer, operation: operation, phase: .after,
            beforeUTF16Count: self.chatStore.inputText.utf16.count,
            afterUTF16Count: self.chatStore.inputText.utf16.count,
            selectionKind: NativeEditorSelectionKind(self.composerSelection),
            presentation: presentation
        )))
    }

    var composerTextBinding: Binding<String> {
        Binding(get: { self.chatStore.inputText }, set: { text in
            self.chatStore.editorDiagnosticPresentation = self.composerDiagnosticPresentation
            self.chatStore.inputText = text
        })
    }

    var composerSelectionBinding: Binding<TextSelection?> {
        Binding(
            get: { self.chatStore.composerSelection },
            set: { selection in
                guard self.isPresentationActive else { return }
                self.chatStore.editorDiagnosticPresentation = self.composerDiagnosticPresentation
                self.chatStore.composerSelection = selection
            }
        )
    }

    var isAlertPresentedBinding: Binding<Bool> {
        Binding(
            get: {
                self.isPresentationActive && self.chatStore.activeAlert != nil
            },
            set: { isPresented in
                if self.isPresentationActive && isPresented == false {
                    self.chatStore.dismissAlert()
                }
            }
        )
    }

    var activeAlertTitle: String {
        self.chatStore.activeAlert?.title ?? ""
    }

    var accessState: AIChatAccessState {
        aiChatAccessState(hasExternalProviderConsent: self.chatStore.hasExternalProviderConsent)
    }

    @ViewBuilder
    var bottomBarContent: some View {
        if self.accessState == .ready && self.chatStore.shouldShowComposerAccessory {
            self.composerAccessory
        }
    }

    var openSettingsActionTitle: String {
        #if targetEnvironment(macCatalyst)
        return String(
            localized: "shared.action.open_system_settings",
            table: "Foundation",
            comment: "Mac permission action title to open System Settings"
        )
        #else
        return aiSettingsLocalized("common.openSettings", "Open Settings")
        #endif
    }

    @ViewBuilder
    func alertActionsContent() -> some View {
        if self.chatStore.activeAlert?.showsSettingsAction == true {
            Button(aiSettingsLocalized("common.cancel", "Cancel"), role: .cancel) {
                self.chatStore.dismissAlert()
            }
            Button(self.openSettingsActionTitle) {
                self.chatStore.dismissAlert()
                Task { @MainActor in
                    do {
                        try await openApplicationSettings()
                    } catch {
                        self.chatStore.showGeneralError(message: errorMessage(error: error))
                    }
                }
            }
        } else {
            Button(aiSettingsLocalized("common.ok", "OK"), role: .cancel) {
                self.chatStore.dismissAlert()
            }
        }
    }

    @ViewBuilder
    func alertMessageContent() -> some View {
        Text(self.chatStore.activeAlert?.message ?? "")
    }

    @ViewBuilder
    func cameraPickerSheetContent() -> some View {
        AIChatCameraPicker(
            onCapture: self.handleCameraCapture,
            onFailure: self.handleCameraFailure,
            onCancel: self.handleCameraCancel
        )
    }

    #if !targetEnvironment(macCatalyst)
    @ToolbarContentBuilder
    var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            self.historyToolbarButton
        }
        if self.accessState == .ready {
            ToolbarItem(placement: .topBarTrailing) {
                if UIDevice.current.userInterfaceIdiom == .pad {
                    self.newChatToolbarButton.tint(Color.primary)
                } else {
                    self.newChatToolbarButton
                        .labelStyle(.titleOnly)
                }
            }
        }
    }
    #endif

    var historyToolbarButton: some View {
        Button(action: self.openChatHistory) {
            Image(systemName: "list.bullet")
        }
        .accessibilityLabel(aiSettingsLocalized("ai.history.button", "History"))
        .accessibilityIdentifier(UITestIdentifier.aiHistoryButton)
        .disabled(self.chatStore.dictationState != .idle)
    }

    private func openChatHistory() {
        self.dismissComposerFocus()
        if self.isCompanion { self.navigation.selectTab(.ai) }
        self.navigation.aiPath.append(AIChatHistoryListRoute())
    }

    var newChatToolbarButton: some View {
        Button(action: self.startNewChat) {
            Label(aiSettingsLocalized("ai.newChat", "New"), systemImage: "square.and.pencil")
        }
        .accessibilityIdentifier(UITestIdentifier.aiNewChatButton)
        .disabled(self.isNewChatDisabled || self.chatStore.isChatInteractive == false)
    }

    var consentGate: some View {
        AIConsentDisclosureView(onAllowed: self.acceptExternalAIConsent, onNotNow: self.leaveAIAfterDecliningConsent)
    }

    @ViewBuilder
    var chatContent: some View {
        if self.shouldShowChatScrollSurface {
            self.chatScrollSurface
        } else if case .failed = self.chatStore.bootstrapPhase {
            self.failedChatState
        } else {
            self.loadingChatState
        }
    }

    var shouldShowChatScrollSurface: Bool {
        switch self.chatStore.bootstrapPhase {
        case .loading:
            return self.chatStore.messages.isEmpty == false
        case .failed:
            return false
        case .ready:
            return true
        }
    }

    var loadingChatState: some View {
        ContentUnavailableView {
            ProgressView()
            Text(aiSettingsLocalized("ai.loading.title", "Loading chat"))
        } description: {
            Text(
                aiSettingsLocalized(
                    "ai.loading.description",
                    "We are loading the latest AI chat for this account before enabling the composer."
                )
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, self.chatContentHorizontalPadding)
    }

    var failedChatState: some View {
        let presentation = self.chatStore.bootstrapFailurePresentation

        return ContentUnavailableView {
            Label(aiSettingsLocalized("ai.failed.title", "Chat unavailable"), systemImage: "exclamationmark.triangle")
        } description: {
            VStack(spacing: 12) {
                Text(presentation?.message ?? aiSettingsLocalized("ai.failed.message", "Failed to load AI chat."))
                    .textSelection(.enabled)
                if self.flashcardsStore.isCloudSyncBlocked {
                    Button(aiSettingsLocalized("ai.failed.openAccountStatus", "Open account status")) {
                        self.navigation.openSettings(destination: .accountStatus)
                    }
                    .nativeProminentActionButtonStyle()
                } else {
                    Button(aiSettingsLocalized("common.retry", "Retry")) {
                        self.chatStore.retryLinkedBootstrap()
                    }
                    .nativeProminentActionButtonStyle()
                }
                if let technicalDetails = presentation?.technicalDetails, technicalDetails.isEmpty == false {
                    DisclosureGroup(aiSettingsLocalized("settings.account.cloudSignIn.technicalDetails", "Technical details")) {
                        Text(technicalDetails)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .padding(.top, 4)
                            .contextMenu {
                                Button(aiSettingsLocalized("settings.account.cloudSignIn.copyTechnicalDetails", "Copy technical details")) {
                                    UIPasteboard.general.string = technicalDetails
                                }
                            }
                    }
                    .tint(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, self.chatContentHorizontalPadding)
    }

    var emptyChatState: some View {
        ContentUnavailableView {
            Text(aiSettingsLocalized("ai.emptyState.title", "Start a new AI chat"))
        } description: {
            Text(
                aiSettingsLocalized(
                    "ai.emptyState.description",
                    "Ask about cards, review history, or attach notes for extraction."
                )
            )
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
        .padding(.horizontal, self.chatContentHorizontalPadding)
    }

    func acceptExternalAIConsent() {
        self.syncChatSurface(refreshConsent: false)
        self.handleAIChatPresentationRequest(
            request: self.navigation.aiChatPresentationRequest,
            source: .acceptedExternalAIConsent
        )
    }

    func leaveAIAfterDecliningConsent() {
        let wasAnkiImport = self.navigation.ankiImportRequest != nil
        self.navigation.cancelAnkiImport()
        self.presentationRequestCoordinator.clearDeferredPresentationRequest()
        if let request = self.navigation.aiChatPresentationRequest {
            self.navigation.clearAIChatPresentationRequest(request: request)
        }
        self.navigation.isAICompanionPresented = false
        if self.navigation.selectedTab == .ai {
            self.navigation.selectTab(wasAnkiImport ? .library : .review)
        }
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
            isAITabSelected: self.navigation.isAIChatVisible,
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

    private var readyAnkiImportRequestID: UUID? {
        guard self.isPresentationActive, self.scenePhase == .active,
              self.isCompanion || self.navigation.aiPath.isEmpty,
              let request = self.navigation.ankiImportRequest else {
            return nil
        }

        if self.matchesCurrentAccessContext(request) == false {
            return request.id
        }

        guard self.chatStore.hasExternalProviderConsent,
              self.chatStore.isChatInteractive,
              self.chatStore.composerPhase == .idle,
              self.chatStore.dictationState == .idle else {
            return nil
        }
        return request.id
    }

    private func handleAnkiImportRequest(id: UUID?) {
        guard let id, id == self.readyAnkiImportRequestID else {
            return
        }

        self.syncChatSurface(refreshConsent: true)
        guard id == self.readyAnkiImportRequestID,
              let request = self.navigation.takeAnkiImportRequest() else {
            return
        }
        guard self.matchesCurrentAccessContext(request) else {
            aiChatRemoveAttachmentFiles(attachments: request.attachments)
            self.chatStore.showGeneralError(message: ankiImportWorkspaceChangedMessage())
            return
        }
        guard self.chatStore.serverChatConfig.features.attachmentsEnabled else {
            aiChatRemoveAttachmentFiles(attachments: request.attachments)
            self.chatStore.showGeneralError(message: aiSettingsLocalized(
                "settings.workspace.import.anki.attachmentsUnavailable",
                "File attachments are unavailable in AI chat. Try importing again when attachments are available."
            ))
            return
        }

        self.dismissComposerFocus()
        self.chatStore.startAnkiImport(attachments: request.attachments)
    }

    private func matchesCurrentAccessContext(_ request: AnkiImportPresentationRequest) -> Bool {
        request.matches(
            accessContext: self.chatStore.currentAccessContext(),
            preservedGuestLink: self.flashcardsStore.preservedGuestWorkspaceLink
        )
    }

    private var presentationRequestContext: AIChatPresentationRequestContext {
        AIChatPresentationRequestContext(
            isPresentationActive: self.isPresentationActive,
            navigationRequest: self.navigation.aiChatPresentationRequest,
            chatStore: self.chatStore,
            syncChatSurface: { self.syncChatSurface(refreshConsent: false) },
            selectedTab: self.navigation.selectedTab,
            cloudState: self.flashcardsStore.cloudSettings?.cloudState,
            workspaceId: self.flashcardsStore.workspace?.workspaceId,
            activeWorkspaceId: self.flashcardsStore.cloudSettings?.activeWorkspaceId
        )
    }

    private func captureAIChatPresentationRequest(
        request: AIChatPresentationRequest?,
        source: AIChatPresentationLifecycleSource
    ) {
        self.presentationRequestCoordinator.capture(
            request: request,
            source: source,
            context: self.presentationRequestContext
        )
    }

    private func handleAIChatPresentationRequest(
        request: AIChatPresentationRequest?,
        source: AIChatPresentationLifecycleSource
    ) {
        guard self.navigation.ankiImportRequest == nil else {
            self.presentationRequestCoordinator.clearDeferredPresentationRequest()
            return
        }

        guard let completedRequest = self.presentationRequestCoordinator.handle(
            request: request,
            source: source,
            context: self.presentationRequestContext
        ) else {
            return
        }
        if case .attachCard = completedRequest,
           let draftText = makeFlashcardsUITestMarketingAIDraft(processInfo: ProcessInfo.processInfo) {
            self.chatStore.inputText = draftText
            self.isComposerFocused = false
        } else {
            self.isComposerFocused = true
        }
        self.navigation.clearAIChatPresentationRequest(request: completedRequest)
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
        self.dismissComposerFocus()
        self.chatStore.sendMessage()
    }

    /// Hardware Return keeps the composer focused for the next message, as on web and in Messages.
    func sendComposerMessageFromReturnKey() {
        guard self.ensureExternalAIConsent() else {
            return
        }
        self.chatStore.sendMessage()
        // A started send disables the draft field, which drops its focus until the run starts.
        self.refocusesComposerAfterSend = self.composerTextFieldDisabled
    }

    func dismissComposerFocus() {
        #if targetEnvironment(macCatalyst)
        self.restoresMacComposerFocus = false
        #endif
        self.chatStore.editorDiagnosticPresentation = self.composerDiagnosticPresentation
        self.chatStore.recordComposerEditing(operation: .focus, phase: .before, beforeUTF16Count: self.chatStore.inputText.utf16.count, afterUTF16Count: self.chatStore.inputText.utf16.count)
        self.isComposerFocused = false
        self.chatStore.editorDiagnosticPresentation = self.composerDiagnosticPresentation
        self.composerSelection = nil
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil,
            from: nil,
            for: nil
        )
    }

    func startNewChat() {
        guard self.isPresentationActive,
              self.accessState == .ready,
              self.isNewChatDisabled == false,
              self.chatStore.isChatInteractive else {
            return
        }
        self.dismissComposerFocus()
        self.chatStore.clearHistory()
    }

    func handleViewAppear() {
        self.recordComposerPresentation(operation: .presentation, isVisible: self.isPresentationActive)
        self.handleQuotaRefusal(self.chatStore.quotaRefusal)
        self.syncChatSurface(refreshConsent: true)
        self.refreshAIUsage()
        self.handleCompletedDictationTranscriptChange(nextTranscript: self.chatStore.completedDictationTranscript)
        self.captureAIChatPresentationRequest(
            request: self.navigation.aiChatPresentationRequest,
            source: .viewAppear
        )
        self.handleAIChatPresentationRequest(
            request: self.presentationRequestCoordinator.deferredPresentationRequest,
            source: .viewAppear
        )
    }

    func handlePresentationRequestChange(request: AIChatPresentationRequest?) {
        self.captureAIChatPresentationRequest(
            request: request,
            source: .navigationRequestChange
        )
        guard self.presentationRequestCoordinator.deferredPresentationRequest != nil else {
            return
        }
        guard self.isPresentationActive else {
            self.handleAIChatPresentationRequest(
                request: self.presentationRequestCoordinator.deferredPresentationRequest,
                source: .navigationRequestChange
            )
            return
        }

        self.syncChatSurface(refreshConsent: false)
        self.handleAIChatPresentationRequest(
            request: self.presentationRequestCoordinator.deferredPresentationRequest,
            source: .navigationRequestChange
        )
    }

    func handleBootstrapPhaseChange(nextPhase: AIChatBootstrapPhase) {
        guard nextPhase == .ready else {
            return
        }

        self.handleAIChatPresentationRequest(
            request: self.presentationRequestCoordinator.deferredPresentationRequest,
            source: .bootstrapReady
        )
    }

    func handleComposerPhaseChange(previousPhase: AIChatComposerPhase, nextPhase: AIChatComposerPhase) {
        if nextPhase == .idle && previousPhase != .idle {
            self.refreshAIUsage()
        }

        guard aiChatComposerPhaseAllowsDraftPreparation(nextPhase) else {
            return
        }

        if self.refocusesComposerAfterSend {
            self.refocusesComposerAfterSend = false
            if self.isPresentationActive {
                self.isComposerFocused = true
            }
        }
        self.handleAIChatPresentationRequest(
            request: self.presentationRequestCoordinator.deferredPresentationRequest,
            source: .composerPhaseReady
        )
    }

    func refreshAIUsage() {
        Task {
            await self.flashcardsStore.refreshAIUsage()
        }
    }

    func handleExternalProviderConsentChange(hasConsent: Bool) {
        guard hasConsent else {
            self.isCameraPresented = false
            self.isFileImporterPresented = false
            self.isPhotoPickerPresented = false
            self.selectedPhotoItem = nil
            self.dismissComposerFocus()
            self.syncChatSurface(refreshConsent: false)
            return
        }

        self.syncChatSurface(refreshConsent: false)
        self.handleAIChatPresentationRequest(
            request: self.presentationRequestCoordinator.deferredPresentationRequest,
            source: .externalProviderConsentGranted
        )
    }

    func handleScenePhaseChange(nextPhase: ScenePhase) {
        self.recordComposerPresentation(operation: .scene, isVisible: self.isPresentationActive)
        guard nextPhase == .active else {
            #if targetEnvironment(macCatalyst)
            if self.isPresentationActive && self.isComposerFocused {
                self.restoresMacComposerFocus = true
            }
            #endif
            self.syncChatSurface(refreshConsent: false)
            return
        }

        self.syncChatSurface(refreshConsent: true)
        #if targetEnvironment(macCatalyst)
        self.restoreMacComposerFocusIfReady()
        #endif
        self.handleAIChatPresentationRequest(
            request: self.presentationRequestCoordinator.deferredPresentationRequest,
            source: .sceneActive
        )
    }

    #if targetEnvironment(macCatalyst)
    private func restoreMacComposerFocusIfReady() {
        guard self.restoresMacComposerFocus,
              self.scenePhase == .active,
              self.isPresentationActive,
              self.composerTextFieldDisabled == false else { return }
        self.restoresMacComposerFocus = false
        self.isComposerFocused = true
    }
    #endif

    func handleSurfaceInputsChange() {
        self.syncChatSurface(refreshConsent: false)
        self.handleAIChatPresentationRequest(
            request: self.presentationRequestCoordinator.deferredPresentationRequest,
            source: .surfaceInputsChanged
        )
    }

    func handleChatVisibilityChange(isVisible: Bool) {
        self.recordComposerPresentation(operation: .presentation, isVisible: isVisible)
        guard isVisible else {
            #if targetEnvironment(macCatalyst)
            self.restoresMacComposerFocus = false
            #endif
            self.syncChatSurface(refreshConsent: false)
            return
        }

        self.handleQuotaRefusal(self.chatStore.quotaRefusal)
        self.syncChatSurface(refreshConsent: true)
        self.handleAIChatPresentationRequest(
            request: self.presentationRequestCoordinator.deferredPresentationRequest,
            source: .selectedAITab
        )
    }

    private func handleQuotaRefusal(_ refusal: AIChatQuotaRefusal?) {
        guard self.isPresentationActive,
              let refusal,
              self.chatStore.quotaRefusal?.id == refusal.id else { return }
        self.chatStore.quotaRefusal = nil
        guard refusal.userId == self.flashcardsStore.cloudSettings?.linkedUserId,
              refusal.cloudState == self.flashcardsStore.cloudSettings?.cloudState else { return }
        self.premiumPresenter.present(reason: .aiLimit, analyticsEntryPoint: .aiLimit, entitlement: self.flashcardsStore.cloudEntitlement, identity: try? self.flashcardsStore.appleSubscriptionIdentity())
    }

    func handleDictationStateViewChange(nextState: AIChatDictationState) {
        guard nextState == .idle else {
            return
        }

        self.handleAIChatPresentationRequest(
            request: self.presentationRequestCoordinator.deferredPresentationRequest,
            source: .dictationIdle
        )
    }

    func handleCompletedDictationTranscriptChange(
        nextTranscript: AIChatCompletedDictationTranscript?
    ) {
        guard let nextTranscript else {
            return
        }

        self.handleCompletedDictationTranscript(nextTranscript)
    }

    func handleSelectedPhotoItemChange(newItem: PhotosPickerItem?) {
        guard let newItem else {
            return
        }

        Task {
            await self.handleSelectedPhotoItem(newItem)
        }
    }

    func handleCameraCapture(data: Data) {
        self.isCameraPresented = false
        self.handleCapturedPhotoData(data)
    }

    /// The capture itself failed, so the camera half of the attachment pair ends here rather than in
    /// `handleCapturedPhotoData`. The picker raises errors of its own, which the mapping cannot tell
    /// apart, so these land on the catch-all reason.
    func handleCameraFailure(error: Error) {
        self.isCameraPresented = false
        Analytics.track(
            .mediaUploadFailed(reason: analyticsMediaUploadFailureReason(error: error)),
            screen: .ai
        )
        self.chatStore.showGeneralError(error: error)
    }

    /// Closing the camera without taking a photo reports nothing: no attachment was attempted, and
    /// the catalog's `cancelled` is a stopped upload rather than a picker somebody backed out of.
    func handleCameraCancel() {
        self.isCameraPresented = false
    }

    func handleFileImportResult(result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            Task {
                await self.handleImportedFiles(urls)
            }
        case .failure(let error):
            self.handleFileImportFailure(error)
        }
    }

}

#if targetEnvironment(macCatalyst)
let aiChatComposerControlSpacing: CGFloat = 8
let aiChatComposerTextVerticalPadding: CGFloat = 8
let aiChatComposerSuggestionHorizontalPadding: CGFloat = 0
let aiChatComposerSuggestionVerticalPadding: CGFloat = 0
#else
let aiChatComposerControlSpacing: CGFloat = 12
let aiChatComposerTextVerticalPadding: CGFloat = 12
let aiChatComposerSuggestionHorizontalPadding: CGFloat = 12
let aiChatComposerSuggestionVerticalPadding: CGFloat = 9
#endif

let aiChatComposerMaximumLineCount: Int = 5
let aiChatComposerTopPadding: CGFloat = 8
let aiChatComposerSendButtonInset: CGFloat = 8
let aiChatComposerSendButtonVisualSize: CGFloat = 28
let aiChatComposerSendButtonHitSize: CGFloat = appMinimumTouchTarget
let aiChatComposerSendButtonReservedTrailingPadding: CGFloat = aiChatComposerSendButtonHitSize
let aiChatComposerStatusLaneHeight: CGFloat = 24
let aiChatComposerStatusLaneSpacing: CGFloat = 8
let aiChatComposerDictationTextFieldTopPadding: CGFloat = 12 + aiChatComposerStatusLaneHeight + aiChatComposerStatusLaneSpacing
let aiChatMessageListHorizontalPadding: CGFloat = 16
let aiChatAutoScrollBottomThreshold: CGFloat = 12
let aiChatAutoScrollAnimationDurationSeconds: Double = 0.25
let aiChatBubbleMaximumWidth: CGFloat = 720
let aiChatTypingIndicatorDotCount: Int = 3
let aiChatTypingIndicatorAnimationStepSeconds: Double = 0.3
