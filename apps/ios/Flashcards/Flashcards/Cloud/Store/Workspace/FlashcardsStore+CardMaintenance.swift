import Foundation

@MainActor
extension FlashcardsStore {
    func loadCardMaintenancePreview(scope: CardMaintenanceScope) async throws -> CardMaintenancePreview {
        try await self.withCardMaintenanceSession(scope: scope) { session, syncGeneration in
            try self.checkNoPendingCardMaintenanceRefresh(workspaceId: scope.workspaceId)
            try await self.syncCardMaintenanceWorkspace(scope: scope, session: session, syncGeneration: syncGeneration, refreshToken: nil)
            try self.checkCardMaintenanceDeckRules(scope: scope)
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            let response = try await cloudSyncService.loadCardMaintenancePreview(session: session, scope: scope)
            try self.cloudRuntime.checkSyncGeneration(syncGeneration)
            try self.checkCurrentCardMaintenanceSession(scope: scope, session: session)
            if scope.expectedDeckFilter != nil {
                try await self.syncCardMaintenanceWorkspace(scope: scope, session: session, syncGeneration: syncGeneration, refreshToken: nil)
                try self.checkCardMaintenanceDeckRules(scope: scope)
            }
            try self.cloudRuntime.checkSyncGeneration(syncGeneration)
            try self.checkCurrentCardMaintenanceSession(scope: scope, session: session)
            try self.checkNoPendingCardMaintenanceRefresh(workspaceId: scope.workspaceId)
            return CardMaintenancePreview(
                scope: scope,
                userId: session.userId,
                apiBaseUrl: session.apiBaseUrl,
                response: response
            )
        }
    }

    func executeCardMaintenance(preview: CardMaintenancePreview, confirmationText: String) async throws {
        guard confirmationText.utf8.elementsEqual(preview.response.confirmationText.utf8) else {
            throw CardMaintenanceError.confirmationInvalid
        }
        try await self.withCardMaintenanceSession(scope: preview.scope) { session, syncGeneration in
            try self.checkCardMaintenancePreviewSession(preview: preview, session: session)
            let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
            let workspaceId = preview.scope.workspaceId
            guard self.executingCardMaintenanceWorkspaceIds.contains(workspaceId) == false else {
                throw CardMaintenanceError.refreshRequired
            }
            let outbox = try requireLocalDatabase(database: self.database).outboxStore
            let token = UUID().uuidString
            try outbox.beginCardMaintenanceRefresh(
                workspaceId: workspaceId,
                token: token,
                previewFingerprint: preview.response.previewFingerprint
            )
            self.executingCardMaintenanceWorkspaceIds.insert(workspaceId)
            defer { self.executingCardMaintenanceWorkspaceIds.remove(workspaceId) }

            do {
                try await self.syncCardMaintenanceWorkspace(scope: preview.scope, session: session, syncGeneration: syncGeneration, refreshToken: nil)
                try self.cloudRuntime.checkSyncGeneration(syncGeneration)
                try self.checkCardMaintenanceDeckRules(scope: preview.scope)
            } catch {
                try self.cloudRuntime.checkSyncGeneration(syncGeneration)
                try self.checkCurrentCardMaintenanceSession(scope: preview.scope, session: session)
                try outbox.finishCardMaintenanceRefresh(workspaceId: workspaceId, token: token)
                throw error
            }

            do {
                _ = try await cloudSyncService.executeCardMaintenance(
                    session: session,
                    preview: preview,
                    confirmationText: confirmationText
                )
            } catch {
                try self.cloudRuntime.checkSyncGeneration(syncGeneration)
                try self.checkCurrentCardMaintenanceSession(scope: preview.scope, session: session)
                if isDefinitiveCardMaintenanceRejection(error: error) {
                    try outbox.finishCardMaintenanceRefresh(workspaceId: workspaceId, token: token)
                    // The authentication wrapper retries its operation on a raw 401.
                    if self.isCloudAuthorizationError(error) {
                        throw CardMaintenanceError.executionRejected(Flashcards.errorMessage(error: error))
                    }
                    throw error
                }
                let details = isRequestCancellationError(error: error) ? nil : Flashcards.errorMessage(error: error)
                throw CardMaintenanceError.executionUnconfirmed(details)
            }

            try self.cloudRuntime.checkSyncGeneration(syncGeneration)
            try self.checkCurrentCardMaintenanceSession(scope: preview.scope, session: session)
            do {
                try outbox.acknowledgeCardMaintenanceRefresh(workspaceId: workspaceId, token: token)
            } catch {
                throw CardMaintenanceError.executionUnconfirmed(Flashcards.errorMessage(error: error))
            }
        }
    }

