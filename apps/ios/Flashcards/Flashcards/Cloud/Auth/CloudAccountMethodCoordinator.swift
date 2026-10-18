import Foundation
import Observation

enum CloudAccountMethodStage {
    case idle, loading, ready
    case preparingReauthentication, requestingProvider(CloudAuthProvider)
    case currentEmailCodeSent
    case mailboxRequired, sendingMailboxCode, mailboxCodeSent, verifyingCode
    case proofReady, mutating
    case finished(CloudAccountMethodOperation)
    case failed(Error)
}

enum CloudAccountMethodObservation {
    case providerRequested(CloudAuthProvider)
    case providerFinished(CloudAuthProvider, AnalyticsAuthProviderOutcome)
    case mutationConfirmed(CloudAccountMethodMutation, CloudAuthProvider)
    case codeRequestFinished(CloudSignInMethod, AnalyticsAuthCodeRequestOutcome)
    case codeVerificationFinished(CloudSignInMethod, AnalyticsAuthCodeVerificationOutcome)
    case linkFinished(CloudAuthProvider, AnalyticsAuthAccountLinkOutcome)
}

private struct AccountManagementContext {
    let configuration: CloudServiceConfiguration
    let credentials: StoredCloudCredentials
    let userId: String
    let email: String?
}

@MainActor
@Observable
final class CloudAccountMethodCoordinator {
    private(set) var isConnecting = false
    private(set) var connectionPreview: CloudConnectionPreview?
    private(set) var connectionEmail: String?
    private(set) var connectionOutcome: CloudConnectionOutcome?
    private(set) var connectionOperation: String?
    private(set) var connectionConfirmation: CloudConnectionPreview?
    @ObservationIgnored private var connectionBinding: CloudAuthAttemptBinding?
    private(set) var stage: CloudAccountMethodStage = .idle
    private(set) var isWorking = false
    private(set) var methods: CloudAccountLoginMethods?
    private(set) var mailboxChallenge: CloudAccountMailboxChallenge?
    private(set) var refreshError: Error?
    private(set) var confirmedOperation: CloudAccountMethodOperation?
    @ObservationIgnored var onObservation: ((CloudAccountMethodObservation) -> Void)?
    @ObservationIgnored private let service: CloudAccountMethodService
    @ObservationIgnored private let social: CloudSocialAuthService
    @ObservationIgnored private unowned let store: FlashcardsStore
    @ObservationIgnored private let apple = CloudAppleAuthProvider()
    @ObservationIgnored private let google = CloudGoogleAuthProvider()
    @ObservationIgnored private var context: AccountManagementContext?
    @ObservationIgnored private var epoch = UUID()
    @ObservationIgnored private var operationId: UUID?
    @ObservationIgnored private var operation: CloudAccountMethodOperation?
    @ObservationIgnored private var receipt: CloudAccountReauthenticationReceipt?
    @ObservationIgnored private var emailAttempt: (CloudAccountEmailAttempt, CloudAuthAttemptBinding)?

    init(service: CloudAccountMethodService, social: CloudSocialAuthService, store: FlashcardsStore) {
        self.service = service
        self.social = social
        self.store = store
    }

    var canReauthenticateWithCurrentEmail: Bool {
        guard (try? self.checkCurrent(self.epoch)) != nil,
              let email = self.context?.email, let methods = self.methods else { return false }
        return methods.verifiedRecoveryEmails.contains(email)
    }

    var activeReenableMethodAfterFailure: CloudAccountProviderMethod? {
        guard case .failed = self.stage, case .some(.reenable(let target)) = self.operation else { return nil }
        return self.methods?.methods.first { method in
            method.provider == target.provider && method.providerSubject == target.providerSubject && method.status == .active
        }
    }

