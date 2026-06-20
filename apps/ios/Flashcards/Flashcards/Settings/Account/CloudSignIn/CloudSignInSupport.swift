import Foundation

struct CloudOtpSheetState: Identifiable, Hashable {
    let id: String
    let email: String
    let challenge: CloudOtpChallenge?

    init(email: String, challenge: CloudOtpChallenge?) {
        self.init(id: UUID().uuidString, email: email, challenge: challenge)
    }

    private init(id: String, email: String, challenge: CloudOtpChallenge?) {
        self.id = id
        self.email = email
        self.challenge = challenge
    }

    func withChallenge(_ challenge: CloudOtpChallenge) -> CloudOtpSheetState {
        CloudOtpSheetState(id: self.id, email: challenge.email, challenge: challenge)
    }
}

@MainActor
extension FlashcardsStore {
    func beginCloudSignInSheetPresentation() {
        self.activeCloudSignInSheetCount += 1
    }

    func endCloudSignInSheetPresentation() {
        guard self.activeCloudSignInSheetCount > 0 else {
            assertionFailure("Cloud sign-in sheet presentation ended without a matching begin.")
            return
        }

        self.activeCloudSignInSheetCount -= 1
    }
}

enum CloudPostAuthRetryAction: Hashable {
    case prepareLink(verifiedContext: CloudVerifiedAuthContext)
    case completeLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection)
    case completeGuestLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection)
    case syncOnly
}

enum CloudSignInPresentationContext: Hashable {
    case standard
    case credentialRecoveryGate
}

enum CloudPostAuthSyncOperation: Hashable {
    case completeLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection)
    case completeGuestLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection)
    case syncOnly
}

enum CloudPostAuthFailureKind: Hashable {
    case standard
    case guestLocalRecovery
}

struct CloudPostAuthFailurePresentation: Equatable {
    let title: String
    let message: String?
    let retryAction: CloudPostAuthRetryAction
    let kind: CloudPostAuthFailureKind

    var allowsAccountExitActions: Bool {
        self.kind == .standard
    }
}

private func makeCompleteLinkFailureRetryAction(
    linkContext: CloudWorkspaceLinkContext,
    selection: CloudWorkspaceLinkSelection,
    cloudState: CloudAccountState?
) -> CloudPostAuthRetryAction {
    guard cloudState == .linked else {
        return .completeLink(linkContext: linkContext, selection: selection)
    }

    switch linkContext.postAuthRecoveryRoute {
    case .none:
        return .syncOnly
    case .linkedCredentialRestore,
         .guestLocalRecovery,
         .pendingGuestUpgradeMissingGuestSessionRecovery,
         .pendingGuestUpgradeRecovery:
        return .completeLink(linkContext: linkContext, selection: selection)
    }
}

func makeCloudPostAuthFailurePresentation(
    operation: CloudPostAuthSyncOperation,
    cloudState: CloudAccountState?
) -> CloudPostAuthFailurePresentation {
    switch operation {
    case .completeLink(let linkContext, let selection):
        if linkContext.postAuthRecoveryRoute == .guestLocalRecovery {
            return makeGuestLocalRecoveryPostAuthFailurePresentation(
                retryAction: .completeLink(linkContext: linkContext, selection: selection)
            )
        }

        if cloudState == .linked {
            return CloudPostAuthFailurePresentation(
                title: aiSettingsLocalized("settings.account.cloudSignIn.failure.initialSyncFailed", "Signed in, but initial sync failed."),
                message: nil,
                retryAction: makeCompleteLinkFailureRetryAction(
                    linkContext: linkContext,
                    selection: selection,
                    cloudState: cloudState
                ),
                kind: .standard
            )
        }

        return CloudPostAuthFailurePresentation(
            title: aiSettingsLocalized("settings.account.cloudSignIn.failure.cloudSetupFailed", "Signed in, but cloud setup failed."),
            message: nil,
            retryAction: .completeLink(linkContext: linkContext, selection: selection),
            kind: .standard
        )
    case .completeGuestLink(let linkContext, let selection):
        return CloudPostAuthFailurePresentation(
            title: aiSettingsLocalized("settings.account.cloudSignIn.failure.accountUpgradeFailed", "Signed in, but account upgrade failed."),
            message: nil,
            retryAction: .completeGuestLink(linkContext: linkContext, selection: selection),
            kind: .standard
        )
    case .syncOnly:
        return CloudPostAuthFailurePresentation(
            title: aiSettingsLocalized("settings.account.cloudSignIn.failure.initialSyncFailed", "Signed in, but initial sync failed."),
            message: nil,
            retryAction: .syncOnly,
            kind: .standard
        )
    }
}

