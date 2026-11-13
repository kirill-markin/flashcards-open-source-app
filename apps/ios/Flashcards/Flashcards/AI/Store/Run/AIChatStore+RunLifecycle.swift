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

    func startAIImport(attachments: [AIChatAttachment], requestText: String) {
        if self.chatSessionId.isEmpty && self.currentComposerDraft().isEmpty == false {
            self.prepareExplicitRemoteSessionProvisioning(sessionId: makeAIChatSessionId())
        }
        self.startFreshLocalSession(
            draft: AIChatComposerDraft(
                inputText: requestText,
                pendingAttachments: attachments,
                origin: .aiImport
            )
        )
        self.sendMessage()
    }

    func sendMessage() {
        guard self.isChatInteractive else {
            return
        }
        if self.isComposerBusy || self.dictationState != .idle || self.isAIImportDraftBlocked {
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
            try validateAIChatOutgoingAttachments(attachments: self.pendingAttachments)
        } catch {
            self.showGeneralError(error: error)
            return
        }
        var preparedDraft = self.currentComposerDraft()
        let isAIImportRetry = preparedDraft.aiImportRequestId != nil
        let initialHistoryWorkspaceId = self.historyWorkspaceId()
        if preparedDraft.origin == .aiImport {
            preparedDraft.aiImportRequestId = preparedDraft.aiImportRequestId ?? makeAIChatClientRequestId()
            self.invalidateActivePassiveSnapshotRefreshTask()
            self.persistDraftStateImmediately(
                workspaceId: initialHistoryWorkspaceId,
                sessionId: resolvedSessionId,
                draft: preparedDraft
            )
        }
        let draft = preparedDraft
        let outgoingText = self.trimmedInputText()
        self.transitionToPreparingSend()
        self.persistStateSynchronously(state: self.currentPersistedState())
        let conversationId = UUID().uuidString.lowercased()
        self.applyComposerDraft(inputText: "", pendingAttachments: [], operation: .send)
        self.appendOptimisticOutgoingTurn(content: content)
        self.storePreSendSnapshot(preSendSnapshot, conversationId: conversationId)
        self.activeConversationId = conversationId

        let task = Task { [self] in
            defer {
                self.clearPreSendSnapshot(conversationId: conversationId)
                if self.activeConversationId == conversationId {
                    if self.shouldResetComposerPhaseAfterSendTaskCompletion() {
                        self.transitionToIdle()
                    }
                    self.activeConversationId = nil
                    self.activeSendTask = nil
                }
            }

            do {
                let session = try await self.flashcardsStore.cloudSessionForAI()
                try await self.ensureAIChatReadyForSend(linkedSession: session)
                let explicitSessionId = try await self.ensureRemoteSessionIfNeeded(session: session)
                let startRunContent = try await self.uploadOutgoingContent(
                    session: session,
                    attachments: draft.pendingAttachments,
                    text: outgoingText
                )
                if isAIImportRetry {
                    let response = try await self.chatService.loadBootstrap(
                        session: session,
                        sessionId: explicitSessionId,
                        limit: aiChatBootstrapPageLimit,
                        resumeAttemptDiagnostics: nil
                    )
                    try Task.checkCancellation()
                    try validateAIChatBootstrapSessionContract(response: response, requestedSessionId: explicitSessionId)
                    // The transcript carries no request identity, and a replay could append after someone else's turn.
                    if response.activeRun != nil || response.conversation.hasOlder
                        || response.conversation.messages.contains(where: { $0.role == .user }) {
                        self.applyComposerDraft(draft, operation: .sendFailedRestore)
                        self.schedulePersistCurrentDraftState()
                        self.applyBootstrap(response)
                        self.attachBootstrapLiveIfNeeded(response: response, session: session, resumeAttemptDiagnostics: nil)
                        return
                    }
                }
                if draft.aiImportRequestId != nil {
                    try Task.checkCancellation()
                    let currentHistoryWorkspaceId = self.historyWorkspaceId()
                    if currentHistoryWorkspaceId != initialHistoryWorkspaceId {
                        self.persistDraftStateImmediately(
                            workspaceId: currentHistoryWorkspaceId,
                            sessionId: explicitSessionId,
                            draft: draft
                        )
                        self.persistStateSynchronously(state: preSendSnapshot.persistedState)
                    }
                }
                self.resetRunToolCallTracking()
                self.transitionToStartingRun()
                try await self.runtime.run(
                    session: session,
                    sessionId: explicitSessionId,
                    afterCursor: self.liveCursor,
                    aiImportRequestId: draft.aiImportRequestId,
                    outgoingContent: startRunContent,
                    eventHandler: { [weak self] event in
                        await self?.handleRuntimeEvent(event, conversationId: conversationId)
                    }
                )
                if draft.origin != .aiImport || self.activeConversationId == conversationId {
                    aiChatRemoveAttachmentFiles(attachments: draft.pendingAttachments)
                }
            } catch is CancellationError {
            } catch {
                // A cancelled upload throws `URLError(.cancelled)`; whoever cancelled the send already owns the
                // chat, so restoring the pre-send state here would overwrite it.
                if Task.isCancelled || isAIChatRequestCancellationError(error: error) {
                    return
                }
                self.handleSendMessageError(
                    error,
                    didAcceptRun: self.composerPhase == .running,
                    didAppendOptimisticMessages: true,
                    preSendSnapshot: preSendSnapshot,
                    draft: draft
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
        // Applying a sync result resets the status to idle; a blocked status clears only through its own recovery.
        if case .blocked(let message) = self.flashcardsStore.syncStatus {
            throw LocalStoreError.validation(message)
        }

        let syncResult = try await self.flashcardsStore.runLinkedSync(linkedSession: linkedSession)
        self.startApplyingLinkedSyncResult(syncResult: syncResult)
        let outboxEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: Int.max)
        if outboxEntries.isEmpty == false {
            throw LocalStoreError.validation("AI chat is blocked until all pending sync operations are uploaded.")
        }
    }

    /**
     An AI send or post-sync never waits for, or fails from, the Review rebuild a sync result can start: a failed
     rebuild keeps `hasUnrebuiltSyncWrites` set, so the next applied sync retries it.
     */
    func startApplyingLinkedSyncResult(syncResult: CloudSyncResult) {
        Task { @MainActor in
            do {
                try await self.flashcardsStore.applySyncResultWithoutBlockingReset(
                    syncResult: syncResult,
                    now: Date(),
                    trigger: self.flashcardsStore.manualCloudSyncTrigger(now: Date())
                )
            } catch {
                logAIChatStoreEvent(
                    action: "ai_sync_result_apply_failed",
                    metadata: [
                        "workspaceId": self.flashcardsStore.workspace?.workspaceId ?? "",
                        "errorSummary": Flashcards.errorMessage(error: error)
                    ]
                )
            }
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

    /// The transcript copy of the turn, which shows a file or image by the label the backend returns for it.
    func makeOutgoingContent() -> [AIChatContentPart] {
        var content: [AIChatContentPart] = self.pendingAttachments.compactMap { attachment in
            switch attachment.payload {
            case .localFile(let fileName, let mediaType, _):
                if attachment.isImage {
                    return .image(mediaType: mediaType, base64Data: "")
                }

                return .file(
                    fileName: fileName,
                    mediaType: mediaType,
                    base64Data: ""
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

    /// Uploads each file and image in draft order and names it in an `upload` part, keeping the transcript order.
    func uploadOutgoingContent(
        session: CloudLinkedSession,
        attachments: [AIChatAttachment],
        text: String
    ) async throws -> [AIChatStartRunContentPart] {
        var content: [AIChatStartRunContentPart] = []
        for attachment in attachments {
            try Task.checkCancellation()
            _ = try self.flashcardsStore.aiConsent.requireReceipt(session: session)
            switch attachment.payload {
            case .localFile(let fileName, let mediaType, let sizeBytes):
                let fileURL = try aiChatExistingAttachmentFileURL(attachmentId: attachment.id)
                let uploadId = try await self.chatService.uploadChatFile(
                    session: session,
                    fileName: fileName,
                    mediaType: mediaType,
                    sizeBytes: sizeBytes,
                    fileURL: fileURL
                )
                content.append(.upload(uploadId: uploadId, fileName: fileName, mediaType: mediaType))
            case .card(let card):
                content.append(.card(card))
            case .unknown:
                continue
            }
        }

        if text.isEmpty == false {
            content.append(.text(text))
        }

        return content
    }

    func handleSendMessageError(
        _ error: Error,
        didAcceptRun: Bool,
        didAppendOptimisticMessages: Bool,
        preSendSnapshot: AIChatPreSendSnapshot,
        draft: AIChatComposerDraft
    ) {
        let isAiLimitReached = didAcceptRun == false && isAiLimitReachedError(error: error)
        // Signing in is the fix only while this install has no account; a signed-in caller must not be
        // told to create one, so only the unlinked states keep the upgrade prompt.
        let shouldShowGuestQuotaUpgradePrompt = isAiLimitReached && self.usesGuestAIRestrictions
        let didProvisionAIImportSession = draft.origin == .aiImport && self.requiresRemoteSessionProvisioning == false
        self.repairStatus = nil
        self.transitionToIdle()
        self.activeStreamingMessageId = nil
        self.activeStreamingItemId = nil

        if didAcceptRun == false && didAppendOptimisticMessages {
            self.restorePreSendState(preSendSnapshot)
            if didProvisionAIImportSession {
                self.requiresRemoteSessionProvisioning = false
            }
            self.suppressDraftRestore = false
            self.persistDraftRestoreSuppressionSynchronously(
                workspaceId: self.historyWorkspaceId(),
                sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
                isSuppressed: false
            )
            self.applyComposerDraft(draft, operation: .sendFailedRestore)
            self.persistDraftStateImmediately(
                workspaceId: self.historyWorkspaceId(),
                sessionId: self.chatSessionId.isEmpty ? nil : self.chatSessionId,
                draft: draft
            )
            if shouldShowGuestQuotaUpgradePrompt {
                self.appendAssistantAccountUpgradePrompt(
                    message: hasPremiumAccess(entitlement: self.flashcardsStore.cloudEntitlement)
                        ? aiChatAccountLimitReachedMessage(usage: nil)
                        : aiChatGuestLimitReachedMessage(),
                    buttonTitle: aiChatGuestQuotaButtonTitle
                )
            }
            self.schedulePersistCurrentState()
        }

        if didAcceptRun == false && isAIChatSessionNotCurrentError(error: error) {
            let staleSessionId = self.chatSessionId
            if draft.origin == .aiImport {
                // The server checks for the original request before refusing a stale session.
                self.moveAIImportToFreshDraft(staleSessionId: staleSessionId, draft: draft)
            } else {
                self.switchToCurrentChatAfterSessionNotCurrent(staleSessionId: staleSessionId, draft: draft)
            }
            return
        }

        if isAiLimitReached {
            self.quotaRefusal = AIChatQuotaRefusal(
                id: UUID(),
                userId: self.flashcardsStore.cloudSettings?.linkedUserId,
                cloudState: self.flashcardsStore.cloudSettings?.cloudState
            )
            return
        }

        if
            didAcceptRun == false,
            let serviceError = error as? AIChatServiceError,
            case .invalidResponse(let errorDetails, _, _) = serviceError,
            isOwnOpenAIKeyErrorCode(errorDetails.code)
        {
            self.showGeneralError(message: aiChatOwnOpenAIKeyErrorMessage(providerMessage: errorDetails.message))
            return
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

    /// A concurrent New on another device must not move the import into an existing chat's draft.
    private func moveAIImportToFreshDraft(staleSessionId: String, draft: AIChatComposerDraft) {
        var freshDraft = draft
        freshDraft.aiImportRequestId = nil
        self.startFreshLocalDraftSession(draft: freshDraft)
        self.persistDraftStateImmediately(
            workspaceId: self.historyWorkspaceId(),
            sessionId: staleSessionId,
            draft: AIChatComposerDraft(inputText: "", pendingAttachments: [])
        )
        self.showAlert(.generalError(title: aiChatSessionNotCurrentNotice(), message: ""))
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
