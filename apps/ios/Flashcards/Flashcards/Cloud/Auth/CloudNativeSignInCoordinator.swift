import Foundation
import Observation

enum CloudNativeSignInStage {
    case idle
    case preparingProvider(CloudAuthProvider)
    case requestingProviderCredential(CloudAuthProvider)
    case credentialReceived(CloudAuthProvider)
    case mailboxRequired(CloudAuthProvider, CloudSocialMailboxReason)
    case mailboxCodeSent(CloudAuthProvider)
    case sessionAccepted(CloudSignInMethod)
    case preparingAccount(CloudSignInMethod)
    case workspaceSelectionRequired(CloudSignInMethod)
    case completingAccount(CloudSignInMethod)
    case accountReady(CloudSignInMethod)
}

enum CloudNativeSignInResult {
    case mailboxRequired(CloudSocialMailboxChallenge)
    case sessionAccepted(CloudVerifiedAuthContext)
}

struct CloudNativeSignInAccount {
    let userId: String
    let workspaceId: String
}

private struct CloudPendingNativeSession {
    let method: CloudSignInMethod
    let verifiedContext: CloudVerifiedAuthContext
    let hint: CloudSuccessfulSignInHint?
}

@MainActor
@Observable
final class CloudNativeSignInCoordinator {
    private(set) var stage: CloudNativeSignInStage = .idle {
        didSet { self.onStageChanged?(self.stage) }
    }
    @ObservationIgnored var onStageChanged: ((CloudNativeSignInStage) -> Void)?
    @ObservationIgnored var onProviderRequested: ((CloudAuthProvider) -> Void)?
    private(set) var isWorking = false
    private(set) var mailboxChallenge: CloudSocialMailboxChallenge?
    private(set) var linkContext: CloudWorkspaceLinkContext?
    private(set) var completedAccount: CloudNativeSignInAccount?
    private(set) var connectionSuggestion: CloudPendingConnectionSuggestion?
    private(set) var rememberedHint: CloudSuccessfulSignInHint?
    @ObservationIgnored private let social: CloudSocialAuthService
    @ObservationIgnored private let email: CloudAuthService
    @ObservationIgnored private let hintStore: CloudSignInHintStore
    @ObservationIgnored private let apple = CloudAppleAuthProvider()
    @ObservationIgnored private let google = CloudGoogleAuthProvider()
    @ObservationIgnored private var epoch = UUID()
    @ObservationIgnored private var operationId: UUID?
    @ObservationIgnored private var configuration: CloudServiceConfiguration?
    @ObservationIgnored private var pending: CloudPendingNativeSession?
    @ObservationIgnored private var pendingConnectionSuggestion: CloudPendingConnectionSuggestion?
    @ObservationIgnored private var acceptedHint: CloudSuccessfulSignInHint?

    init(social: CloudSocialAuthService, email: CloudAuthService, hintStore: CloudSignInHintStore) {
        self.social = social
        self.email = email
        self.hintStore = hintStore
    }

    func availableConnectionSuggestion(store: FlashcardsStore) -> CloudPendingConnectionSuggestion? {
        guard let suggestion = self.connectionSuggestion,
              suggestion.configuration == (try? store.currentCloudServiceConfiguration()),
              suggestion.credentials == (try? store.cloudRuntime.loadCredentials()),
              store.cloudSettings?.cloudState == .linked,
              let expiry = parseIsoTimestamp(value: suggestion.suggestion.expiresAt), expiry > Date() else { return nil }
        return suggestion
    }

    func clearConnectionSuggestion() { self.connectionSuggestion = nil }

    func finishPresentation() {
        let suggestion = self.completedAccount == nil ? nil : self.connectionSuggestion
        self.resetPendingSignIn()
        self.connectionSuggestion = suggestion
    }

    func loadRememberedHint() throws {
        self.rememberedHint = try self.hintStore.load()
    }

    func forgetRememberedHint() throws {
        try self.hintStore.clear()
        self.rememberedHint = nil
    }

    func resetPendingSignIn() {
        self.epoch = UUID()
        self.operationId = nil
        self.isWorking = false
        self.connectionSuggestion = nil
        self.pendingConnectionSuggestion = nil
        self.configuration = nil
        self.pending = nil
        self.mailboxChallenge = nil
        self.linkContext = nil
        self.completedAccount = nil
        self.acceptedHint = nil
        self.stage = .idle
        self.email.resetChallengeSession()
    }

