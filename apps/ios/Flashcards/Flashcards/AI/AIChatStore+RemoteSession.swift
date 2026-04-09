import Foundation

extension AIChatStore {
    func invalidatePendingRemoteSessionProvisionRequest() {
        self.activeRemoteSessionProvisionRequest?.task.cancel()
        self.activeRemoteSessionProvisionRequest = nil
    }

    func ensureRemoteSessionIfNeeded() async throws -> String {
        let session = try await self.flashcardsStore.cloudSessionForAI()
        return try await self.ensureRemoteSessionIfNeeded(session: session)
    }

    func ensureRemoteSessionIfNeeded(session: CloudLinkedSession) async throws -> String {
        let resolvedSessionId = aiChatResolvedSessionId(
            workspaceId: self.historyWorkspaceId(),
            sessionId: self.chatSessionId
        )

        if resolvedSessionId.isEmpty {
            let explicitSessionId = makeAIChatSessionId()
            self.prepareExplicitRemoteSessionProvisioning(sessionId: explicitSessionId)
            return try await self.provisionRemoteSession(
                session: session,
                sessionId: explicitSessionId
            )
        }

        if self.chatSessionId != resolvedSessionId || self.conversationScopeId != resolvedSessionId {
            self.chatSessionId = resolvedSessionId
            self.conversationScopeId = resolvedSessionId
        }

        if self.requiresRemoteSessionProvisioning == false {
            return resolvedSessionId
        }

        return try await self.provisionRemoteSession(
            session: session,
            sessionId: resolvedSessionId
        )
    }

    private func prepareExplicitRemoteSessionProvisioning(sessionId: String) {
        self.invalidatePendingRemoteSessionProvisionRequest()
        self.chatSessionId = sessionId
        self.conversationScopeId = sessionId
        self.requiresRemoteSessionProvisioning = true
        self.schedulePersistCurrentDraftState()
        self.schedulePersistCurrentState()
    }

    private func provisionRemoteSession(
        session: CloudLinkedSession,
        sessionId: String
    ) async throws -> String {
        if let activeRequest = self.activeRemoteSessionProvisionRequest {
            if activeRequest.sessionId == sessionId {
                let response = try await activeRequest.task.value
                try self.applyProvisionedRemoteSession(
                    response: response,
                    expectedSessionId: sessionId
                )
                return sessionId
            }

            activeRequest.task.cancel()
            self.activeRemoteSessionProvisionRequest = nil
        }

        let task = Task {
            try await self.chatService.createNewSession(
                session: session,
                sessionId: sessionId
            )
        }
        self.activeRemoteSessionProvisionRequest = AIChatRemoteSessionProvisionRequest(
            sessionId: sessionId,
            task: task
        )

        do {
            let response = try await task.value
            if self.activeRemoteSessionProvisionRequest?.sessionId == sessionId {
                self.activeRemoteSessionProvisionRequest = nil
            }
            try self.applyProvisionedRemoteSession(
                response: response,
                expectedSessionId: sessionId
            )
            return sessionId
        } catch {
            if self.activeRemoteSessionProvisionRequest?.sessionId == sessionId {
                self.activeRemoteSessionProvisionRequest = nil
            }
            if self.chatSessionId == sessionId {
                self.requiresRemoteSessionProvisioning = true
            }
            throw error
        }
    }

    private func applyProvisionedRemoteSession(
        response: AIChatNewSessionResponse,
        expectedSessionId: String
    ) throws {
        guard response.sessionId == expectedSessionId else {
            throw LocalStoreError.validation(
                "AI chat provisioning returned an unexpected session id. expected=\(expectedSessionId) actual=\(response.sessionId)"
            )
        }

        guard self.chatSessionId == expectedSessionId else {
            return
        }

        self.requiresRemoteSessionProvisioning = false
        self.serverChatConfig = response.chatConfig
        if self.messages.isEmpty && self.activeRunId == nil {
            self.applyComposerSuggestions(response.composerSuggestions)
        }
        self.schedulePersistCurrentState()
    }
}