    func cancel() {
        self.isConnecting = false
        self.connectionPreview = nil
        self.connectionEmail = nil
        self.connectionOutcome = nil
        self.connectionOperation = nil
        self.connectionConfirmation = nil
        self.connectionBinding = nil
        self.epoch = UUID()
        self.operationId = nil
        self.isWorking = false
        self.context = nil
        self.methods = nil
        self.refreshError = nil
        self.confirmedOperation = nil
        self.clearProof()
        self.operation = nil
        self.stage = .idle
    }

    func load() async throws {
        guard !self.isWorking else { throw CloudNativeAuthError.alreadyInProgress }
        self.cancel()
        self.context = try self.captureContext()
        try await self.perform { epoch in
            self.stage = .loading
            try await self.refreshMethods(epoch: epoch)
            self.stage = .ready
        }
    }

    func beginProviderReauthentication(provider: CloudAuthProvider, operation: CloudAccountMethodOperation?,
        presentation: CloudNativeAuthPresentation
    ) async throws {
        try await self.perform { epoch in
            try await self.prepareReauthentication(operation: operation, epoch: epoch)
            let context = try self.checkCurrent(epoch)
            let metadata = try await self.social.metadata(client: .currentNative, authBaseUrl: context.configuration.authBaseUrl)
            _ = try self.checkCurrent(epoch)
            let binding = try CloudAuthAttemptBinding.generate(client: .currentNative)
            let attempt = try await self.service.beginProvider(provider: provider, purpose: .reauth, binding: binding,
                operation: nil, proof: nil, authBaseUrl: context.configuration.authBaseUrl, bearer: context.credentials.idToken)
            _ = try self.checkCurrent(epoch)
            let proof = try await self.authorize(attempt: attempt, metadata: metadata, presentation: presentation, epoch: epoch)
            let response = try await self.service.submitProvider(attempt: attempt, proof: proof, operation: nil,
                authBaseUrl: context.configuration.authBaseUrl, bearer: context.credentials.idToken)
            _ = try self.checkCurrent(epoch)
            guard let response else { throw CloudAccountMethodError.invalidPhase }
            try await self.accept(response, attempt: attempt, epoch: epoch)
        }
    }

    func beginCurrentEmailReauthentication(operation: CloudAccountMethodOperation?) async throws {
        try await self.perform { epoch in
            try await self.prepareReauthentication(operation: operation, epoch: epoch)
            guard self.canReauthenticateWithCurrentEmail else { throw CloudAccountMethodError.currentEmailUnavailable }
            let context = try self.checkCurrent(epoch)
            let binding = try CloudAuthAttemptBinding.generate(client: .currentNative)
            let attempt: CloudAccountEmailAttempt
            do {
                attempt = try await self.service.beginEmail(binding: binding,
                    authBaseUrl: context.configuration.authBaseUrl, bearer: context.credentials.idToken)
            } catch {
                try self.observeCodeRequestFailure(error, method: .email, epoch: epoch)
                throw error
            }
            _ = try self.checkCurrent(epoch)
            self.onObservation?(.codeRequestFinished(.email, .accepted))
            self.emailAttempt = (attempt, binding)
            self.stage = .currentEmailCodeSent
        }
    }

    func verifyCurrentEmailCode(_ code: String) async throws {
        try await self.perform { epoch in
            guard case .currentEmailCodeSent = self.stage, let (attempt, binding) = self.emailAttempt else {
                throw CloudAccountMethodError.invalidPhase
            }
            try self.validateCode(code)
            let context = try self.checkCurrent(epoch)
            self.emailAttempt = nil
            self.stage = .verifyingCode
            let completion: CloudAccountProofCompletion
            do {
                completion = try await self.service.completeEmail(attempt: attempt, binding: binding, code: code,
                    authBaseUrl: context.configuration.authBaseUrl, bearer: context.credentials.idToken)
            } catch {
                try self.observeCodeVerificationFailure(error, method: .email, epoch: epoch)
                throw error
            }
            _ = try self.checkCurrent(epoch)
            self.onObservation?(.codeVerificationFinished(.email, .verified))
            self.receipt = CloudAccountReauthenticationReceipt(completion: completion.completion, binding: binding)
            self.stage = .proofReady
        }
    }

