import AVFoundation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct AIChatView: View {
    #if targetEnvironment(macCatalyst)
    @Environment(\.macWindowPresentation) private var macWindowPresentation
    #else
    @Environment(AICompanionComposerHost.self) var companionComposerHost
    #endif
    @Environment(FlashcardsStore.self) var flashcardsStore: FlashcardsStore
    @Environment(PremiumPresenter.self) var premiumPresenter: PremiumPresenter
    @Environment(AppNavigationModel.self) var navigation: AppNavigationModel
    @Environment(\.scenePhase) var scenePhase
    @Environment(\.tabBarPlacement) var tabBarPlacement
    @Environment(\.isKeyboardDocked) private var isKeyboardDocked
    @Environment(\.dynamicTypeSize) var dynamicTypeSize
    @Environment(\.aiCompanionPageIsTop) private var companionPageIsTop
    let chatStore: AIChatStore
    let isCompanion: Bool
    let companionHostTab: AppTab?

    var isPresentationActive: Bool {
        self.allowsCatalogAIPresentation && self.navigation.isLiveAIChatVisible && (
            self.isCompanion
                ? self.navigation.selectedTab == self.companionHostTab && self.companionPageIsTop
                : self.navigation.selectedTab == .ai
        )
    }
    @State var isCameraPresented: Bool
    @State var isFileImporterPresented: Bool
    @State var isPhotoPickerPresented: Bool
    @State var selectedPhotoItem: PhotosPickerItem?
    @State var isDropTargeted: Bool
    @State var isComposerDropHovering: Bool
    @State var isAutoFollowEnabled: Bool
    @State var hasActiveUserScrollGesture: Bool
    @State var transcriptLayout: AIChatScrollRowLayout = AIChatScrollRowLayout()
    @State var transcriptRestore: AIChatScrollAnchor? = nil
    @State var composerWindowScene: AIChatComposerWindowScene = AIChatComposerWindowScene()
    /// The transcript a chat off screen keeps showing. Every section mounts its own side chat beside the AI tab's, so
    /// without this each one would diff and lay out every streamed token.
    @State var frozenTranscriptMessages: [AIChatMessage]? = nil
    @State var composerAttachmentViewportWidth: CGFloat?
    @State private var presentationRequestCoordinator: AIChatPresentationRequestCoordinator
    @State var isComposerFocused: Bool
    #if targetEnvironment(macCatalyst)
    @State var macComposerReturnKeyOwner = MacComposerReturnKeyOwner()
    @State var macCatalogComposerFocusRequest: MacCatalogComposerFocusRequest?
    @State private var restoresMacComposerFocus = false
    #else
    @State var tabComposerShellWidth = AIChatComposerShellWidth()
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
                selection: Binding(
                    get: { self.selectedPhotoItem },
                    set: { item in
                        guard self.selectedPhotoItem != item else { return }
                        self.selectedPhotoItem = item
                        if let item {
                            let started = self.loadAttachmentTransfer { scope in
                                await self.handleSelectedPhotoItem(item, scope: scope)
                            }
                            if started == false {
                                self.selectedPhotoItem = nil
                            }
                        }
                    }
                ),
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
                #if targetEnvironment(macCatalyst)
                self.macCatalogComposerFocusRequest = nil
                #endif
                self.recordComposerPresentation(operation: .presentation, isVisible: false)
            }
            .onChange(of: self.isComposerFocused) { _, isFocused in
                #if targetEnvironment(macCatalyst)
                if isFocused == false {
                    self.macCatalogComposerFocusRequest = nil
                }
                #endif
                self.recordComposerPresentation(operation: .focus, isVisible: self.isPresentationActive)
                self.recordComposerFocusOwner(isFocused: isFocused)
            }
            .onChange(of: self.chatStore.quotaRefusal, initial: true) { _, refusal in
                self.handleQuotaRefusal(refusal)
            }
            .onChange(of: self.navigation.aiChatPresentationRequest) { _, request in
                self.handlePresentationRequestChange(request: request)
            }
            .onChange(of: self.catalogDraftBlocker) { _, blocker in
                if blocker == nil, self.isPresentationActive,
                   let request = self.pendingCatalogDraftRequest {
                    self.handleAIChatPresentationRequest(request: request, source: .catalogDraftReady)
                }
            }
            .onChange(of: self.readyAIImportRequestID, initial: true) { _, requestID in
                self.handleAIImportRequest(id: requestID)
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
    }

    @ViewBuilder
    var bodyBaseModifiers: some View {
        if self.isCompanion {
            #if targetEnvironment(macCatalyst)
            if UIDevice.current.userInterfaceIdiom == .pad {
                self.companionBody
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if self.usesCompactCompanionToolbar == false {
                            self.companionHeader
                                .frame(maxWidth: .infinity)
                                .background(.bar)
                        }
                    }
            } else {
                self.companionBody
                    .nativeTopBar(alignment: .center) {
                        self.companionHeader
                    }
            }
            #else
            AICompanionPane(hostTab: self.companionHostTab) {
                self.companionPaneToolbar
            } liveChat: {
                self.companionBody
            }
            #endif
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
            identifier: UITestIdentifier.aiHistoryButton, symbol: self.historySymbol,
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
            #if targetEnvironment(macCatalyst)
            .overlay(alignment: .trailing) {
                HStack(spacing: 0) { Divider() }
                    .frame(width: 1)
                    .ignoresSafeArea(.container, edges: .bottom)
            }
            #endif
    }

    var bodyCommonModifiers: some View {
        let showsBarBackground = self.composerBarShowsBackground
        return self.bodyContent
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityIdentifier(UITestIdentifier.aiScreen)
            .nativeBottomBar(
                alignment: .center,
                usesColumnLayout: UIDevice.current.userInterfaceIdiom == .pad && showsBarBackground,
                showsBackground: showsBarBackground
            ) {
                self.bottomBarContent
                    #if !targetEnvironment(macCatalyst)
                    .background {
                        AIChatOutsideTapObserver(
                            isEnabled: self.isCompanion && self.isPresentationActive && self.isComposerFocused,
                            onDismiss: self.dismissComposerFocus
                        )
                    }
                    #endif
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

    /// The Liquid Glass composer floats with nothing behind it; the iOS 18 and Mac fields are not glass and keep the bar.
    var composerBarShowsBackground: Bool {
        #if targetEnvironment(macCatalyst)
        return true
        #else
        if #available(iOS 26.0, *) {
            return false
        }
        return true
        #endif
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
            if self.isPresentationActive, let request = self.pendingCatalogDraftRequest {
                self.pendingCatalogDraftBanner(request: request)
            } else if self.isPresentationActive, self.accessState == .ready, self.chatStore.isChatInteractive,
                      self.chatStore.isLiveReconciliationPending, self.chatStore.activeBootstrapTask == nil {
                HStack {
                    Text(aiSettingsLocalized("ai.failed.title", "Chat unavailable"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                    self.retryLiveReconciliationButton
                }
                .padding(.horizontal, self.chatContentHorizontalPadding)
                .padding(.vertical, 8)
            }
            switch self.accessState {
            case .consentRequired:
                if self.allowsCatalogAIPresentation {
                    self.consentGate
                }
            case .ready:
                if self.isPresentationActive && self.navigation.aiImportRequest != nil {
                    HStack {
                        ProgressView(aiImportWaitingMessage())
                        Spacer()
                        Button(aiSettingsLocalized("common.cancel", "Cancel"), action: self.navigation.cancelAIImport)
                    }
                    .padding(.horizontal, self.chatContentHorizontalPadding)
                    .padding(.vertical, 8)
                }
                self.chatContent
            }
        }
    }

    private var pendingCatalogDraftRequest: AIChatPresentationRequest? {
        let request = self.scenePresentationRequest
        guard case .createCatalogDeck = request else { return nil }
        return request
    }

    private var catalogDraftBlocker: AIChatCatalogDraftBlocker? {
        guard self.isPresentationActive, self.pendingCatalogDraftRequest != nil else { return nil }
        return self.chatStore.catalogDraftBlocker
    }

    private func pendingCatalogDraftBanner(request: AIChatPresentationRequest) -> some View {
        HStack {
            Text(self.pendingCatalogDraftStatus)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            if self.catalogDraftBlocker == .retryLiveReconciliation {
                self.retryLiveReconciliationButton
            } else if self.catalogDraftBlocker == .retryRunSync {
                Button(aiSettingsLocalized("common.retry", "Retry"), action: self.chatStore.syncLinkedDataAfterTerminalRunIfNeeded)
            }
            Button(aiSettingsLocalized("common.cancel", "Cancel")) {
                self.navigation.clearAIChatPresentationRequest(request: request)
            }
            .accessibilityIdentifier(UITestIdentifier.aiCatalogDraftCancelButton)
        }
        .padding(.horizontal, self.chatContentHorizontalPadding)
        .padding(.vertical, 8)
    }

    private var retryLiveReconciliationButton: some View {
        Button(aiSettingsLocalized("common.retry", "Retry"), action: self.chatStore.retryLiveConversationReconciliation)
    }

    private var pendingCatalogDraftStatus: String {
        switch self.catalogDraftBlocker {
        case .consent:
            return aiSettingsLocalized("ai.consent.dataSharingTitle", "AI data sharing")
        case .loadingChat, nil:
            return aiSettingsLocalized("ai.loading.title", "Loading chat")
        case .chatUnavailable, .retryLiveReconciliation:
            return aiSettingsLocalized("ai.failed.title", "Chat unavailable")
        case .run:
            return aiSettingsLocalized("ai.message.reasoning.thinking", "Thinking...")
        case .syncingRun:
            return aiSettingsLocalized("settings.sync.syncing", "Syncing")
        case .retryRunSync:
            return aiSettingsLocalized("settings.sync.failed.generic", "Sync failed")
        case .attachmentTransfer:
            return String(localized: "catalog.list.ai_deck.loading_attachment", table: "Foundation")
        case .dictation:
            return self.dictationStatusText
        case .draft:
            return String(localized: "catalog.list.ai_deck.pending", table: "Foundation")
        }
    }

    var isNewChatDisabled: Bool {
        self.chatStore.canStartNewChat == false
            || (self.navigation.pendingCatalogAIDeckRequest != nil
                && (self.chatStore.hasUnsettledRun || self.chatStore.activeBootstrapTask != nil
                    || self.chatStore.activeAttachmentTransferCount > 0))
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
                #if targetEnvironment(macCatalyst)
                guard self.isPresentationActive else { return }
                #else
                guard self.isPresentationActive || (self.isCompanion && self.companionComposerHost.isFocused) else { return }
                #endif
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
                self.newChatToolbarButton.tint(Color.primary)
            }
        }
    }
    #endif

    var historyToolbarButton: some View {
        self.historyButton(usesToolbarIconLabel: false)
    }

    /// History reads past chats without continuing them, so iOS shows a past-time symbol rather than a list of equal
    /// chats to move between; the Mac keeps its list symbol.
    var historySymbol: String {
        #if targetEnvironment(macCatalyst)
        "list.bullet"
        #else
        "clock.arrow.circlepath"
        #endif
    }

    @ViewBuilder
    func historyButton(usesToolbarIconLabel: Bool) -> some View {
        Button(action: self.openChatHistory) {
            if usesToolbarIconLabel {
                Image(systemName: self.historySymbol)
                    .nativeToolbarIconLabel()
            } else {
                Image(systemName: self.historySymbol)
            }
        }
        .accessibilityLabel(aiSettingsLocalized("ai.history.button", "History"))
        .accessibilityIdentifier(UITestIdentifier.aiHistoryButton)
        .disabled(self.chatStore.dictationState != .idle)
    }

    private func openChatHistory() {
        self.dismissComposerFocus()
        self.chatStore.cancelDictation()
        let route = AIChatHistoryListRoute(model: AIChatHistoryListModel(chatStore: self.chatStore))
        #if !targetEnvironment(macCatalyst)
        // The side chat's history opens inside its pane, beside the section.
        if self.isCompanion {
            self.navigation.aiCompanionPath.append(.history(route))
            return
        }
        #endif
        if self.isCompanion { self.navigation.selectTab(.ai) }
        self.navigation.aiPath.append(route)
    }

    var newChatToolbarButton: some View {
        Button(action: self.startNewChat) {
            Label(aiSettingsLocalized("ai.newChat", "New"), systemImage: "square.and.pencil")
        }
        .accessibilityIdentifier(UITestIdentifier.aiNewChatButton)
        .disabled(self.isNewChatDisabled || self.chatStore.isChatInteractive == false)
    }

    var consentGate: some View {
        AIConsentDisclosureView(
            canChangeConsent: { self.allowsCatalogAIPresentation },
            onAllowed: self.acceptExternalAIConsent,
            onNotNow: self.leaveAIAfterDecliningConsent
        )
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
        } actions: {
            if self.chatStore.currentCustomInstructionsScope != nil {
                self.customInstructionsButton
            }
        }
        .padding(.horizontal, self.chatContentHorizontalPadding)
    }

    var customInstructionsButton: some View {
        Button(action: self.openCustomInstructions) {
            if let text = self.chatStore.currentCustomInstructionsReading?.text {
                VStack(spacing: 2) {
                    Text(aiChatCustomInstructionsTitle())
                    Text(text.split(whereSeparator: \.isNewline).joined(separator: " "))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: 280)
            } else {
                Label(aiSettingsLocalized("ai.customInstructions.add", "Add custom instructions"), systemImage: "plus")
            }
        }
        .buttonStyle(.bordered)
        // Neutral instead of the accent, so it stays secondary to the composer and its preview stays readable.
        .tint(.primary)
    }

    private func openCustomInstructions() {
        guard self.chatStore.currentCustomInstructionsScope != nil else { return }
        self.dismissComposerFocus()
        if self.isCompanion { self.navigation.selectTab(.ai) }
        self.navigation.aiPath.append(AIChatCustomInstructionsRoute())
    }

    func acceptExternalAIConsent() {
        self.syncChatSurface(refreshConsent: false)
        self.handleAIChatPresentationRequest(
            request: self.navigation.aiChatPresentationRequest,
            source: .acceptedExternalAIConsent
        )
    }

    func leaveAIAfterDecliningConsent() {
        guard self.allowsCatalogAIPresentation else { return }
        let isCatalogRequest = self.navigation.pendingCatalogAIDeckRequest != nil
        let returnsToLibrary = self.navigation.aiImportRequest != nil || isCatalogRequest
        self.navigation.cancelAIImport()
        self.presentationRequestCoordinator.clearDeferredPresentationRequest()
        if let request = self.scenePresentationRequest {
            self.navigation.clearAIChatPresentationRequest(request: request)
        }
        #if targetEnvironment(macCatalyst)
        if isCatalogRequest == false {
            self.navigation.isAICompanionPresented = false
        }
        #else
        self.navigation.isAICompanionPresented = false
        #endif
        if self.navigation.selectedTab == .ai {
            self.navigation.selectTab(returnsToLibrary ? .library : .review)
        }
    }

    func refreshExternalAIConsentState() {
        self.chatStore.refreshExternalProviderConsentState()
        self.syncChatSurface(refreshConsent: false)
    }

    func syncChatSurface(refreshConsent: Bool) {
        guard self.allowsCatalogAIPresentation else { return }
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

    private var readyAIImportRequestID: UUID? {
        // The import waits until its chat is back on top of its stack. The path is read only while a request waits,
        // so pushing a page never re-renders the chat beneath it.
        guard self.isPresentationActive, self.scenePhase == .active,
              let request = self.navigation.aiImportRequest,
              self.isCompanion ? self.navigation.aiCompanionPath.isEmpty : self.navigation.aiPath.isEmpty else {
            return nil
        }

        if self.matchesCurrentAccessContext(request.accessContext) == false {
            return request.id
        }

        guard self.chatStore.hasExternalProviderConsent,
              self.chatStore.isChatInteractive,
              self.chatStore.composerPhase == .idle,
              self.chatStore.isLiveReconciliationPending == false,
              self.chatStore.activeAttachmentTransferCount == 0,
              self.chatStore.dictationState == .idle else {
            return nil
        }
        return request.id
    }

    private func handleAIImportRequest(id: UUID?) {
        guard let id, id == self.readyAIImportRequestID else {
            return
        }

        self.syncChatSurface(refreshConsent: true)
        guard id == self.readyAIImportRequestID,
              let request = self.navigation.takeAIImportRequest() else {
            return
        }
        guard self.matchesCurrentAccessContext(request.accessContext) else {
            aiChatRemoveAttachmentFiles(attachments: request.attachments)
            self.chatStore.showGeneralError(message: aiImportWorkspaceChangedMessage())
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
        self.chatStore.startAIImport(attachments: request.attachments, requestText: request.requestText)
    }

    private func matchesCurrentAccessContext(_ accessContext: AIChatAccessContext) -> Bool {
        accessContext.matches(
            current: self.chatStore.currentAccessContext(),
            preservedGuestLink: self.flashcardsStore.preservedGuestWorkspaceLink
        )
    }

    private var allowsCatalogAIPresentation: Bool {
        #if targetEnvironment(macCatalyst)
        self.navigation.allowsCatalogAIPresentation(in: self.macWindowPresentation?.sceneID)
        #else
        true
        #endif
    }

    private var scenePresentationRequest: AIChatPresentationRequest? {
        guard self.allowsCatalogAIPresentation else { return nil }
        let request = self.navigation.aiChatPresentationRequest
        if case .createCatalogDeck(let catalogRequest) = request,
           catalogRequest.accessContext.matches(
               current: self.chatStore.currentCatalogDeckAccessContext(),
               preservedGuestLink: self.flashcardsStore.preservedGuestWorkspaceLink
           ) == false {
            return nil
        }
        return request
    }

    private var presentationRequestContext: AIChatPresentationRequestContext {
        let request = self.scenePresentationRequest
        var isActive = self.isPresentationActive
        #if targetEnvironment(macCatalyst)
        if case .createCatalogDeck(let catalogRequest) = request, catalogRequest.sceneID != nil {
            isActive = isActive && self.scenePhase == .active
        }
        #endif
        return AIChatPresentationRequestContext(
            isPresentationActive: isActive,
            navigationRequest: request,
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
            request: request == self.scenePresentationRequest ? request : nil,
            source: source,
            context: self.presentationRequestContext
        )
    }

    private func handleAIChatPresentationRequest(
        request: AIChatPresentationRequest?,
        source: AIChatPresentationLifecycleSource
    ) {
        self.navigation.retireStaleCatalogAIDeckRequest(
            accessContext: self.chatStore.currentCatalogDeckAccessContext(),
            preservedGuestLink: self.flashcardsStore.preservedGuestWorkspaceLink
        )
        guard self.navigation.aiImportRequest == nil else {
            self.presentationRequestCoordinator.clearDeferredPresentationRequest()
            return
        }
        self.retireStaleDeferredPresentationRequest()

        guard let completedRequest = self.presentationRequestCoordinator.handle(
            request: request == self.scenePresentationRequest ? request : nil,
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
            if case .createCatalogDeck = completedRequest {
                #if targetEnvironment(macCatalyst)
                if case .createCatalogDeck(let catalogRequest) = completedRequest, let sceneID = catalogRequest.sceneID {
                    self.macCatalogComposerFocusRequest = MacCatalogComposerFocusRequest(id: catalogRequest.id, sceneID: sceneID)
                }
                #endif
                let end = self.chatStore.inputText.endIndex
                self.composerSelection = TextSelection(range: end..<end)
            }
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
        self.macCatalogComposerFocusRequest = nil
        self.restoresMacComposerFocus = false
        #endif
        self.chatStore.editorDiagnosticPresentation = self.composerDiagnosticPresentation
        self.chatStore.recordComposerEditing(operation: .focus, phase: .before, beforeUTF16Count: self.chatStore.inputText.utf16.count, afterUTF16Count: self.chatStore.inputText.utf16.count)
        if let sceneIdentifier = self.composerWindowScene.identifier {
            self.chatStore.focusedComposerHosts[sceneIdentifier] = nil
        }
        self.isComposerFocused = false
        self.chatStore.editorDiagnosticPresentation = self.composerDiagnosticPresentation
        self.composerSelection = nil
        AIChatComposerUITextView.resignDeliberately {
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder),
                to: nil,
                from: nil,
                for: nil
            )
        }
        #if !targetEnvironment(macCatalyst)
        AIChatComposerUITextView.releaseOrphanedKeyboard()
        #endif
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
        self.navigation.popAIToLiveChat()
    }

    var composerHost: AIChatComposerHost {
        AIChatComposerHost(
            tab: self.isCompanion ? self.companionHostTab ?? self.navigation.selectedTab : .ai,
            isCompanion: self.isCompanion
        )
    }

    /// A chat that loses its keyboard on screen was dismissed on purpose: the swipe, the dismiss key or a tap
    /// elsewhere. One that loses it by leaving the screen keeps the ownership, so the next chat takes the keyboard.
    private func recordComposerFocusOwner(isFocused: Bool) {
        guard self.isPresentationActive, let sceneIdentifier = self.composerWindowScene.identifier else { return }
        if isFocused {
            self.chatStore.focusedComposerHosts[sceneIdentifier] = self.composerHost
        } else if self.chatStore.focusedComposerHosts[sceneIdentifier] == self.composerHost {
            self.chatStore.focusedComposerHosts[sceneIdentifier] = nil
        }
    }

    /// Read by the field as it enters a window, before this view's own activation runs.
    func takesComposerKeyboardOnArrival(windowScene: UIWindowScene?) -> Bool {
        #if targetEnvironment(macCatalyst)
        return false
        #else
        guard self.isPresentationActive, let sceneIdentifier = windowScene?.session.persistentIdentifier else {
            return false
        }
        return self.chatStore.focusedComposerHosts[sceneIdentifier] != nil
        #endif
    }

    /// The chat coming on screen takes the keyboard that another section's chat in the same window held.
    private func takeComposerFocusFromPreviousChat() {
        #if !targetEnvironment(macCatalyst)
        guard self.isPresentationActive,
              let sceneIdentifier = self.composerWindowScene.identifier,
              self.chatStore.focusedComposerHosts[sceneIdentifier] != nil,
              self.isComposerFocused == false else { return }
        self.isComposerFocused = true
        #endif
    }

    func handleViewAppear() {
        self.recordComposerPresentation(operation: .presentation, isVisible: self.isPresentationActive)
        // A chat that mounts off screen, such as a hidden section's side chat, starts with its transcript frozen too.
        if self.isPresentationActive == false, self.frozenTranscriptMessages == nil {
            self.frozenTranscriptMessages = self.chatStore.messages
        }
        self.takeComposerFocusFromPreviousChat()
        self.handleQuotaRefusal(self.chatStore.quotaRefusal)
        let refreshes = self.chatStore.claimViewAppearRefresh(now: Date())
        self.syncChatSurface(refreshConsent: refreshes)
        if refreshes {
            self.refreshAIUsage()
        }
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

    /// The navigation request is the one request. Each section's chat keeps its own deferred copy, so a copy that no
    /// longer matches was applied by another chat or replaced, and must never replay.
    private func retireStaleDeferredPresentationRequest() {
        guard let deferredRequest = self.presentationRequestCoordinator.deferredPresentationRequest,
              deferredRequest != self.scenePresentationRequest else { return }
        self.presentationRequestCoordinator.clearDeferredPresentationRequest()
    }

    func handlePresentationRequestChange(request: AIChatPresentationRequest?) {
        self.retireStaleDeferredPresentationRequest()
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
        self.chatStore.refreshAIUsage()
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
            self.macCatalogComposerFocusRequest = nil
            self.restoresMacComposerFocus = false
            #endif
            self.frozenTranscriptMessages = self.chatStore.messages
            #if !targetEnvironment(macCatalyst)
            if self.navigation.isLiveAIChatVisible == false {
                AIChatComposerUITextView.releaseKeyboard(in: self.composerWindowScene.scene)
            }
            #endif
            self.syncChatSurface(refreshConsent: false)
            return
        }

        self.frozenTranscriptMessages = nil

        self.takeComposerFocusFromPreviousChat()

        self.handleQuotaRefusal(self.chatStore.quotaRefusal)
        self.syncChatSurface(refreshConsent: self.chatStore.claimViewAppearRefresh(now: Date()))
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
            self.handleImportedFiles(urls)
        case .failure(let error):
            self.handleFileImportFailure(error)
        }
    }

}