    func refreshAfterCardMaintenance(scope: CardMaintenanceScope, acknowledgedPreview: CardMaintenancePreview?) async throws {
        try await self.withCardMaintenanceSession(scope: scope) { session, syncGeneration in
            if let acknowledgedPreview {
                try self.checkCardMaintenancePreviewSession(preview: acknowledgedPreview, session: session)
            }
            if let token = try await self.cardMaintenanceRefreshTokenAfterReconciliation(linkedSession: session) {
                try await self.syncCardMaintenanceWorkspace(scope: scope, session: session, syncGeneration: syncGeneration, refreshToken: token)
            } else {
                try self.checkNoPendingCardMaintenanceRefresh(workspaceId: scope.workspaceId)
            }
        }
    }

    func pendingCardMaintenanceRefresh(workspaceId: String) throws -> PendingCardMaintenanceRefresh? {
        let outbox = try requireLocalDatabase(database: self.database).outboxStore
        return try outbox.pendingCardMaintenanceRefresh(workspaceId: workspaceId)
    }

    func cardMaintenanceRefreshTokenAfterReconciliation(linkedSession: CloudLinkedSession) async throws -> String? {
        let workspaceId = linkedSession.workspaceId
        guard linkedSession.authorization.isGuest == false,
              self.executingCardMaintenanceWorkspaceIds.contains(workspaceId) == false,
              let pending = try self.pendingCardMaintenanceRefresh(workspaceId: workspaceId) else {
            return nil
        }
        let syncGeneration = self.cloudRuntime.syncGeneration
        try self.cloudRuntime.checkSyncGeneration(syncGeneration)
        try self.checkCurrentCardMaintenanceSyncSession(linkedSession: linkedSession)
        if pending.status == .acknowledged {
            return pending.token
        }

        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let response: CardMaintenanceReconcileResponse
        do {
            response = try await cloudSyncService.reconcileCardMaintenance(
                session: linkedSession,
                previewFingerprint: pending.previewFingerprint
            )
        } catch {
            try self.cloudRuntime.checkSyncGeneration(syncGeneration)
            try self.checkCurrentCardMaintenanceSyncSession(linkedSession: linkedSession)
            if try await self.enterLinkedWorkspaceUnavailableRecoveryIfNeeded(
                error: error,
                linkedSession: linkedSession,
                detectedAt: Date(),
                syncGeneration: syncGeneration
            ) {
                try self.throwIfCloudCredentialRecoveryRequired()
            }
            throw error
        }
        try self.cloudRuntime.checkSyncGeneration(syncGeneration)
        try self.checkCurrentCardMaintenanceSyncSession(linkedSession: linkedSession)
        // Settlement permits a fresh pull, but does not tell us whether execute committed.
        return response.isSettled ? pending.token : nil
    }

    func finishCardMaintenanceRefresh(linkedSession: CloudLinkedSession, token: String?) throws {
        guard let token else {
            return
        }
        try self.checkCurrentCardMaintenanceSyncSession(linkedSession: linkedSession)
        let outbox = try requireLocalDatabase(database: self.database).outboxStore
        try outbox.finishCardMaintenanceRefresh(workspaceId: linkedSession.workspaceId, token: token)
    }

    private func checkNoPendingCardMaintenanceRefresh(workspaceId: String) throws {
        if try self.pendingCardMaintenanceRefresh(workspaceId: workspaceId) != nil {
            throw CardMaintenanceError.refreshRequired
        }
    }

    private func checkCurrentCardMaintenanceSyncSession(linkedSession: CloudLinkedSession) throws {
        try Task.checkCancellation()
        guard self.workspace?.workspaceId == linkedSession.workspaceId,
              self.cloudSettings?.cloudState == .linked,
              let activeSession = self.cloudRuntime.activeCloudSession(),
              cloudLinkedSessionsMatchStableContext(activeSession, linkedSession) else {
            throw CancellationError()
        }
    }