    func sendMailboxCode(email: String) async throws {
        try await self.perform { epoch in
            guard case .mailboxRequired = self.stage, let challenge = self.mailboxChallenge else {
                throw CloudAccountMethodError.invalidPhase
            }
            try requireCloudSocialContract(cloudAccountMailboxIsValid(email), "Enter a valid mailbox for verification")
            let context = try self.checkCurrent(epoch)
            self.stage = .sendingMailboxCode
            let method: CloudSignInMethod = challenge.attempt.provider == .apple ? .apple : .google
            do {
                try await self.service.sendMailbox(challenge: challenge, email: email,
                    authBaseUrl: context.configuration.authBaseUrl, bearer: context.credentials.idToken)
            } catch {
                try self.observeCodeRequestFailure(error, method: method, epoch: epoch)
                throw error
            }
            _ = try self.checkCurrent(epoch)
            self.onObservation?(.codeRequestFinished(method, .accepted))
            self.stage = .mailboxCodeSent
        }
    }

    func verifyMailboxCode(_ code: String) async throws {
        try await self.perform { epoch in
            guard case .mailboxCodeSent = self.stage, let challenge = self.mailboxChallenge else {
                throw CloudAccountMethodError.invalidPhase
            }
            try self.validateCode(code)
            let context = try self.checkCurrent(epoch)
            self.mailboxChallenge = nil
            self.stage = .verifyingCode
            let method: CloudSignInMethod = challenge.attempt.provider == .apple ? .apple : .google
            do {
                let response: CloudSocialContinuationResponse
                do {
                    response = try await self.service.verifyMailbox(challenge: challenge, code: code,
                        authBaseUrl: context.configuration.authBaseUrl, bearer: context.credentials.idToken)
                } catch {
                    try self.observeCodeVerificationFailure(error, method: method, epoch: epoch)
                    throw error
                }
                _ = try self.checkCurrent(epoch)
                guard case .completed = response else { throw CloudAccountMethodError.freshAttemptRequired }
                self.onObservation?(.codeVerificationFinished(method, .verified))
                try await self.accept(response, attempt: challenge.attempt, epoch: epoch)
            } catch {
                try self.observeLinkFailure(error, purpose: challenge.attempt.purpose, provider: challenge.attempt.provider, epoch: epoch)
                throw error
            }
        }
    }

    func performMutation(presentation: CloudNativeAuthPresentation) async throws {
        try await self.perform { epoch in
            guard case .proofReady = self.stage, let operation = self.operation, let receipt = self.receipt else {
                throw CloudAccountMethodError.invalidPhase
            }
            // Neither this receipt nor a provider credential survives any attempted mutation.
            self.receipt = nil
            self.stage = .mutating
            try await self.refreshMethods(epoch: epoch)
            try self.validateTarget(operation)
            let context = try self.checkCurrent(epoch)
            if case .unlink(let target) = operation {
                try await self.service.unlink(target: target, proof: receipt,
                    authBaseUrl: context.configuration.authBaseUrl, bearer: context.credentials.idToken)
                _ = try self.checkCurrent(epoch)
                try await self.finishMutation(operation, epoch: epoch)
                return
            }
            let metadata = try await self.social.metadata(client: .currentNative, authBaseUrl: context.configuration.authBaseUrl)
            _ = try self.checkCurrent(epoch)
            let binding = try CloudAuthAttemptBinding.generate(client: .currentNative)
            do {
                let attempt = try await self.service.beginProvider(provider: operation.provider, purpose: .link, binding: binding,
                    operation: operation, proof: receipt, authBaseUrl: context.configuration.authBaseUrl, bearer: context.credentials.idToken)
                _ = try self.checkCurrent(epoch)
                let proof = try await self.authorize(attempt: attempt, metadata: metadata, presentation: presentation, epoch: epoch)
                self.stage = .mutating
                let response = try await self.service.submitProvider(attempt: attempt, proof: proof, operation: operation,
                    authBaseUrl: context.configuration.authBaseUrl, bearer: context.credentials.idToken)
                _ = try self.checkCurrent(epoch)
                if let response { try await self.accept(response, attempt: attempt, epoch: epoch) }
                else { try await self.finishMutation(operation, epoch: epoch) }
            } catch {
                try self.observeLinkFailure(error, purpose: .link, provider: operation.provider, epoch: epoch)
                throw error
            }
        }
    }