#if targetEnvironment(macCatalyst)
let aiChatComposerControlSpacing: CGFloat = 8
let aiChatComposerTextVerticalPadding: CGFloat = 8
let aiChatComposerSendButtonInset: CGFloat = 8
let aiChatComposerSendButtonHitSize: CGFloat = appMinimumTouchTarget
let aiChatComposerSendButtonReservedTrailingPadding: CGFloat = aiChatComposerSendButtonHitSize
#else
let aiChatComposerControlSpacing: CGFloat = 12
let aiChatComposerControlSize: CGFloat = appMinimumTouchTarget
let aiChatComposerShellHorizontalInset: CGFloat = 4
let aiChatComposerShellVerticalInset: CGFloat = 2
let aiChatComposerCompactTextHorizontalPadding: CGFloat = 4
/// Aligns expanded text with the leading edge of the attachment symbol.
let aiChatComposerExpandedTextHorizontalPadding: CGFloat = 12
let aiChatComposerExpandedTextTopPadding: CGFloat = 12
/// The draft expands slightly before it touches the single-row controls.
let aiChatComposerExpansionMargin: CGFloat = 8
/// The draft's lines never take more of the window height than this.
let aiChatComposerMaximumWindowHeightFraction: CGFloat = 0.2
#endif

let aiChatComposerMaximumLineCount: Int = 5
let aiChatComposerTopPadding: CGFloat = 8
let aiChatComposerSendButtonVisualSize: CGFloat = 28
let aiChatMessageListHorizontalPadding: CGFloat = 16
let aiChatAutoScrollBottomThreshold: CGFloat = 12
let aiChatAutoScrollAnimationDurationSeconds: Double = 0.25
let aiChatBubbleMaximumWidth: CGFloat = 720
let aiChatTypingIndicatorDotCount: Int = 3
let aiChatTypingIndicatorAnimationStepSeconds: Double = 0.3
