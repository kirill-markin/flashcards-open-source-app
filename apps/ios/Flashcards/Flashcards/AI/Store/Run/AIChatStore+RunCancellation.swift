import Foundation

struct AIChatStopTarget: Sendable {
    let session: CloudLinkedSession
    let sessionId: String
    let runId: String?
    let cloudState: CloudAccountState?
}

struct AIChatStopRequestContext: Sendable {
    let sessionId: String
    let runId: String?
    let workspaceId: String?
    let cloudState: CloudAccountState?
}

func shouldAttemptRemoteAIChatStop(
    initialComposerPhase: AIChatComposerPhase,
    hadActiveSendTask: Bool,
    stopRunId: String?
) -> Bool {
    if aiChatNonEmptyRunId(runId: stopRunId) != nil {
        return true
    }

    if hadActiveSendTask {
        return true
    }

    switch initialComposerPhase {
    case .startingRun, .running:
        return true
    case .idle, .preparingSend, .stopping:
        return false
    }
}

func makeAIChatStopFailureMetadata(
    error: Error,
    sessionId: String,
    runId: String?,
    workspaceId: String?,
    cloudState: CloudAccountState?,
    configurationMode: CloudServiceConfigurationMode?
) -> [String: String] {
    var metadata: [String: String] = [
        "chatSessionId": sessionId,
        "failureKind": "stop_request_failed",
        "errorSummary": Flashcards.errorMessage(error: error)
    ]

    if let runId = aiChatNonEmptyRunId(runId: runId) {
        metadata["runId"] = runId
    }
    if let workspaceId, workspaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
        metadata["workspaceId"] = workspaceId
    }
    if let cloudState {
        metadata["cloudState"] = cloudState.rawValue
    }
    if let configurationMode {
        metadata["configurationMode"] = configurationMode.rawValue
    }

    if let diagnosticError = error as? any AIChatFailureDiagnosticProviding {
        let diagnostics = diagnosticError.diagnostics
        metadata["clientRequestId"] = diagnostics.clientRequestId
        metadata["stage"] = diagnostics.stage.rawValue
        metadata["errorKind"] = diagnostics.errorKind.rawValue
        if let backendRequestId = diagnostics.backendRequestId,
           backendRequestId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            metadata["backendRequestId"] = backendRequestId
        }
        if let statusCode = diagnostics.statusCode {
            metadata["statusCode"] = String(statusCode)
        }
    }

    if let serviceError = error as? AIChatServiceError,
       case .invalidResponse(let errorDetails, _, _) = serviceError {
        if let backendCode = errorDetails.code,
           backendCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            metadata["backendCode"] = backendCode
        }
        if metadata["backendRequestId"] == nil,
           let backendRequestId = errorDetails.requestId,
           backendRequestId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            metadata["backendRequestId"] = backendRequestId
        }
    }

    return metadata
}

extension AIChatStore {
    func cancelStreaming() {
        guard let stopContext = self.prepareStreamingCancellationForRemoteStop() else {
            return
        }

        if let stopTarget = try? self.makeCurrentAIChatStopTarget(context: stopContext) {
            Task {
                await self.performRemoteAIChatStop(
                    target: stopTarget,
                    shouldReloadBootstrapWhenStopRejected: true
                )
            }
            return
        }

        Task {
            do {
                let stopTarget = try await self.makeResolvedAIChatStopTarget(context: stopContext)
                await self.performRemoteAIChatStop(
                    target: stopTarget,
                    shouldReloadBootstrapWhenStopRejected: true
                )
            } catch {
                self.finishFailedAIChatStopPreparation(error: error, context: stopContext)
            }
        }
    }

    func stopStreamingForWorkspaceChange() async {
        guard let stopContext = self.prepareStreamingCancellationForRemoteStop() else {
            return
        }

        let stopTarget: AIChatStopTarget
        do {
            stopTarget = try self.makeCurrentAIChatStopTarget(context: stopContext)
        } catch {
            self.finishFailedAIChatStopPreparation(error: error, context: stopContext)
            return
        }

        await self.performRemoteAIChatStop(
            target: stopTarget,
            shouldReloadBootstrapWhenStopRejected: false
        )
    }