func makeGuestLocalRecoveryPostAuthFailurePresentation(
    retryAction: CloudPostAuthRetryAction
) -> CloudPostAuthFailurePresentation {
    CloudPostAuthFailurePresentation(
        title: aiSettingsLocalized(
            "settings.account.cloudSignIn.guestLocalRecovery.failure.title",
            "Local data recovery failed."
        ),
        message: aiSettingsLocalized(
            "settings.account.cloudSignIn.guestLocalRecovery.failure.message",
            "Try again; local data stays on this device."
        ),
        retryAction: retryAction,
        kind: .guestLocalRecovery
    )
}

func makeCloudPostAuthVisibleFailureMessage(error: Error) -> String {
    if let safeFailure = safeCloudPostAuthDomainFailure(error: error) {
        return safeFailure.message
    }

    return aiSettingsLocalized(
        "settings.account.cloudSignIn.failureDescription",
        "Your sign-in succeeded, but the cloud workspace setup or initial sync did not finish."
    )
}

func isSafeCloudPostAuthDomainFailure(error: Error) -> Bool {
    safeCloudPostAuthDomainFailure(error: error) != nil
}

private enum SafeCloudPostAuthDomainFailure {
    case bootstrapEligibility(String)
    case credentialRecovery(String)

    var message: String {
        switch self {
        case .bootstrapEligibility(let message),
             .credentialRecovery(let message):
            return message
        }
    }
}

private func safeCloudPostAuthDomainFailure(error: Error) -> SafeCloudPostAuthDomainFailure? {
    if let bootstrapError = error as? CloudBootstrapEligibilityError {
        switch bootstrapError {
        case .remoteWorkspaceIsNotEmpty:
            return .bootstrapEligibility(bootstrapError.visiblePostAuthMessage)
        }
    }

    if let credentialRecoveryMessage = safeCloudCredentialRecoveryPostAuthMessage(error: error) {
        return .credentialRecovery(credentialRecoveryMessage)
    }

    return nil
}

private func safeCloudCredentialRecoveryPostAuthMessage(error: Error) -> String? {
    guard let localStoreError = error as? LocalStoreError else {
        return nil
    }
    guard case .validation(let message) = localStoreError else {
        return nil
    }

    if safeCloudCredentialRecoveryPostAuthMessages().contains(message) {
        return message
    }
    if isLocalizedCloudCredentialRecoveryUpgradeWorkspaceMessage(message) {
        return message
    }

    return nil
}

private func safeCloudCredentialRecoveryPostAuthMessages() -> Set<String> {
    [
        localizedCloudCredentialRecoveryBlockedMessage(reason: .linkedCredentialsMissing),
        localizedCloudCredentialRecoveryBlockedMessage(reason: .guestSessionMissing),
        localizedCloudCredentialRecoveryBlockedMessage(reason: .invalidStoredState),
        localizedCloudCredentialRecoveryWrongLinkedAccountMessage(),
        localizedCloudCredentialRecoveryWrongLinkedWorkspaceMessage(),
        localizedCloudCredentialRecoveryInterruptedUpgradeAccountMessage()
    ]
}

private func isLocalizedCloudCredentialRecoveryUpgradeWorkspaceMessage(_ message: String) -> Bool {
    let sentinel = "__FLASHCARDS_WORKSPACE_NAME__"
    let localizedTemplate = localizedCloudCredentialRecoveryUpgradeWorkspaceMessage(workspaceName: sentinel)
    let components = localizedTemplate.components(separatedBy: sentinel)

    guard components.count == 2 else {
        return message == localizedTemplate
    }

    let prefix = components[0]
    let suffix = components[1]
    return message.hasPrefix(prefix)
        && message.hasSuffix(suffix)
        && message.count >= prefix.count + suffix.count
}

struct CloudPostAuthFailureState: Identifiable {
    let id: String
    let title: String
    let message: String
    let technicalError: TechnicalErrorAction?
    let retryAction: CloudPostAuthRetryAction
    let kind: CloudPostAuthFailureKind

    init(
        title: String,
        message: String,
        technicalError: TechnicalErrorAction?,
        retryAction: CloudPostAuthRetryAction,
        kind: CloudPostAuthFailureKind
    ) {
        self.id = UUID().uuidString
        self.title = title
        self.message = message
        self.technicalError = technicalError
        self.retryAction = retryAction
        self.kind = kind
    }

