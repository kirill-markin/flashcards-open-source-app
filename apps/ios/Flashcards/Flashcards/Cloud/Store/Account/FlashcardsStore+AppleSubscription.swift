import Foundation

struct AppleSubscriptionIdentity: Equatable {
    let userId: String
    let configurationMode: CloudServiceConfigurationMode
    let apiBaseUrl: String
    let isGuest: Bool
    let generation: Int
}

@MainActor
extension FlashcardsStore {
    func prepareAppleSubscriptionIdentity() async throws -> AppleSubscriptionIdentity {
        try Task.checkCancellation()
        try self.throwIfCloudCredentialRecoveryRequired()
        try self.throwIfCustomGuestWorkspacePaused()
        if case .blocked(let message) = self.syncStatus {
            throw LocalStoreError.validation(message)
        }
        guard self.accountDeletionState == .hidden else {
            throw AppleSubscriptionError.accountUnavailable
        }
        if self.cloudSettings?.cloudState == .guest || self.cloudSettings?.cloudState == .linked {
            return try self.appleSubscriptionIdentity()
        }

        // A disconnected install may still be recovering a linked identity. Only the ordinary
        // local-only state may adopt a guest; the existing recovery/link flows keep ownership.
        guard let settings = self.cloudSettings, settings.cloudState == .disconnected,
              try self.cloudRuntime.loadCredentials() == nil,
              try self.loadPendingGuestUpgradeState() == nil else {
            throw AppleSubscriptionError.accountUnavailable
        }
        let configuration = try self.currentCloudServiceConfiguration()
        let restored = try await self.restoreGuestCloudSessionIfNeeded(
            trigger: CloudSyncTrigger(
                source: .manualSyncNow,
                now: Date(),
                extendsFastPolling: false,
                allowsVisibleChangeBanner: false,
                surfacesGlobalErrorMessage: false,
                capturesTechnicalFailures: false
            )
        )
        try Task.checkCancellation()
        guard self.cloudSettings?.installationId == settings.installationId,
              self.accountDeletionState == .hidden else {
            throw AppleSubscriptionError.identityChanged
        }
        let identity = try self.appleSubscriptionIdentity()
        guard identity.isGuest,
              identity.configurationMode == configuration.mode,
              identity.apiBaseUrl == configuration.apiBaseUrl else {
            throw AppleSubscriptionError.identityChanged
        }
        try self.requireAppleSubscriptionSession(restored.session, identity: identity)
        return identity
    }

    func appleSubscriptionIdentity() throws -> AppleSubscriptionIdentity {
        guard let settings = self.cloudSettings,
              settings.cloudState == .guest || settings.cloudState == .linked,
              let userId = settings.linkedUserId, userId.isEmpty == false else {
            throw AppleSubscriptionError.accountUnavailable
        }
        let configuration = try self.currentCloudServiceConfiguration()
        return AppleSubscriptionIdentity(
            userId: userId,
            configurationMode: configuration.mode,
            apiBaseUrl: configuration.apiBaseUrl,
            isGuest: settings.cloudState == .guest,
            // This generation changes at the shared account-preferences identity boundary,
            // including leaving and returning to the same account during an Apple sheet.
            generation: self.accentColorIdentityGeneration
        )
    }

    func requireAppleSubscriptionIdentity(_ identity: AppleSubscriptionIdentity) throws {
        try Task.checkCancellation()
        guard (try? self.appleSubscriptionIdentity()) == identity else {
            throw AppleSubscriptionError.identityChanged
        }
    }

    func appleSubscriptionAccountToken(
        identity: AppleSubscriptionIdentity,
        transport: CloudSyncTransport
    ) async throws -> UUID {
        try await self.withAppleSubscriptionSession(identity: identity) { session in
            try await transport.appleBillingAccountToken(session: session)
        }
    }

    func attachAppleSubscription(
        signedTransaction: String,
        intent: AppleBillingTransactionIntent,
        identity: AppleSubscriptionIdentity,
        transport: CloudSyncTransport
    ) async throws {
        try await self.withAppleSubscriptionSession(identity: identity) { session in
            try await transport.attachAppleBillingTransaction(
                signedTransaction: signedTransaction,
                intent: intent,
                session: session
            )
        }
    }

    func refreshAppleSubscriptionEntitlement(identity: AppleSubscriptionIdentity) async throws {
        await self.cloudRuntime.waitForActiveCloudSyncToSettle()
        try self.requireAppleSubscriptionIdentity(identity)
        let syncResult = try await self.withAppleSubscriptionSession(identity: identity) { session in
            try self.throwIfCustomGuestWorkspacePausedDuringSync(linkedSession: session)
            let result = try await self.cloudRuntime.runLinkedSync(linkedSession: session)
            try self.requireAppleSubscriptionIdentity(identity)
            self.applyPulledCloudEntitlement(syncResult: result, linkedSession: session)
            return result
        }
        try self.requireAppleSubscriptionIdentity(identity)
        try await self.applySyncResultWithoutBlockingReset(
            syncResult: syncResult,
            now: Date(),
            trigger: self.manualCloudSyncTrigger(now: Date())
        )
        try self.requireAppleSubscriptionIdentity(identity)
        // Keep cached offline access, but never complete a purchase using that cache as confirmation.
        guard syncResult.entitlement != nil else { throw AppleSubscriptionError.entitlementNotConfirmed }
    }

    private func withAppleSubscriptionSession<Result>(
        identity: AppleSubscriptionIdentity,
        operation: (CloudLinkedSession) async throws -> Result
    ) async throws -> Result {
        try self.requireAppleSubscriptionIdentity(identity)
        guard let session = try await self.cloudSessionForAccountContextRefresh() else {
            throw AppleSubscriptionError.accountUnavailable
        }
        try self.requireAppleSubscriptionIdentity(identity)
        let result: Result
        if identity.isGuest {
            try self.requireAppleSubscriptionSession(session, identity: identity)
            result = try await operation(session)
        } else {
            // The ordinary bearer refresh can replay its closure after a 401. Validate inside
            // that closure so neither its first send nor its replay can use a replacement account.
            result = try await self.withStoredAuthenticatedCredentials { credentials, configuration in
                try self.requireAppleSubscriptionIdentity(identity)
                guard configuration.mode == identity.configurationMode,
                      configuration.apiBaseUrl == identity.apiBaseUrl else {
                    throw AppleSubscriptionError.identityChanged
                }
                let refreshedSession = try self.cloudRuntime.sessionWithUpdatedBearerToken(credentials: credentials)
                try self.requireAppleSubscriptionSession(refreshedSession, identity: identity)
                return try await operation(refreshedSession)
            }
        }
        try self.requireAppleSubscriptionIdentity(identity)
        return result
    }

    private func requireAppleSubscriptionSession(
        _ session: CloudLinkedSession,
        identity: AppleSubscriptionIdentity
    ) throws {
        try self.requireAppleSubscriptionIdentity(identity)
        guard session.userId == identity.userId,
              session.configurationMode == identity.configurationMode,
              session.apiBaseUrl == identity.apiBaseUrl,
              session.authorization.isGuest == identity.isGuest else {
            throw AppleSubscriptionError.identityChanged
        }
    }
}
