import Foundation

struct AIChatPreSendSnapshot: Sendable {
    let persistedState: AIChatPersistedState
    let requiresRemoteSessionProvisioning: Bool
    let outgoingContent: [AIChatContentPart]
}

enum AIChatAcceptedEnvelopeReconciliation: Equatable, Sendable {
    case applyCanonicalEnvelope
    case preserveOptimisticMessages
    case reloadCanonicalConversation
}

extension AIChatStore {
    func warmUpSessionIfNeeded() {
        guard self.isChatInteractive else {
            return
        }
        guard self.activeNewSessionTask == nil else {
            return
        }
        guard self.composerPhase != .preparingSend && self.composerPhase != .startingRun else {
            return
        }
        guard self.flashcardsStore.cloudSettings?.cloudState == .linked else {
            return
        }
        guard self.hasExternalProviderConsent else {
            return
        }

        guard self.activeWarmUpTask == nil else {
            return
        }

        self.activeWarmUpTask = Task {
            defer {
                self.activeWarmUpTask = nil
            }
            await self.flashcardsStore.warmUpAuthenticatedCloudSessionForAI()
            self.resumeVisibleSessionIfNeeded()
        }
    }

    func sendMessage() {
        guard self.isChatInteractive else {
            return
        }
        if self.isComposerBusy || self.dictationState != .idle {
            return
        }

        let content = self.makeOutgoingContent()
        if content.isEmpty {
            return
        }

        guard self.hasExternalProviderConsent else {
            self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return
        }

        self.activeAlert = nil
        self.repairStatus = nil
        let preSendSnapshot = AIChatPreSendSnapshot(
            persistedState: self.currentPersistedState(),
            requiresRemoteSessionProvisioning: self.requiresRemoteSessionProvisioning,
            outgoingContent: content
        )
        let resolvedSessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId
        )
        self.chatSessionId = resolvedSessionId
        self.conversationScopeId = resolvedSessionId
        self.transitionToPreparingSend()
        let conversationId = UUID().uuidString.lowercased()
        let draftText = self.inputText
        let draftAttachments = self.pendingAttachments
        self.appendOptimisticOutgoingTurn(content: content)
        self.storePreSendSnapshot(preSendSnapshot, conversationId: conversationId)

