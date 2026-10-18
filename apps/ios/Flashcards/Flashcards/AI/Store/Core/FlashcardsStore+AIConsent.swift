import Foundation

typealias AIConsentReceiptProvider = @MainActor @Sendable (CloudLinkedSession) throws -> String

@MainActor
extension FlashcardsStore {
    var aiConsent: AIConsentStore {
        if let cachedAIConsentStore { return cachedAIConsentStore }
        let consent = AIConsentStore(userDefaults: self.userDefaults)
        self.cachedAIConsentStore = consent
        return consent
    }

    var hasAIDataSharingConsent: Bool {
        guard self.aiConsent.hasAcknowledgedGrant, let owner = self.aiConsent.currentDecision?.owner else { return false }
        if self.cloudSettings?.cloudState == .linked {
            return owner.userId == self.cloudSettings?.linkedUserId
        }
        if let session = self.cloudRuntime.activeCloudSession() {
            return owner == AIConsentActor(session: session)
        }
        return self.cloudSettings?.cloudState == .guest && owner.userId == self.cloudSettings?.linkedUserId
    }

    func allowAIDataSharing(disclosure: AIConsentDisclosure) {
        guard !self.aiConsent.isSaving else { return }
        do {
            if self.aiConsent.currentDecision?.evidence.action != .grant || !self.aiConsent.hasPendingDecisions {
                try self.aiConsent.record(action: .grant, disclosure: disclosure, actor: self.knownAIConsentActor())
            }
            self.retryAIConsentSync()
        } catch {
            self.presentAIConsentFailure(error: error)
        }
    }

    func withdrawAIDataSharing(disclosure: AIConsentDisclosure) {
        self.aiConsent.blockSharing()
        do {
            try self.aiConsent.record(
                action: .withdraw, disclosure: disclosure,
                actor: self.knownAIConsentActor()
            )
        } catch {
            self.presentAIConsentFailure(error: error)
        }
        self.cachedAIChatStore?.cancelStreaming()
        self.cachedAIChatStore?.cancelDictation()
        self.cachedAIChatStore?.refreshExternalProviderConsentState()
        self.retryAIConsentSync()
    }

    func retryAIConsentSync() {
        guard self.aiConsent.hasPendingDecisions, self.aiConsentRegistrationTask == nil else { return }
        let identityId = self.aiConsent.ledger?.identityId
        self.aiConsent.isSaving = true
        self.aiConsentRegistrationTask = Task { @MainActor in
            var didSave = false
            defer {
                if self.aiConsent.ledger?.identityId == identityId {
                    self.aiConsent.isSaving = false
                    self.aiConsentRegistrationTask = nil
                    if didSave && self.aiConsent.hasPendingDecisions { self.retryAIConsentSync() }
                }
            }
            do {
                _ = try await self.resumePendingGuestUpgradeIfNeeded(trigger: self.manualCloudSyncTrigger(now: Date()))
                try Task.checkCancellation()
                let session = try await self.cloudSessionForAI()
                try Task.checkCancellation()
                guard self.aiConsent.ledger?.identityId == identityId else { throw AIConsentError.identityChanged }
                try await self.aiConsent.flush(session: session)
                didSave = true
                self.cachedAIChatStore?.refreshExternalProviderConsentState()
            } catch {
                if self.aiConsent.ledger?.identityId == identityId, !Task.isCancelled {
                    self.presentAIConsentFailure(error: error)
                }
            }
        }
    }

    func flushGuestAIConsentBeforeUpgrade(guest: StoredGuestCloudSession) async throws {
        if let registrationTask = self.aiConsentRegistrationTask { await registrationTask.value }
        try Task.checkCancellation()
        try await self.aiConsent.flush(session: CloudLinkedSession(
            userId: guest.userId, workspaceId: guest.workspaceId, email: nil,
            configurationMode: guest.configurationMode, apiBaseUrl: guest.apiBaseUrl,
            authorization: .guest(guest.guestToken)
        ))
        try Task.checkCancellation()
        guard !self.aiConsent.hasPendingDecisions else { throw AIConsentError.required }
    }

    func resetAIConsentIdentity() throws {
        self.aiConsentRegistrationTask?.cancel()
        self.aiConsentRegistrationTask = nil
        self.cachedAIChatStore?.cancelStreaming()
        self.cachedAIChatStore?.cancelDictation()
        try self.aiConsent.resetIdentity()
    }

    private func knownAIConsentActor() throws -> AIConsentActor? {
        if let pendingUpgrade = try self.loadPendingGuestUpgradeState(), pendingUpgrade.requiresCompletion {
            // The checkpoint follows the guest flush and binds later choices to the verified destination.
            return AIConsentActor(userId: pendingUpgrade.common.userId, apiBaseUrl: pendingUpgrade.common.apiBaseUrl)
        }
        return self.aiConsent.currentDecision?.owner
            ?? self.cloudRuntime.activeCloudSession().map { AIConsentActor(session: $0) }
    }

    private func presentAIConsentFailure(error: Error) {
        self.aiConsent.failureMessage = self.aiConsent.currentDecision?.evidence.action == .withdraw
            ? aiSettingsLocalized("ai.consent.withdrawalFailed", "AI data sharing is off on this device. Your choice has not synced yet; try again when connected.")
            : aiSettingsLocalized("ai.consent.saveFailed", "Your choice could not be saved. Try again before using AI.")
        logAIChatStoreEvent(action: "ai_consent_sync_failed", metadata: ["error": String(describing: error)])
    }
}