    private func prepareStreamingCancellationForRemoteStop() -> AIChatStopRequestContext? {
        let stopRunId: String? = aiChatNonEmptyRunId(runId: self.activeRunId)
        let initialComposerPhase = self.composerPhase
        let hadActiveSendTask = self.activeSendTask != nil
        let shouldAttemptRemoteStop = shouldAttemptRemoteAIChatStop(
            initialComposerPhase: initialComposerPhase,
            hadActiveSendTask: hadActiveSendTask,
            stopRunId: stopRunId
        )
        self.activeSendTask?.cancel()
        self.activeSendTask = nil
        Task {
            await self.runtime.detach()
        }
        if shouldAttemptRemoteStop {
            self.transitionToStopping(runId: stopRunId)
        } else {
            self.transitionToIdle()
        }
        self.repairStatus = nil
        self.clearOptimisticAssistantStatusIfNeeded()

        let sessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId
        )
        self.chatSessionId = sessionId
        self.conversationScopeId = sessionId
        guard shouldAttemptRemoteStop else {
            return nil
        }
        guard sessionId.isEmpty == false else {
            self.transitionToIdle()
            self.schedulePersistCurrentState()
            return nil
        }

        return AIChatStopRequestContext(
            sessionId: sessionId,
            runId: stopRunId,
            workspaceId: self.currentAIChatStopWorkspaceId(),
            cloudState: self.flashcardsStore.cloudSettings?.cloudState
        )
    }

    private func currentAIChatStopWorkspaceId() -> String? {
        self.flashcardsStore.workspace?.workspaceId
            ?? self.flashcardsStore.cloudSettings?.activeWorkspaceId
            ?? self.flashcardsStore.cloudSettings?.linkedWorkspaceId
    }

    private func makeCurrentAIChatStopTarget(context: AIChatStopRequestContext) throws -> AIChatStopTarget {
        let session = try self.flashcardsStore.currentActiveCloudSessionForAI()
        try self.validateAIChatStopWorkspace(session: session, context: context)
        return AIChatStopTarget(
            session: session,
            sessionId: context.sessionId,
            runId: context.runId,
            cloudState: context.cloudState
        )
    }

    private func makeResolvedAIChatStopTarget(context: AIChatStopRequestContext) async throws -> AIChatStopTarget {
        let session = try await self.flashcardsStore.cloudSessionForAI()
        try self.validateAIChatStopWorkspace(session: session, context: context)
        return AIChatStopTarget(
            session: session,
            sessionId: context.sessionId,
            runId: context.runId,
            cloudState: context.cloudState
        )
    }

    private func validateAIChatStopWorkspace(
        session: CloudLinkedSession,
        context: AIChatStopRequestContext
    ) throws {
        guard let workspaceId = context.workspaceId,
              workspaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        else {
            return
        }

        guard session.workspaceId == workspaceId else {
            throw LocalStoreError.validation(
                """
                AI chat stop workspace changed before the stop request could be prepared. \
                expectedWorkspaceId=\(workspaceId) \
                actualWorkspaceId=\(session.workspaceId)
                """
            )
        }
    }

    private func finishFailedAIChatStopPreparation(error: Error, context: AIChatStopRequestContext) {
        if self.composerPhase == .stopping {
            self.transitionToIdle()
        }
        self.schedulePersistCurrentState()
        logAIChatStoreEvent(
            action: "ai_stop_failed",
            metadata: makeAIChatStopFailureMetadata(
                error: error,
                sessionId: context.sessionId,
                runId: context.runId,
                workspaceId: context.workspaceId,
                cloudState: context.cloudState,
                configurationMode: nil
            )
        )
    }

    private func performRemoteAIChatStop(
        target: AIChatStopTarget,
        shouldReloadBootstrapWhenStopRejected: Bool
    ) async {
        defer {
            if self.composerPhase == .stopping {
                self.transitionToIdle()
            }
            self.schedulePersistCurrentState()
        }

        do {
            let stopResponse = try await self.flashcardsStore.withCloudSessionPreservingStableContext(
                linkedSession: target.session
            ) { refreshedSession in
                try await self.chatService.stopRun(
                    session: refreshedSession,
                    sessionId: target.sessionId,
                    runId: target.runId
                )
            }
            // The cancel-cleanup branches below mutate state for the run we
            // were stopping. If composerPhase moved off .stopping (e.g. a
            // new run started or transitionToIdle already ran) the
            // response is stale and must not clobber the new state.
            guard self.composerPhase == .stopping else {
                return
            }
            if stopResponse.stopped == false {
                self.transitionToIdle()
                if shouldReloadBootstrapWhenStopRejected {
                    self.startLinkedBootstrap(forceReloadState: true, resumeAttemptDiagnostics: nil)
                }
                return
            }
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
                metadata: makeAIChatStopFailureMetadata(
                    error: error,
                    sessionId: target.sessionId,
                    runId: target.runId,
                    workspaceId: target.session.workspaceId,
                    cloudState: target.cloudState,
                    configurationMode: target.session.configurationMode
                )
            )
        }
    }
}

func isAIChatRequestCancellationError(error: Error) -> Bool {
    isRequestCancellationError(error: error)
}