    func selectConnection() throws {
        guard !self.isWorking else { throw CloudNativeAuthError.alreadyInProgress }
        _ = try self.checkCurrent(self.epoch)
        self.isConnecting = true
        self.operation = nil
        self.clearProof()
        self.stage = .ready
    }

    func beginConnection() async throws {
        try await self.perform { epoch in
            guard self.isConnecting, case .proofReady = self.stage, let receipt = self.receipt else {
                throw CloudAccountMethodError.invalidPhase
            }
            self.receipt = nil
            self.connectionBinding = receipt.binding
            try await self.requireConnectionCapability(epoch: epoch)
            try await self.acceptConnection(self.connectionRequest(.begin(receipt.completion)), epoch: epoch)
        }
    }

    func adoptConnectionSuggestion() async throws {
        try await self.perform { epoch in
            guard let suggestion = self.store.cloudNativeSignIn.availableConnectionSuggestion(store: self.store) else {
                throw CloudAccountMethodError.freshAttemptRequired
            }
            self.isConnecting = true
            self.connectionBinding = suggestion.binding
            try await self.requireConnectionCapability(epoch: epoch)
            try await self.acceptConnection(self.connectionRequest(.adopt(suggestion.suggestion.suggestion)), epoch: epoch)
        }
    }

    func proveConnectionProvider(_ provider: CloudAuthProvider, presentation: CloudNativeAuthPresentation) async throws {
        try await self.perform { epoch in
            let context = try self.checkCurrent(epoch)
            let metadata = try await self.social.metadata(client: .currentNative, authBaseUrl: context.configuration.authBaseUrl)
            _ = try self.checkCurrent(epoch)
            let response = try await self.connectionRequest(.providerBegin(provider))
            _ = try self.checkCurrent(epoch)
            guard case .providerRequired(let proof) = response, let binding = self.connectionBinding else {
                throw CloudAccountMethodError.invalidPhase
            }
            let pattern = provider == .apple ? "^[a-f0-9]{64}$" : "^[A-Za-z0-9_-]{43}$"
            try requireCloudSocialContract(proof.nonce.range(of: pattern, options: .regularExpression) != nil,
                "Invalid connection provider nonce")
            let attempt = CloudAccountProviderAttempt(provider: provider, purpose: .reauth, binding: binding, response: proof)
            let credential = try await self.authorize(attempt: attempt, metadata: metadata, presentation: presentation, epoch: epoch)
            try await self.acceptConnection(self.connectionRequest(.providerComplete(provider, proof.attempt, credential)), epoch: epoch)
        }
    }

    func sendConnectionEmail(_ email: String) async throws {
        try await self.perform { epoch in
            try requireCloudSocialContract(cloudAccountMailboxIsValid(email), "Invalid connection mailbox")
            try await self.acceptConnection(self.connectionRequest(.emailSend(email)), epoch: epoch)
        }
    }

    func verifyConnectionEmail(_ code: String) async throws {
        try await self.perform { epoch in
            try self.validateCode(code)
            self.connectionEmail = nil
            try await self.acceptConnection(self.connectionRequest(.emailVerify(code)), epoch: epoch)
        }
    }

    func previewConnection(omittedWorkspaceIds: [String]) async throws {
        try await self.perform { epoch in
            self.connectionPreview = nil
            self.connectionConfirmation = nil
            try await self.acceptConnection(self.connectionRequest(.preview(omittedWorkspaceIds)), epoch: epoch)
        }
    }