        let task = Task {
            let didAppendOptimisticMessages = true
            defer {
                self.clearPreSendSnapshot(conversationId: conversationId)
                if self.activeConversationId == conversationId {
                    if self.shouldResetComposerPhaseAfterSendTaskCompletion() {
                        self.transitionToIdle()
                    }
                    self.activeConversationId = nil
                }
                self.activeSendTask = nil
            }

            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                try await self.ensureAIChatReadyForSend(linkedSession: session)
                let explicitSessionId = try await self.ensureRemoteSessionIfNeeded(session: session)
                self.resetRunToolCallTracking()
                self.transitionToStartingRun()
                self.activeConversationId = conversationId
                try await self.runtime.run(
                    session: session,
                    sessionId: explicitSessionId,
                    afterCursor: self.liveCursor,
                    outgoingContent: content,
                    eventHandler: { [weak self] event in
                        await self?.handleRuntimeEvent(event, conversationId: conversationId)
                    }
                )
            } catch is CancellationError {
            } catch {
                self.handleSendMessageError(
                    error,
                    didAcceptRun: self.composerPhase == .running,
                    didAppendOptimisticMessages: didAppendOptimisticMessages,
                    preSendSnapshot: preSendSnapshot,
                    draftText: draftText,
                    draftAttachments: draftAttachments
                )
            }
        }

        self.activeSendTask = task
    }

    func cancelStreaming() {
        self.activeSendTask?.cancel()
        self.activeSendTask = nil
        Task {
            await self.runtime.detach()
        }
        self.transitionToStopping(runId: self.activeRunId)
        self.repairStatus = nil
        self.clearOptimisticAssistantStatusIfNeeded()

        let sessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId
        )
        self.chatSessionId = sessionId
        self.conversationScopeId = sessionId
        guard sessionId.isEmpty == false else {
            self.transitionToIdle()
            self.schedulePersistCurrentState()
            return
        }

        Task {
            defer {
                if self.composerPhase == .stopping {
                    self.transitionToIdle()
                }
                self.schedulePersistCurrentState()
            }
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let stopResponse = try await self.chatService.stopRun(session: session, sessionId: sessionId)
                if stopResponse.stopped, stopResponse.stillRunning == false {
                    self.finalizeStoppedAssistantMessageIfNeeded()
                    self.activeStreamingMessageId = nil
                    self.activeStreamingItemId = nil
                    self.transitionToIdle()
                    self.repairStatus = nil
                }
            } catch {
                logAIChatStoreEvent(
                    action: "ai_stop_failed",
                    metadata: [
                        "chatSessionId": sessionId,
                        "error": Flashcards.errorMessage(error: error)
                    ]
                )
            }
        }
    }

    func appendOptimisticOutgoingTurn(content: [AIChatContentPart]) {
        let userMessage = AIChatMessage(
            id: UUID().uuidString.lowercased(),
            role: .user,
            content: content,
            timestamp: nowIsoTimestamp(),
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        self.messages.append(userMessage)
        let assistantMessage = AIChatMessage(
            id: UUID().uuidString.lowercased(),
            role: .assistant,
            content: [.text(aiChatOptimisticAssistantStatusText)],
            timestamp: nowIsoTimestamp(),
            isError: false,
            isStopped: false,
            cursor: nil,
            itemId: nil
        )
        self.messages.append(assistantMessage)
        self.setOptimisticOutgoingTurnState(
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessage.id
        )
        self.activeStreamingMessageId = assistantMessage.id
        self.activeStreamingItemId = nil
    }

    func shutdownForTests() {
        self.activeBootstrapTask?.cancel()
        self.activeBootstrapTask = nil
        self.activeWarmUpTask?.cancel()
        self.activeWarmUpTask = nil
        self.invalidatePendingNewSessionRequest()
        self.invalidatePendingRemoteSessionProvisionRequest()
        self.cancelStreaming()
        self.cancelDictation()
        self.clearAllPreSendSnapshots()
    }

    func ensureAIChatReadyForSend(linkedSession: CloudLinkedSession) async throws {
        guard self.bootstrapPhase == .ready else {
            throw LocalStoreError.validation("AI chat is still loading.")
        }
        guard let workspaceId = self.flashcardsStore.workspace?.workspaceId else {
            throw LocalStoreError.validation("Select a workspace before using AI chat.")
        }
        guard let database = self.flashcardsStore.database else {
            throw LocalStoreError.uninitialized("Local database is unavailable")
        }

        _ = try await self.flashcardsStore.runLinkedSync(linkedSession: linkedSession)
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: Int.max)
        if outboxEntries.isEmpty == false {
            throw LocalStoreError.validation("AI chat is blocked until all pending sync operations are uploaded.")
        }
    }

    func shouldResetComposerPhaseAfterSendTaskCompletion() -> Bool {
        if self.composerPhase == .idle || self.composerPhase == .stopping {
            return false
        }

        if self.composerPhase == .running {
            return false
        }

        if self.activeStreamingMessageId != nil || self.activeStreamingItemId != nil {
            return false
        }

        return true
    }

    func makeOutgoingContent() -> [AIChatContentPart] {
        var content: [AIChatContentPart] = self.pendingAttachments.compactMap { attachment in
            switch attachment.payload {
            case .binary(let fileName, let mediaType, let base64Data):
                if attachment.isImage {
                    return .image(mediaType: mediaType, base64Data: base64Data)
                }

                return .file(
                    fileName: fileName,
                    mediaType: mediaType,
                    base64Data: base64Data
                )
            case .card(let card):
                return .card(card)
            case .unknown:
                return nil
            }
        }

        let trimmedText = self.trimmedInputText()
        if trimmedText.isEmpty == false {
            content.append(.text(trimmedText))
        }

        return content
    }

    func handleSendMessageError(
        _ error: Error,
        didAcceptRun: Bool,
        didAppendOptimisticMessages: Bool,
        preSendSnapshot: AIChatPreSendSnapshot,
        draftText: String,
        draftAttachments: [AIChatAttachment]
    ) {
        self.repairStatus = nil
        self.transitionToIdle()
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil

        if didAcceptRun == false && didAppendOptimisticMessages {
            self.restorePreSendState(preSendSnapshot)
            self.applyComposerDraft(
                inputText: draftText,
                pendingAttachments: draftAttachments
            )
            self.schedulePersistCurrentState()
        }

        if didAcceptRun == false && isAIChatOfflineSendError(error: error) {
            self.showGeneralError(error: error)
            return
        }

        if
            didAcceptRun == false,
            let serviceError = error as? AIChatServiceError,
            case .invalidResponse(let errorDetails, _, _) = serviceError,
            errorDetails.code == "CHAT_ACTIVE_RUN_IN_PROGRESS"
        {
            self.showGeneralError(
                message: aiSettingsLocalized(
                    "ai.run.error.activeRunInProgress",
                    "A response is already in progress. Wait for it to finish or stop it before sending another message."
                )
            )
            return
        }

        if didAcceptRun == false {
            self.showGeneralError(error: error)
            return
        }

        self.showGeneralError(error: error)
    }

    func startLinkedBootstrap(
        forceReloadState: Bool,
        resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics?
    ) {
        self.activeBootstrapTask?.cancel()
        self.activeBootstrapTask = nil
        if forceReloadState {
            self.historyStore.activateWorkspace(workspaceId: self.historyWorkspaceId())
            self.restorePersistedState(self.historyStore.loadState())
        }
        let resolvedSessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId
        )
        self.chatSessionId = resolvedSessionId
        self.conversationScopeId = resolvedSessionId
        self.bootstrapPhase = .loading

        let bootstrapContext = self.surfaceState.activeAccessContext ?? self.currentAccessContext()
        self.activeBootstrapTask = Task {
            defer {
                self.activeBootstrapTask = nil
            }

            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let explicitSessionId = try await self.ensureRemoteSessionIfNeeded(session: session)
                let bootstrap = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: explicitSessionId,
                    limit: aiChatBootstrapPageLimit,
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics
                )
                guard self.surfaceState.activeAccessContext == bootstrapContext else {
                    return
                }
                self.applyBootstrap(bootstrap)
                self.bootstrapPhase = .ready
                self.attachBootstrapLiveIfNeeded(
                    response: bootstrap,
                    session: session,
                    resumeAttemptDiagnostics: resumeAttemptDiagnostics
                )
            } catch is CancellationError {
            } catch {
                if isAIChatRequestCancellationError(error: error) {
                    return
                }
                guard self.surfaceState.activeAccessContext == bootstrapContext else {
                    return
                }
                self.messages = []
                self.clearOptimisticOutgoingTurnState()
                let resolvedSessionId = aiChatResolvedSessionId(
                    workspaceId: self.historyWorkspaceId(),
                    sessionId: self.chatSessionId
                )
                self.chatSessionId = resolvedSessionId
                self.conversationScopeId = resolvedSessionId
                self.applyComposerDraft(inputText: "", pendingAttachments: [])
                self.schedulePersistCurrentDraftState()
                self.transitionToIdle()
                self.repairStatus = nil
                self.bootstrapPhase = .failed(Flashcards.errorMessage(error: error))
            }
        }
    }

    func handleRuntimeEvent(_ event: AIChatRuntimeEvent, conversationId: String) async {
        guard self.activeConversationId == conversationId else {
            return
        }

        switch event {
        case .accepted(let response):
            let reconciliation = self.acceptedEnvelopeReconciliation(
                for: response.envelope,
                conversationId: conversationId
            )

            if reconciliation == .preserveOptimisticMessages {
                self.applyAcceptedEnvelopeMetadata(response.envelope)
                self.markRunHadToolCallsFromSnapshot(
                    activeRun: response.activeRun,
                    messages: response.envelope.conversation.messages
                )
            } else if reconciliation == .reloadCanonicalConversation {
                self.reconcileStaleAcceptedTerminalEnvelope(response.envelope)
            } else {
                self.applyEnvelope(response.envelope)
                self.markRunHadToolCallsFromSnapshot(
                    activeRun: response.activeRun,
                    messages: response.envelope.conversation.messages
                )
            }
            self.applyComposerDraft(inputText: "", pendingAttachments: [])
            self.schedulePersistCurrentDraftState()
            self.repairStatus = nil
            if response.activeRun != nil {
                self.attachActiveLiveStreamIfPossible()
            } else if reconciliation == .reloadCanonicalConversation {
                self.clearPreSendSnapshot(conversationId: conversationId)
            } else {
                self.transitionToIdle()
                self.syncLinkedDataAfterTerminalRunIfNeeded()
                self.clearPreSendSnapshot(conversationId: conversationId)
            }
        case .liveEvent(let liveEvent):
            self.handleLiveEvent(liveEvent)
        case .appendAssistantAccountUpgradePrompt(let message, let buttonTitle):
            self.appendAssistantAccountUpgradePrompt(message: message, buttonTitle: buttonTitle)
        case .finish:
            self.repairStatus = nil
            self.clearOptimisticOutgoingTurnState()
            if self.activeConversationId == conversationId {
                self.transitionToIdle()
            }
        case .fail(let message):
            self.repairStatus = nil
            self.clearOptimisticOutgoingTurnState()
            self.showGeneralError(message: message)
            if self.activeConversationId == conversationId {
                self.transitionToIdle()
            }
        }
    }

    func acceptedEnvelopeReconciliation(
        for envelope: AIChatConversationEnvelope,
        conversationId: String
    ) -> AIChatAcceptedEnvelopeReconciliation {
        guard let optimisticTurn = self.currentOptimisticOutgoingTurn() else {
            return .applyCanonicalEnvelope
        }

        let acceptedEnvelopeContainsOutgoingTurn = self.acceptedEnvelopeContainsCurrentOutgoingTurn(
            envelope,
            conversationId: conversationId,
            optimisticTurn: optimisticTurn
        )

        if acceptedEnvelopeContainsOutgoingTurn {
            return .applyCanonicalEnvelope
        }

        if envelope.activeRun != nil {
            return .preserveOptimisticMessages
        }

        return .reloadCanonicalConversation
    }

    func currentOptimisticOutgoingTurn() -> AIChatOptimisticOutgoingTurn? {
        guard let optimisticOutgoingTurnState = self.optimisticOutgoingTurnState else {
            return nil
        }
        guard
            let assistantIndex = self.messages.lastIndex(where: { message in
                message.id == optimisticOutgoingTurnState.assistantMessageId
            }),
            assistantIndex > 0
        else {
            return nil
        }

        let assistantMessage = self.messages[assistantIndex]
        let userMessage = self.messages[assistantIndex - 1]
        guard assistantIndex == self.messages.count - 1 else {
            return nil
        }
        guard userMessage.id == optimisticOutgoingTurnState.userMessageId else {
            return nil
        }
        guard userMessage.role == .user else {
            return nil
        }
        guard assistantMessage.role == .assistant else {
            return nil
        }
        guard assistantMessage.isStopped == false else {
            return nil
        }
        guard assistantMessage.isError == false else {
            return nil
        }

        return AIChatOptimisticOutgoingTurn(
            userMessage: userMessage,
            assistantMessage: assistantMessage
        )
    }

    func applyAcceptedEnvelopeMetadata(_ envelope: AIChatConversationEnvelope) {
        self.chatSessionId = envelope.sessionId
        self.conversationScopeId = envelope.conversationScopeId
        self.requiresRemoteSessionProvisioning = false
        self.serverChatConfig = envelope.chatConfig
        self.applyComposerSuggestions(envelope.composerSuggestions)
        self.hasOlderMessages = envelope.conversation.hasOlder
        self.oldestCursor = envelope.conversation.oldestCursor
        self.repairStatus = nil

        guard let activeRun = envelope.activeRun else {
            self.finalizeAcceptedTerminalEnvelopeWhilePreservingOptimisticTurn()
            self.schedulePersistCurrentState()
            return
        }

        self.transitionToStreaming(
            activeRun: AIChatActiveRunSession(
                sessionId: envelope.sessionId,
                conversationScopeId: envelope.conversationScopeId,
                runId: activeRun.runId,
                liveStream: activeRun.live.stream,
                liveCursor: activeRun.live.cursor,
                streamEpoch: nil
            )
        )
        self.schedulePersistCurrentState()
    }

    func acceptedEnvelopeContainsCurrentOutgoingTurn(
        _ envelope: AIChatConversationEnvelope,
        conversationId: String,
        optimisticTurn: AIChatOptimisticOutgoingTurn
    ) -> Bool {
        if let preSendSnapshot = self.preSendSnapshot(conversationId: conversationId) {
            guard let baselineAnchorId = preSendSnapshot.persistedState.messages.last?.id else {
                return false
            }
            guard
                let anchorIndex = envelope.conversation.messages.lastIndex(where: { message in
                    message.id == baselineAnchorId
                })
            else {
                return false
            }

            let messagesAfterAnchor = envelope.conversation.messages.suffix(
                envelope.conversation.messages.count - anchorIndex - 1
            )
            return messagesAfterAnchor.contains { message in
                message.role == .user && message.content == preSendSnapshot.outgoingContent
            }
        }

        return envelope.conversation.messages.contains { message in
            message.role == .user && message.content == optimisticTurn.userMessage.content
        }
    }

    func reconcileStaleAcceptedTerminalEnvelope(_ envelope: AIChatConversationEnvelope) {
        self.chatSessionId = envelope.sessionId
        self.conversationScopeId = envelope.conversationScopeId
        self.requiresRemoteSessionProvisioning = false
        self.serverChatConfig = envelope.chatConfig
        self.applyComposerSuggestions(envelope.composerSuggestions)
        self.hasOlderMessages = envelope.conversation.hasOlder
        self.oldestCursor = envelope.conversation.oldestCursor
        self.repairStatus = nil
        self.transitionToIdle()
        self.activeStreamingItemId = nil
        self.reloadCanonicalConversationAfterAcceptedTerminalEnvelope()
    }

    func reloadCanonicalConversationAfterAcceptedTerminalEnvelope() {
        self.activeBootstrapTask?.cancel()
        self.activeBootstrapTask = Task {
            defer {
                self.activeBootstrapTask = nil
            }

            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                let requestedSessionId = try await self.ensureRemoteSessionIfNeeded(session: session)
                let response = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: requestedSessionId,
                    limit: aiChatBootstrapPageLimit,
                    resumeAttemptDiagnostics: nil
                )
                guard self.chatSessionId == requestedSessionId else {
                    return
                }
                self.applyBootstrap(response)
                self.attachBootstrapLiveIfNeeded(
                    response: response,
                    session: session,
                    resumeAttemptDiagnostics: nil
                )
            } catch is CancellationError {
            } catch {
                if isAIChatRequestCancellationError(error: error) {
                    return
                }
                self.finalizeAcceptedTerminalEnvelopeWhilePreservingOptimisticTurn()
                self.showGeneralError(error: error)
            }
        }
    }

    func finalizeAcceptedTerminalEnvelopeWhilePreservingOptimisticTurn() {
        self.transitionToIdle()
        self.activeStreamingItemId = nil

        guard
            let optimisticTurn = self.currentOptimisticOutgoingTurn(),
            self.messages.last?.id == optimisticTurn.assistantMessage.id
        else {
            self.activeStreamingMessageId = nil
            self.clearOptimisticOutgoingTurnState()
            return
        }

        self.messages.removeLast()
        self.activeStreamingMessageId = nil
        self.clearOptimisticOutgoingTurnState()
    }

    func restorePreSendState(_ preSendSnapshot: AIChatPreSendSnapshot) {
        let preSendState = preSendSnapshot.persistedState
        self.messages = preSendState.messages
        self.serverChatConfig = preSendState.lastKnownChatConfig ?? aiChatDefaultServerConfig
        self.requiresRemoteSessionProvisioning = preSendSnapshot.requiresRemoteSessionProvisioning
        self.runHadToolCalls = preSendState.pendingToolRunPostSync
        self.pendingToolRunPostSync = preSendState.pendingToolRunPostSync
        let resolvedSessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: preSendState.chatSessionId
        )
        self.chatSessionId = resolvedSessionId
        self.conversationScopeId = resolvedSessionId
        self.clearOptimisticOutgoingTurnState()
    }

    func applyEnvelope(_ envelope: AIChatConversationEnvelope) {
        self.messages = envelope.conversation.messages
        self.chatSessionId = envelope.sessionId
        self.conversationScopeId = envelope.conversationScopeId
        self.requiresRemoteSessionProvisioning = false
        self.serverChatConfig = envelope.chatConfig
        self.applyComposerSuggestions(envelope.composerSuggestions)
        self.hasOlderMessages = envelope.conversation.hasOlder
        self.oldestCursor = envelope.conversation.oldestCursor
        self.repairStatus = nil
        self.clearOptimisticOutgoingTurnState()

        if let activeRun = envelope.activeRun {
            self.transitionToStreaming(
                activeRun: AIChatActiveRunSession(
                    sessionId: envelope.sessionId,
                    conversationScopeId: envelope.conversationScopeId,
                    runId: activeRun.runId,
                    liveStream: activeRun.live.stream,
                    liveCursor: activeRun.live.cursor,
                    streamEpoch: nil
                )
            )
        } else {
            self.transitionToIdle()
        }

        if envelope.activeRun != nil,
           let lastAssistantMessage = envelope.conversation.messages.last(where: { $0.role == .assistant })
        {
            self.activeStreamingMessageId = lastAssistantMessage.id
            self.activeStreamingItemId = lastAssistantMessage.itemId
        } else {
            self.activeStreamingMessageId = nil
            self.activeStreamingItemId = nil
        }

        self.schedulePersistCurrentState()
    }

    func storePreSendSnapshot(_ snapshot: AIChatPreSendSnapshot, conversationId: String) {
        self.storedPreSendSnapshotConversationId = conversationId
        self.storedPreSendSnapshot = snapshot
    }

    func preSendSnapshot(conversationId: String) -> AIChatPreSendSnapshot? {
        guard self.storedPreSendSnapshotConversationId == conversationId else {
            return nil
        }

        return self.storedPreSendSnapshot
    }

    func clearPreSendSnapshot(conversationId: String) {
        guard self.storedPreSendSnapshotConversationId == conversationId else {
            return
        }

        self.storedPreSendSnapshotConversationId = nil
        self.storedPreSendSnapshot = nil
    }

    func clearAllPreSendSnapshots() {
        self.storedPreSendSnapshotConversationId = nil
        self.storedPreSendSnapshot = nil
    }

    /// The accepted run response only confirms that the backend started or
    /// completed the run. Tool-backed changes are synced only after the run is
    /// terminal so the local review state refreshes once from the final data.
    func syncLinkedDataAfterTerminalRunIfNeeded() {
        guard self.hasPendingToolRunPostSync() else {
            return
        }
        guard self.activeToolRunPostSyncTask == nil else {
            return
        }

        let origin = self.currentToolRunPostSyncOrigin()
        let postSyncTask = Task { @MainActor in
            defer {
                self.activeToolRunPostSyncTask = nil
            }

            do {
                guard self.hasPendingToolRunPostSync(origin: origin) else {
                    return
                }
                let session = try await self.flashcardsStore.cloudSessionForAI()
                guard self.hasPendingToolRunPostSync(origin: origin) else {
                    return
                }

                _ = try await self.flashcardsStore.runLinkedSync(linkedSession: session)
                await self.completeToolRunPostSyncAfterSuccess(origin: origin)
            } catch {
                if self.isCurrentToolRunPostSyncOrigin(origin) && self.pendingToolRunPostSync {
                    self.schedulePersistCurrentState()
                    await self.waitForPendingStatePersistence()
                }
                self.flashcardsStore.globalErrorMessage = Flashcards.errorMessage(error: error)
            }
        }

        self.activeToolRunPostSyncTask = postSyncTask
    }
}