    var allowsAccountExitActions: Bool {
        self.kind == .standard
    }
}

struct CloudPostAuthLoadingState: Identifiable, Hashable {
    let id: String
    let verifiedContext: CloudVerifiedAuthContext

    init(verifiedContext: CloudVerifiedAuthContext) {
        self.id = UUID().uuidString
        self.verifiedContext = verifiedContext
    }
}

struct CloudPostAuthSyncState: Identifiable, Hashable {
    let id: String
    let operation: CloudPostAuthSyncOperation

    init(operation: CloudPostAuthSyncOperation) {
        self.id = UUID().uuidString
        self.operation = operation
    }
}

struct CloudPostAuthGuestLocalRecoveryPreparationState: Identifiable, Hashable {
    let id: String
    let linkContext: CloudWorkspaceLinkContext
    let selection: CloudWorkspaceLinkSelection

    init(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection) {
        self.id = UUID().uuidString
        self.linkContext = linkContext
        self.selection = selection
    }
}

struct CloudPostAuthRecoveryNeededState: Identifiable, Hashable {
    let id: String
    let title: String
    let message: String

    init(title: String, message: String) {
        self.id = UUID().uuidString
        self.title = title
        self.message = message
    }
}

struct CloudPostAuthSyncPresentation: Equatable {
    let title: String
    let message: String
}

func makeCloudPostAuthSyncPresentation() -> CloudPostAuthSyncPresentation {
    CloudPostAuthSyncPresentation(
        title: aiSettingsLocalized("settings.account.cloudSignIn.sync.title", "Your account is syncing with the cloud."),
        message: aiSettingsLocalized("settings.account.cloudSignIn.sync.message", "Please do not turn off your phone. This usually takes a few minutes.")
    )
}

func makeCloudPostAuthSyncPresentation(operation: CloudPostAuthSyncOperation) -> CloudPostAuthSyncPresentation {
    if isGuestLocalRecoverySyncOperation(operation) {
        return CloudPostAuthSyncPresentation(
            title: aiSettingsLocalized(
                "settings.account.cloudSignIn.guestLocalRecovery.recovering.title",
                "Recovering local data"
            ),
            message: aiSettingsLocalized(
                "settings.account.cloudSignIn.guestLocalRecovery.recovering.message",
                "Keep this screen open while iOS reconnects local data on this device to your recovered workspace."
            )
        )
    }

    return makeCloudPostAuthSyncPresentation()
}

func isGuestLocalRecoverySyncOperation(_ operation: CloudPostAuthSyncOperation) -> Bool {
    switch operation {
    case .completeLink(let linkContext, _):
        return linkContext.postAuthRecoveryRoute == .guestLocalRecovery
    case .completeGuestLink, .syncOnly:
        return false
    }
}

enum CloudWorkspacePostAuthRoute: Equatable {
    case autoLink(CloudWorkspaceLinkSelection)
    case chooseWorkspace
    case guestLocalRecoveryNeeded
}

func makeCloudWorkspacePostAuthRoute(linkContext: CloudWorkspaceLinkContext) -> CloudWorkspacePostAuthRoute {
    switch linkContext.postAuthRecoveryRoute {
    case .guestLocalRecovery:
        return .autoLink(.createNew)
    case .pendingGuestUpgradeMissingGuestSessionRecovery:
        return .guestLocalRecoveryNeeded
    case .linkedCredentialRestore:
        guard linkContext.workspaces.count == 1, let workspace = linkContext.workspaces.first else {
            return .chooseWorkspace
        }

        return .autoLink(.existing(workspaceId: workspace.workspaceId))
    case .none, .pendingGuestUpgradeRecovery:
        break
    }

    let workspaces = linkContext.workspaces
    if workspaces.isEmpty {
        return .autoLink(.createNew)
    }

    if workspaces.count == 1, let workspace = workspaces.first {
        return .autoLink(.existing(workspaceId: workspace.workspaceId))
    }

    return .chooseWorkspace
}

private let cloudEmailPattern = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"

func normalizedCloudEmail(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

func isValidCloudEmail(_ value: String) -> Bool {
    let normalizedValue = normalizedCloudEmail(value)
    return normalizedValue.range(of: cloudEmailPattern, options: .regularExpression) != nil
}

func normalizedOtpCode(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
}

func isCloudSignInSyncInFlight(status: SyncStatus) -> Bool {
    switch status {
    case .syncing:
        return true
    case .blocked:
        return true
    case .idle, .failed:
        return false
    }
}