    func confirmConnection() async throws {
        try await self.perform { epoch in
            guard let preview = self.connectionPreview ?? self.connectionConfirmation else { throw CloudAccountMethodError.invalidPhase }
            self.connectionConfirmation = preview
            self.connectionPreview = nil
            try await self.acceptConnection(self.connectionRequest(.confirm(preview)), epoch: epoch)
        }
    }

    func cancelConnection() async throws {
        try await self.perform { epoch in
            try await self.acceptConnection(self.connectionRequest(.cancel), epoch: epoch)
        }
    }

    private func requireConnectionCapability(epoch: UUID) async throws {
        let context = try self.checkCurrent(epoch)
        let metadata = try await self.social.metadata(client: .currentNative, authBaseUrl: context.configuration.authBaseUrl)
        _ = try self.checkCurrent(epoch)
        try requireCloudSocialContract(metadata.supportsAccountConnection, "Account connection is unavailable on this server")
    }

    private func connectionRequest(_ action: CloudConnectionAction) async throws -> CloudConnectionResponse {
        let context = try self.checkCurrent(self.epoch)
        guard let binding = self.connectionBinding else { throw CloudAccountMethodError.invalidPhase }
        self.stage = .mutating
        return try await self.service.connection(CloudConnectionRequest(binding: binding,
            operation: self.connectionOperation, action: action), authBaseUrl: context.configuration.authBaseUrl,
            bearer: context.credentials.idToken)
    }

    private func acceptConnection(_ response: CloudConnectionResponse, epoch: UUID) async throws {
        let context = try self.checkCurrent(epoch)
        switch response {
        case .proofRequired(let operation): self.connectionOperation = operation
        case .proved(let operation):
            self.connectionOperation = operation
            try await self.acceptConnection(self.connectionRequest(.preview([])), epoch: epoch)
            return
        case .emailRequired(let email): self.connectionEmail = email
        case .preview(let preview):
            guard preview.operation == self.connectionOperation else { throw CloudAccountMethodError.invalidPhase }
            self.connectionPreview = preview
        case .connected(let result):
            guard result.operationId == self.connectionConfirmation?.choices.operationId else {
                throw CloudAccountMethodError.invalidPhase
            }
            self.connectionOutcome = .connected
            self.store.cloudNativeSignIn.clearConnectionSuggestion()
            self.connectionBinding = nil
            self.connectionConfirmation = nil
            self.connectionOperation = nil
            let verified = CloudVerifiedAuthContext(apiBaseUrl: context.configuration.apiBaseUrl, credentials: context.credentials)
            let account = try await self.store.cloudRuntime.fetchCloudAccount(verifiedContext: verified)
            _ = try self.checkCurrent(epoch)
            guard account.userId == context.userId, let aliases = account.identity.linkedAccountIds,
                  let canonical = account.identity.canonicalAccountId,
                  aliases.contains(canonical), aliases.contains(account.identity.originalUserId), aliases.contains(context.userId),
                  aliases.contains(result.sourceUserId), aliases.contains(result.canonicalAccountId) else {
                throw CloudAccountMethodError.currentAccountChanged
            }
            // The full authorized collection retains hidden roots and their pending offline work.
            guard let workspace = account.workspaces.first(where: { $0.workspaceId == self.store.workspace?.workspaceId }) else {
                throw CloudAccountMethodError.currentAccountChanged
            }
            let link = CloudWorkspaceLinkContext(userId: account.userId, email: account.email,
                apiBaseUrl: verified.apiBaseUrl, credentials: verified.credentials, workspaces: [workspace],
                preferences: account.preferences, guestUpgradeMode: nil, demoOnlyDestinationWorkspaceId: nil, postAuthRecoveryRoute: .none)
            try await self.store.completeCloudLink(linkContext: link, selection: .existing(workspaceId: workspace.workspaceId))
            _ = try self.checkCurrent(epoch)
            try await self.refreshMethods(epoch: epoch)
        case .alreadyConnected, .cancelled:
            if case .alreadyConnected = response { self.connectionOutcome = .alreadyConnected }
            else { self.connectionOutcome = .cancelled }
            self.store.cloudNativeSignIn.clearConnectionSuggestion()
            self.connectionBinding = nil
            self.connectionOperation = nil
            self.connectionConfirmation = nil
            self.connectionPreview = nil
            self.connectionEmail = nil
            self.clearProof()
        case .providerRequired: throw CloudAccountMethodError.invalidPhase
        }
        self.stage = .ready
    }