    func beginProviderSignIn(
        provider: CloudAuthProvider,
        configuration: CloudServiceConfiguration,
        presentation: CloudNativeAuthPresentation
    ) async throws -> CloudNativeSignInResult {
        guard !self.isWorking else { throw CloudNativeAuthError.alreadyInProgress }
        self.resetPendingSignIn()
        self.configuration = configuration
        return try await self.perform { epoch in
            self.stage = .preparingProvider(provider)
            let methods = try await self.social.metadata(client: .currentNative, authBaseUrl: configuration.authBaseUrl)
            try self.checkCurrent(epoch)
            let login = try await self.social.beginLogin(provider: provider, methods: methods, authBaseUrl: configuration.authBaseUrl)
            try self.checkCurrent(epoch)
            self.stage = .requestingProviderCredential(provider)
            let onProviderRequested = self.onProviderRequested
            let proof: CloudSocialProviderProof
            switch provider {
            case .apple:
                proof = try await self.apple.authorize(login: login, methods: methods, presentation: presentation,
                    onRequested: { onProviderRequested?(provider) })
            case .google:
                proof = try await self.google.authorize(login: login, methods: methods, presentation: presentation,
                    onRequested: { onProviderRequested?(provider) })
            }
            try self.checkCurrent(epoch)
            self.stage = .credentialReceived(provider)
            let continuation = try await self.social.submitProof(login: login, proof: proof)
            try self.checkCurrent(epoch)
            switch continuation {
            case .verificationRequired(let challenge):
                self.mailboxChallenge = challenge
                self.stage = .mailboxRequired(provider, challenge.reason)
                return .mailboxRequired(challenge)
            case .completed(let completion):
                return .sessionAccepted(try await self.redeem(completion, epoch: epoch))
            }
        }
    }

    func sendMailboxCode(email: String) async throws {
        try await self.perform { epoch in
            guard let challenge = self.mailboxChallenge else {
                throw LocalStoreError.uninitialized("Provider mailbox verification is unavailable")
            }
            try await self.social.sendMailboxCode(challenge: challenge, email: email)
            try self.checkCurrent(epoch)
            self.stage = .mailboxCodeSent(challenge.login.provider)
        }
    }

    func verifyMailboxCode(code: String) async throws -> CloudVerifiedAuthContext {
        try await self.perform { epoch in
            guard let challenge = self.mailboxChallenge else {
                throw LocalStoreError.uninitialized("Provider mailbox verification is unavailable")
            }
            let completion = try await self.social.verifyMailboxCode(challenge: challenge, code: code)
            try self.checkCurrent(epoch)
            return try await self.redeem(completion, epoch: epoch)
        }
    }

    func verifyEmailCode(
        challenge: CloudOtpChallenge,
        code: String,
        configuration: CloudServiceConfiguration
    ) async throws -> CloudVerifiedAuthContext {
        guard !self.isWorking else { throw CloudNativeAuthError.alreadyInProgress }
        self.resetPendingSignIn()
        self.configuration = configuration
        return try await self.perform { epoch in
            let session = try await self.email.verifyCodeSession(challenge: challenge, code: code,
                authBaseUrl: configuration.authBaseUrl)
            try self.checkCurrent(epoch)
            let context = CloudVerifiedAuthContext(apiBaseUrl: configuration.apiBaseUrl, credentials: session.credentials)
            self.pending = CloudPendingNativeSession(method: .email, verifiedContext: context,
                hint: session.signInHint.map { CloudSuccessfulSignInHint(email: $0) })
            self.stage = .sessionAccepted(.email)
            return context
        }
    }

    func prepareAccount(store: FlashcardsStore) async throws -> CloudWorkspaceLinkContext {
        try await self.perform { epoch in
            let pending = try self.requirePendingSession(store: store)
            guard self.completedAccount == nil else {
                throw LocalStoreError.validation("This sign-in has already completed")
            }
            self.stage = .preparingAccount(pending.method)
            let context = try await store.prepareCloudLink(verifiedContext: pending.verifiedContext)
            try self.checkCurrent(epoch)
            self.linkContext = context
            let automaticWorkspaceId = context.demoOnlyDestinationWorkspaceId
                ?? (context.postAuthRecoveryRoute == .pendingGuestUpgradeRecovery && context.guestUpgradeMode == nil
                    ? context.workspaces.first?.workspaceId : nil)
            if let workspaceId = automaticWorkspaceId {
                _ = try await self.finishAccount(
                    store: store,
                    selection: .existing(workspaceId: workspaceId),
                    captureContext: nil,
                    epoch: epoch
                )
            } else {
                self.stage = .workspaceSelectionRequired(pending.method)
            }
            return context
        }
    }