struct AIChatOptimisticOutgoingTurn {
    let userMessage: AIChatMessage
    let assistantMessage: AIChatMessage
}

func restoredAIChatOptimisticOutgoingTurnState(
    messages: [AIChatMessage]
) -> AIChatOptimisticOutgoingTurnState? {
    guard messages.count >= 2 else {
        return nil
    }

    let assistantMessage = messages[messages.count - 1]
    let userMessage = messages[messages.count - 2]
    guard userMessage.role == .user else {
        return nil
    }
    guard userMessage.cursor == nil else {
        return nil
    }
    guard userMessage.itemId == nil else {
        return nil
    }
    guard userMessage.isError == false else {
        return nil
    }
    guard userMessage.isStopped == false else {
        return nil
    }
    guard assistantMessage.role == .assistant else {
        return nil
    }
    guard isOptimisticAIChatStatusContent(content: assistantMessage.content) else {
        return nil
    }
    guard assistantMessage.isError == false else {
        return nil
    }
    guard assistantMessage.isStopped == false else {
        return nil
    }

    return AIChatOptimisticOutgoingTurnState(
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id
    )
}

extension AIChatStore {
    func setOptimisticOutgoingTurnState(
        userMessageId: String,
        assistantMessageId: String
    ) {
        self.optimisticOutgoingTurnState = AIChatOptimisticOutgoingTurnState(
            userMessageId: userMessageId,
            assistantMessageId: assistantMessageId
        )
    }

    func clearOptimisticOutgoingTurnState() {
        self.optimisticOutgoingTurnState = nil
    }

    func isOptimisticAssistantPlaceholder(messageId: String) -> Bool {
        self.optimisticOutgoingTurnState?.assistantMessageId == messageId
    }

    @discardableResult
    func consumeOptimisticAssistantPlaceholder(messageId: String) -> Bool {
        guard self.isOptimisticAssistantPlaceholder(messageId: messageId) else {
            return false
        }

        self.clearOptimisticOutgoingTurnState()
        return true
    }
}

func isAIChatRequestCancellationError(error: Error) -> Bool {
    if error is CancellationError {
        return true
    }

    if let urlError = error as? URLError {
        return urlError.code == .cancelled
    }

    let nsError = error as NSError
    if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
        return true
    }

    guard let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? Error else {
        return false
    }

    return isAIChatRequestCancellationError(error: underlyingError)
}

private func isAIChatOfflineSendError(error: Error) -> Bool {
    if let urlError = error as? URLError {
        return urlError.code == .notConnectedToInternet
    }

    let nsError = error as NSError
    if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorNotConnectedToInternet {
        return true
    }

    guard let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] as? Error else {
        return false
    }

    return isAIChatOfflineSendError(error: underlyingError)
}
