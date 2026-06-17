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
        if self.chatSessionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.prepareExplicitRemoteSessionProvisioning(sessionId: makeAIChatSessionId())
        }
        let foregroundProvisioningSessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId
        )
        self.preemptPendingNewSessionProvisioningForForegroundSessionProvisioning(
            sessionId: foregroundProvisioningSessionId
        )
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
        do {
            try validateAIChatStartRunRequestSize(
                sessionId: resolvedSessionId,
                workspaceId: nil,
                outgoingContent: content
            )
        } catch {
            self.showGeneralError(error: error)
            return
        }
        let draftText = self.inputText
        let draftAttachments = self.pendingAttachments
        self.transitionToPreparingSend()
        self.persistStateSynchronously(state: self.currentPersistedState())
        let conversationId = UUID().uuidString.lowercased()
        self.applyComposerDraft(inputText: "", pendingAttachments: [])
        self.appendOptimisticOutgoingTurn(content: content)
        self.storePreSendSnapshot(preSendSnapshot, conversationId: conversationId)
        self.activeConversationId = conversationId

        let task = Task {
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
                try await self.runtime.validateStartRunRequestSize(
                    session: session,
                    sessionId: resolvedSessionId,
                    outgoingContent: content
                )
                try await self.ensureAIChatReadyForSend(linkedSession: session)
                let explicitSessionId = try await self.ensureRemoteSessionIfNeeded(session: session)
                self.resetRunToolCallTracking()
                self.transitionToStartingRun()
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
                    didAppendOptimisticMessages: true,
                    preSendSnapshot: preSendSnapshot,
                    draftText: draftText,
                    draftAttachments: draftAttachments
                )
            }
        }

        self.activeSendTask = task
    }

    func shutdownForTests() {
        self.invalidateActiveBootstrapTask()
        self.invalidateActivePassiveSnapshotRefreshTask()
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
        let shouldShowGuestQuotaUpgradePrompt = didAcceptRun == false && isGuestAiLimitError(error: error)
        self.repairStatus = nil
        self.transitionToIdle()
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil

        if didAcceptRun == false && didAppendOptimisticMessages {
            self.restorePreSendState(preSendSnapshot)
            self.suppressDraftRestore = false
            self.persistDraftRestoreSuppressionSynchronously(
                workspaceId: self.historyWorkspaceId(),
                sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
                isSuppressed: false
            )
            self.inputText = draftText
            self.pendingAttachments = draftAttachments
            self.persistDraftStateImmediately(
                workspaceId: self.historyWorkspaceId(),
                sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
                draft: AIChatComposerDraft(
                    inputText: draftText,
                    pendingAttachments: draftAttachments
                )
            )
            if shouldShowGuestQuotaUpgradePrompt {
                self.appendAssistantAccountUpgradePrompt(
                    message: aiChatGuestQuotaReachedMessage,
                    buttonTitle: aiChatGuestQuotaButtonTitle
                )
            }
            self.schedulePersistCurrentState()
            if shouldShowGuestQuotaUpgradePrompt {
                return
            }
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
