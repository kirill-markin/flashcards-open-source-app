import Foundation

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

        let task = Task {
            var didAppendOptimisticMessages = false
            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                try await self.ensureAIChatReadyForSend(linkedSession: session)
                self.messages.append(
                    AIChatMessage(
                        id: UUID().uuidString.lowercased(),
                        role: .user,
                        content: content,
                        timestamp: nowIsoTimestamp(),
                        isError: false,
                        isStopped: false,
                        cursor: nil,
                        itemId: nil
                    )
                )
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
                self.activeStreamingMessageId = assistantMessage.id
                self.activeStreamingItemId = nil
                didAppendOptimisticMessages = true
                self.transitionToStartingRun()
                self.activeConversationId = conversationId
                try await self.runtime.run(
                    session: session,
                    sessionId: resolvedSessionId,
                    afterCursor: self.liveCursor,
                    outgoingContent: content,
                    eventHandler: { [weak self] event in
                        await self?.handleRuntimeEvent(event, conversationId: conversationId)
                    }
                )
                if session.authorization.isGuest == false {
                    do {
                        _ = try await self.flashcardsStore.runLinkedSync(linkedSession: session)
                    } catch {
                        self.flashcardsStore.globalErrorMessage = Flashcards.errorMessage(error: error)
                    }
                }
            } catch is CancellationError {
            } catch {
                self.handleSendMessageError(
                    error,
                    didAcceptRun: self.composerPhase == .running,
                    didAppendOptimisticMessages: didAppendOptimisticMessages,
                    draftText: draftText,
                    draftAttachments: draftAttachments
                )
            }

            if self.activeConversationId == conversationId {
                if self.shouldResetComposerPhaseAfterSendTaskCompletion() {
                    self.transitionToIdle()
                }
                self.activeConversationId = nil
            }
            self.activeSendTask = nil
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

    func shutdownForTests() {
        self.activeBootstrapTask?.cancel()
        self.activeBootstrapTask = nil
        self.activeWarmUpTask?.cancel()
        self.activeWarmUpTask = nil
        self.invalidatePendingNewSessionRequest()
        self.cancelStreaming()
        self.cancelDictation()
    }

    func ensureAIChatReadyForSend(linkedSession: CloudLinkedSession) async throws {
        guard self.bootstrapPhase == .ready else {
            throw LocalStoreError.validation("AI chat is still loading.")
        }
        if linkedSession.authorization.isGuest == false && self.chatSessionId.isEmpty {
            throw LocalStoreError.validation("AI chat session is unavailable. Reload the AI tab and try again.")
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
        draftText: String,
        draftAttachments: [AIChatAttachment]
    ) {
        let latestPersistedState = self.historyStore.loadState()
        let resolvedSessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: latestPersistedState.chatSessionId
        )
        self.chatSessionId = resolvedSessionId
        self.conversationScopeId = resolvedSessionId
        self.repairStatus = nil
        self.transitionToIdle()
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil

        if didAcceptRun == false && didAppendOptimisticMessages {
            self.messages = latestPersistedState.messages
            self.applyComposerDraft(
                inputText: draftText,
                pendingAttachments: draftAttachments
            )
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
            self.showGeneralError(message: "A response is already in progress. Wait for it to finish or stop it before sending another message.")
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
                let bootstrap = try await self.chatService.loadBootstrap(
                    session: session,
                    sessionId: resolvedSessionId.isEmpty ? nil : resolvedSessionId,
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
            self.applyEnvelope(response.envelope)
            self.applyComposerDraft(inputText: "", pendingAttachments: [])
            self.schedulePersistCurrentDraftState()
            self.repairStatus = nil
            if response.activeRun != nil {
                self.attachActiveLiveStreamIfPossible()
            } else {
                self.transitionToIdle()
            }
        case .liveEvent(let liveEvent):
            self.handleLiveEvent(liveEvent)
        case .appendAssistantAccountUpgradePrompt(let message, let buttonTitle):
            self.appendAssistantAccountUpgradePrompt(message: message, buttonTitle: buttonTitle)
        case .finish:
            self.repairStatus = nil
            if self.activeConversationId == conversationId {
                self.transitionToIdle()
            }
        case .fail(let message):
            self.repairStatus = nil
            self.showGeneralError(message: message)
            if self.activeConversationId == conversationId {
                self.transitionToIdle()
            }
        }
    }

    func applyEnvelope(_ envelope: AIChatConversationEnvelope) {
        self.messages = envelope.conversation.messages
        self.chatSessionId = envelope.sessionId
        self.conversationScopeId = envelope.conversationScopeId
        self.serverChatConfig = envelope.chatConfig
        self.applyComposerSuggestions(envelope.composerSuggestions)
        self.hasOlderMessages = envelope.conversation.hasOlder
        self.oldestCursor = envelope.conversation.oldestCursor
        self.repairStatus = nil

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