    private func prepareReauthentication(operation: CloudAccountMethodOperation?, epoch: UUID) async throws {
        self.clearProof()
        self.operation = operation
        self.isConnecting = operation == nil
        self.confirmedOperation = nil
        self.stage = .preparingReauthentication
        try await self.refreshMethods(epoch: epoch)
        if let operation { try self.validateTarget(operation) }
    }

    private func validateTarget(_ operation: CloudAccountMethodOperation) throws {
        guard let methods = self.methods else { throw CloudAccountMethodError.freshAttemptRequired }
        switch operation {
        case .link: break
        case .unlink(let target), .reenable(let target):
            guard let method = methods.methods.first(where: { $0.target == target }) else {
                throw CloudAccountMethodError.methodChanged
            }
            if case .reenable = operation {
                guard method.status == .disabled else { throw CloudAccountMethodError.methodChanged }
                guard !method.revocationPending else { throw CloudAccountMethodError.cleanupRequired }
            } else {
                guard method.status == .active else { throw CloudAccountMethodError.methodChanged }
            }
        }
    }

    private func authorize(attempt: CloudAccountProviderAttempt, metadata: CloudAuthMethods,
        presentation: CloudNativeAuthPresentation, epoch: UUID
    ) async throws -> CloudSocialProviderProof {
        let context = try self.checkCurrent(epoch)
        self.stage = .requestingProvider(attempt.provider)
        let onRequested: () -> Void = { [weak self] in
            guard let self, (try? self.checkCurrent(epoch)) != nil else { return }
            self.onObservation?(.providerRequested(attempt.provider))
        }
        let proof: CloudSocialProviderProof
        do {
            let input = attempt.presentationAttempt(authBaseUrl: context.configuration.authBaseUrl)
            switch attempt.provider {
            case .apple:
                proof = try await self.apple.authorize(login: input, methods: metadata, presentation: presentation, onRequested: onRequested)
            case .google:
                proof = try await self.google.authorize(login: input, methods: metadata, presentation: presentation, onRequested: onRequested)
            }
        } catch {
            _ = try self.checkCurrent(epoch)
            if let native = error as? CloudNativeAuthError {
                let outcome: AnalyticsAuthProviderOutcome?
                switch native {
                case .cancelled: outcome = .cancelled
                case .unavailable: outcome = .unavailable
                case .invalidCredential, .invalidAttempt, .freshAttemptRequired: outcome = .invalidResponse
                case .providerFailure: outcome = .providerError
                case .invalidConfiguration, .presentationUnavailable, .alreadyInProgress: outcome = nil
                }
                if let outcome { self.onObservation?(.providerFinished(attempt.provider, outcome)) }
            }
            throw error
        }
        _ = try self.checkCurrent(epoch)
        self.onObservation?(.providerFinished(attempt.provider, .credentialReceived))
        return proof
    }