    func completeAccount(
        store: FlashcardsStore,
        selection: CloudWorkspaceLinkSelection,
        captureContext: TechnicalErrorCaptureContext?
    ) async throws -> CloudLinkedSession {
        try await self.perform { epoch in
            let session = try await self.finishAccount(
                store: store,
                selection: selection,
                captureContext: captureContext,
                epoch: epoch
            )
            try self.rememberAcceptedSession()
            return session
        }
    }

    private func finishAccount(
        store: FlashcardsStore,
        selection: CloudWorkspaceLinkSelection,
        captureContext: TechnicalErrorCaptureContext?,
        epoch: UUID
    ) async throws -> CloudLinkedSession {
        let pending = try self.requirePendingSession(store: store)
        guard let context = self.linkContext, self.completedAccount == nil else {
            throw LocalStoreError.uninitialized("Prepared sign-in workspace selection is unavailable")
        }
        self.stage = .completingAccount(pending.method)
        if context.guestUpgradeMode != nil {
            try await store.completeGuestCloudLink(
                linkContext: context,
                selection: selection,
                technicalErrorCaptureContext: captureContext
            )
        } else {
            try await store.completeCloudLink(
                linkContext: context,
                selection: selection,
                technicalErrorCaptureContext: captureContext
            )
        }
        try self.checkCurrent(epoch)
        _ = try self.requirePendingSession(store: store)
        guard let session = store.cloudRuntime.activeCloudSession(),
              case .bearer = session.authorization,
              session.userId == context.userId, session.apiBaseUrl == context.apiBaseUrl,
              session.configurationMode == self.configuration?.mode,
              store.cloudSettings?.cloudState == .linked,
              store.cloudSettings?.linkedUserId == session.userId,
              store.workspace?.workspaceId == session.workspaceId else {
            throw LocalStoreError.validation("The completed sign-in did not accept its linked account and workspace")
        }
        self.completedAccount = CloudNativeSignInAccount(userId: session.userId, workspaceId: session.workspaceId)
        self.connectionSuggestion = self.pendingConnectionSuggestion
        self.pendingConnectionSuggestion = nil
        self.acceptedHint = pending.hint
        self.pending = nil
        self.linkContext = nil
        self.stage = .accountReady(pending.method)
        return session
    }

    // A storage failure can be retried without repeating the completed workspace transition.
    func rememberAcceptedSession() throws {
        guard self.completedAccount != nil else {
            throw LocalStoreError.uninitialized("A successful linked sign-in is required to remember its hint")
        }
        guard let hint = self.acceptedHint else { return }
        try self.hintStore.save(hint)
        self.rememberedHint = hint
    }

    private func redeem(_ completion: CloudSocialCompletion, epoch: UUID) async throws -> CloudVerifiedAuthContext {
        guard let configuration = self.configuration else {
            throw LocalStoreError.uninitialized("The original sign-in server configuration is unavailable")
        }
        let session = try await self.social.redeem(completion: completion)
        try self.checkCurrent(epoch)
        let context = CloudVerifiedAuthContext(apiBaseUrl: configuration.apiBaseUrl, credentials: session.credentials)
        let method = CloudSignInMethod(provider: completion.login.provider)
        self.pending = CloudPendingNativeSession(method: method, verifiedContext: context,
            hint: CloudSuccessfulSignInHint(social: session.signInHint))
        self.pendingConnectionSuggestion = session.connectionSuggestion.map {
            CloudPendingConnectionSuggestion(suggestion: $0, binding: completion.login.binding,
                configuration: configuration, credentials: session.credentials)
        }
        self.mailboxChallenge = nil
        self.stage = .sessionAccepted(method)
        return context
    }

    private func requirePendingSession(store: FlashcardsStore) throws -> CloudPendingNativeSession {
        guard let pending = self.pending, let configuration = self.configuration,
              try store.currentCloudServiceConfiguration() == configuration else {
            throw LocalStoreError.validation("The sign-in session is unavailable or its server configuration changed")
        }
        return pending
    }

    private func checkCurrent(_ epoch: UUID) throws {
        try Task.checkCancellation()
        guard self.epoch == epoch else { throw CancellationError() }
    }

    private func perform<Result>(_ operation: (UUID) async throws -> Result) async throws -> Result {
        guard !self.isWorking else { throw CloudNativeAuthError.alreadyInProgress }
        let operationId = UUID()
        let epoch = self.epoch
        self.operationId = operationId
        self.isWorking = true
        defer {
            if self.operationId == operationId {
                self.operationId = nil
                self.isWorking = false
            }
        }
        try self.checkCurrent(epoch)
        return try await operation(epoch)
    }
}