    private func checkCardMaintenanceDeckRules(scope: CardMaintenanceScope) throws {
        guard let expected = scope.expectedDeckFilter else {
            return
        }
        let database = try requireLocalDatabase(database: self.database)
        guard let current = try database.loadOptionalDeck(workspaceId: scope.workspaceId, deckId: scope.target) else {
            throw CardMaintenanceError.targetNotFound
        }
        guard current.filterDefinition.version == expected.version,
              Set(current.filterDefinition.tags) == Set(expected.tags) else {
            throw CardMaintenanceError.deckRulesChanged
        }
    }

    private func withCardMaintenanceSession<Result>(
        scope: CardMaintenanceScope,
        operation: (CloudLinkedSession, UUID) async throws -> Result
    ) async throws -> Result {
        guard self.workspace?.workspaceId == scope.workspaceId else {
            throw CardMaintenanceError.workspaceChanged
        }
        guard self.cloudSettings?.cloudState == .linked else {
            throw CardMaintenanceError.signInRequired
        }
        if self.cloudRuntime.activeCloudSession() == nil {
            let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
            try await self.restoreCloudLinkFromStoredCredentials(trigger: trigger)
        }

        let syncGeneration = self.cloudRuntime.syncGeneration
        guard let activeSession = self.cloudRuntime.activeCloudSession() else {
            throw CardMaintenanceError.signInRequired
        }
        try self.checkCurrentCardMaintenanceSession(scope: scope, session: activeSession)
        return try await self.withCurrentCloudSession(linkedSession: activeSession, syncGeneration: syncGeneration) { session in
            return try await operation(session, syncGeneration)
        }
    }

    private func checkCurrentCardMaintenanceSession(scope: CardMaintenanceScope, session: CloudLinkedSession) throws {
        try Task.checkCancellation()
        guard self.workspace?.workspaceId == scope.workspaceId,
              session.workspaceId == scope.workspaceId,
              let activeSession = self.cloudRuntime.activeCloudSession(),
              cloudLinkedSessionsMatchStableContext(activeSession, session) else {
            throw CardMaintenanceError.workspaceChanged
        }
        guard self.cloudSettings?.cloudState == .linked,
              session.authorization.isGuest == false else {
            throw CardMaintenanceError.signInRequired
        }
    }

    private func checkCardMaintenancePreviewSession(preview: CardMaintenancePreview, session: CloudLinkedSession) throws {
        guard preview.userId == session.userId, preview.apiBaseUrl == session.apiBaseUrl else {
            throw CardMaintenanceError.workspaceChanged
        }
    }

    private func syncCardMaintenanceWorkspace(
        scope: CardMaintenanceScope,
        session: CloudLinkedSession,
        syncGeneration: UUID,
        refreshToken: String?
    ) async throws {
        let trigger = self.technicalErrorModalCloudSyncTrigger(now: Date())
        do {
            try self.cloudRuntime.checkSyncGeneration(syncGeneration)
            try self.checkCurrentCardMaintenanceSession(scope: scope, session: session)
            let syncResult = try await self.runFreshLinkedSyncAfterActiveSyncSettles(linkedSession: session)
            try self.checkCurrentCardMaintenanceSession(scope: scope, session: session)
            try await self.applyCurrentLinkedSyncResult(
                syncResult: syncResult,
                linkedSession: session,
                syncGeneration: syncGeneration,
                now: Date(),
                trigger: trigger
            )
            try self.cloudRuntime.checkSyncGeneration(syncGeneration)
            try self.checkCurrentCardMaintenanceSession(scope: scope, session: session)
            try self.finishCardMaintenanceRefresh(linkedSession: session, token: refreshToken)
        } catch {
            if self.cloudRuntime.isCurrentSyncGeneration(syncGeneration),
               self.workspace?.workspaceId == scope.workspaceId,
               let activeSession = self.cloudRuntime.activeCloudSession(),
               cloudLinkedSessionsMatchStableContext(activeSession, session),
               (error is CardMaintenanceError) == false,
               isRequestCancellationError(error: error) == false {
                self.syncStatus = self.transitionSyncStatusForCloudFailure(error: error, trigger: trigger)
            }
            throw error
        }
    }
}

private func isDefinitiveCardMaintenanceRejection(error: Error) -> Bool {
    if let error = error as? CardMaintenanceError {
        switch error {
        case .previewChanged, .confirmationInvalid:
            return true
        default:
            return false
        }
    }
    guard let error = error as? CloudSyncError,
          case .invalidResponse(let details, let statusCode) = error,
          let code = details.code,
          code.isEmpty == false else {
        return false
    }
    return (400..<500).contains(statusCode) && statusCode != 408
}