    private func accept(_ response: CloudSocialContinuationResponse, attempt: CloudAccountProviderAttempt, epoch: UUID) async throws {
        let context = try self.checkCurrent(epoch)
        switch response {
        case .verificationRequired(let reason, let providerEmail):
            self.mailboxChallenge = CloudAccountMailboxChallenge(attempt: attempt, reason: reason, providerEmail: providerEmail)
            self.stage = .mailboxRequired
            if attempt.purpose == .link, case .some(.link(let provider)) = self.operation, provider == attempt.provider {
                self.onObservation?(.linkFinished(provider, .verificationRequired))
            }
        case .completed(let completion, _):
            self.mailboxChallenge = nil
            if attempt.purpose == .reauth {
                self.receipt = CloudAccountReauthenticationReceipt(completion: completion, binding: attempt.binding)
                self.stage = .proofReady
            } else {
                guard let operation = self.operation, case .link = operation else { throw CloudAccountMethodError.invalidPhase }
                self.stage = .mutating
                try await self.service.completeLink(completion: completion, binding: attempt.binding,
                    authBaseUrl: context.configuration.authBaseUrl, bearer: context.credentials.idToken)
                _ = try self.checkCurrent(epoch)
                try await self.finishMutation(operation, epoch: epoch)
            }
        }
    }

    private func observeCodeRequestFailure(_ error: Error, method: CloudSignInMethod, epoch: UUID) throws {
        _ = try self.checkCurrent(epoch)
        guard self.isKnownCodeServiceFailure(error) else { return }
        self.onObservation?(.codeRequestFinished(method, self.isCodeServiceHTTPTimeout(error) ? .timeout : nativeCodeRequestOutcome(error)))
    }

    private func observeCodeVerificationFailure(_ error: Error, method: CloudSignInMethod, epoch: UUID) throws {
        _ = try self.checkCurrent(epoch)
        guard !isRequestCancellationError(error: error) else { return }
        if self.isKnownCodeServiceFailure(error) {
            self.onObservation?(.codeVerificationFinished(method, self.isCodeServiceHTTPTimeout(error) ? .timeout : nativeCodeVerificationOutcome(error)))
            return
        }
        guard case CloudAuthError.invalidResponse(let details, _) = error else { return }
        switch details.code {
        case "OTP_CODE_INVALID", "OTP_SESSION_EXPIRED", "OTP_CHALLENGE_CONSUMED", "OTP_TOO_MANY_ATTEMPTS":
            self.onObservation?(.codeVerificationFinished(method, nativeCodeVerificationOutcome(error)))
        default: break
        }
    }

    private func isKnownCodeServiceFailure(_ error: Error) -> Bool {
        guard !isRequestCancellationError(error: error) else { return false }
        if let error = error as? URLError {
            return error.code == .timedOut || error.code == .notConnectedToInternet || error.code == .networkConnectionLost
        }
        if case CloudAuthError.invalidResponse(let details, let status) = error {
            switch details.code {
            case "AUTH_ATTEMPT_RESTART_REQUIRED", "SERVICE_UNAVAILABLE", "PRINCIPAL_SIGNOUT_PENDING",
                 "SESSION_REQUIRED", "SESSION_REVOKED", "ACCOUNT_DELETED": return false
            default: break
            }
            return self.isCodeServiceHTTPTimeout(error) || status == 429 || (status == 500 && details.code == "INTERNAL_ERROR")
        }
        return false
    }

    private func isCodeServiceHTTPTimeout(_ error: Error) -> Bool {
        if case CloudAuthError.invalidResponse(_, let status) = error { return status == 408 || status == 504 }
        return false
    }

    private func observeLinkFailure(_ error: Error, purpose: CloudAccountProofPurpose, provider: CloudAuthProvider, epoch: UUID) throws {
        _ = try self.checkCurrent(epoch)
        guard purpose == .link, case .some(.link(let selectedProvider)) = self.operation,
              selectedProvider == provider, self.confirmedOperation == nil,
              case CloudAuthError.invalidResponse(let details, _) = error,
              details.code == "PROVIDER_ENROLLMENT_CONFLICT" else { return }
        self.onObservation?(.linkFinished(provider, .conflict))
    }

    private func finishMutation(_ operation: CloudAccountMethodOperation, epoch: UUID) async throws {
        self.clearProof()
        self.confirmedOperation = operation
        self.onObservation?(.mutationConfirmed(operation.mutation, operation.provider))
        try await self.refreshMethods(epoch: epoch)
        self.stage = .finished(operation)
    }

    private func refreshMethods(epoch: UUID) async throws {
        self.methods = nil
        let context = try self.checkCurrent(epoch)
        let methods = try await self.service.list(authBaseUrl: context.configuration.authBaseUrl, bearer: context.credentials.idToken)
        _ = try self.checkCurrent(epoch)
        self.methods = methods
        self.refreshError = nil
    }

    private func captureContext() throws -> AccountManagementContext {
        let configuration = try self.store.currentCloudServiceConfiguration()
        guard let session = self.store.cloudRuntime.activeCloudSession(), case .bearer(let bearer) = session.authorization,
              session.apiBaseUrl == configuration.apiBaseUrl, session.configurationMode == configuration.mode,
              self.store.cloudSettings?.cloudState == .linked, self.store.cloudSettings?.linkedUserId == session.userId,
              let credentials = try self.store.cloudRuntime.loadCredentials(), credentials.idToken == bearer,
              let expiry = parseIsoTimestamp(value: credentials.idTokenExpiresAt), expiry > Date() else {
            throw CloudAccountMethodError.sessionRequired
        }
        return AccountManagementContext(configuration: configuration, credentials: credentials, userId: session.userId, email: session.email)
    }

    @discardableResult
    private func checkCurrent(_ epoch: UUID) throws -> AccountManagementContext {
        try Task.checkCancellation()
        guard self.epoch == epoch else { throw CancellationError() }
        guard let context = self.context else { throw CloudAccountMethodError.sessionRequired }
        let current = try self.captureContext()
        guard current.configuration == context.configuration, current.userId == context.userId,
              current.credentials == context.credentials else { throw CloudAccountMethodError.currentAccountChanged }
        return context
    }

    private func clearProof() {
        self.receipt = nil
        self.emailAttempt = nil
        self.mailboxChallenge = nil
    }

    private func validateCode(_ code: String) throws {
        try requireCloudSocialContract(code.range(of: "^[0-9]{6,8}$", options: .regularExpression) != nil,
            "Enter the actual 6–8 digit verification code")
    }

    private func perform(_ action: (UUID) async throws -> Void) async throws {
        guard !self.isWorking else { throw CloudNativeAuthError.alreadyInProgress }
        let epoch = self.epoch
        let id = UUID()
        self.operationId = id
        self.isWorking = true
        defer {
            if self.operationId == id { self.operationId = nil; self.isWorking = false }
        }
        do {
            _ = try self.checkCurrent(epoch)
            try await action(epoch)
        } catch {
            guard self.epoch == epoch else { throw error }
            self.clearProof()
            if case CloudAuthError.invalidResponse(let details, _) = error {
                if details.code == "ACCOUNT_CONNECTION_PREVIEW_CHANGED" {
                    self.connectionPreview = nil
                    self.connectionConfirmation = nil
                }
                if ["ACCOUNT_CONNECTION_RESTART_REQUIRED", "ACCOUNT_CONNECTION_INVALID", "AUTH_ATTEMPT_RESTART_REQUIRED",
                    "SESSION_REQUIRED", "SESSION_REVOKED", "PRINCIPAL_SIGNOUT_PENDING", "ACCOUNT_DELETED"].contains(details.code ?? "") {
                    self.connectionBinding = nil
                    self.connectionOperation = nil
                    self.connectionPreview = nil
                    self.connectionConfirmation = nil
                    self.connectionEmail = nil
                    self.store.cloudNativeSignIn.clearConnectionSuggestion()
                }
            }
            self.stage = .failed(error)
            // A lost response may have committed; only a new list may describe the actual outcome.
            do { try await self.refreshMethods(epoch: epoch) }
            catch { if self.epoch == epoch { self.refreshError = error } }
            throw error
        }
    }
}
