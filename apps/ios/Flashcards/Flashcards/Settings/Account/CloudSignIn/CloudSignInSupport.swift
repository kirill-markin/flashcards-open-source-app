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
    /**
     * A sign-in attempt begins when a presenter asks for the sheet, not when the sheet's content
     * appears. SwiftUI tears that content down and rebuilds it while the presentation stays on
     * screen — a tab switch under the Settings presenter is enough — so an attempt anchored to the
     * content would re-open on every rebuild and owe a `signin_failed` for each one.
     *
     * This starts an attempt from scratch: it writes all three fields the attempt is made of, so a
     * presentation that ended without a dismissal — the credential-recovery gate swapping the tab
     * root out from under a presented sheet is the one way that happens — cannot leave an origin
     * surface or a gate latch behind for the next presentation to be judged on. Because it re-reads
     * the gate into the latch, the caller owes exactly one call per presentation:
     * `CloudSignInSheetModifier` is the only caller and holds that guarantee.
     */
    func beginCloudSignInAttempt(originSurface: AnalyticsSurface?) {
        self.isCloudSignInAttemptOpen = true
        self.cloudSignInOriginSurface = originSurface
        self.wasCredentialRecoveryGateActiveAtSignInStart = self.isCloudCredentialRecoveryGateActive
    }

    /**
     * The sheet was dismissed. This is the one place that sees every way it can go: the Close
     * button, the interactive swipe, and the programmatic dismissals that follow success, logout or
     * a post-auth failure. Backgrounding the app does not reach it, so an attempt still open here
     * was abandoned by the person — with one exception. A dismissal that follows success or a
     * reported failure finds the attempt settled and reports nothing.
     *
     * The exception is the credential-recovery gate. `RootTabView.body` swaps its whole tab root for
     * `CloudCredentialRecoveryGateView` the moment `cloudCredentialRecoveryState` becomes non-nil,
     * and swaps it back when the state clears; either swap takes away whichever sheet the other
     * branch was presenting, and a background poll can flip that state while the person is typing.
     * That is the system taking the surface away, not a person closing it, so the gate's activation
     * is latched when the attempt begins and a mismatch here reports nothing. Android's gate sits
     * above its navigation host and reports nothing for the same swap, so the two clients agree.
     */
    func endCloudSignInAttempt() {
        if self.isCloudSignInAttemptOpen,
           self.isCloudCredentialRecoveryGateActive == self.wasCredentialRecoveryGateActiveAtSignInStart {
            self.trackCloudSignInFailed(reason: .cancelled)
        }

        self.isCloudSignInAttemptOpen = false
        self.cloudSignInOriginSurface = nil
        self.wasCredentialRecoveryGateActiveAtSignInStart = false
    }

    /**
     * The sheet's content is on screen. SwiftUI can take that content away and bring it back within
     * one presentation, so this tracks the surface and says nothing about the attempt.
     */
    func beginCloudSignInSurfacePresence() {
        assert(
            self.activeCloudSignInSheetCount == 0,
            "A second cloud sign-in sheet was presented while one was already on screen."
        )
        self.activeCloudSignInSheetCount += 1
    }

    func endCloudSignInSurfacePresence() {
        guard self.activeCloudSignInSheetCount > 0 else {
            assertionFailure("Cloud sign-in surface presence ended without a matching begin.")
            return
        }

        self.activeCloudSignInSheetCount -= 1
    }

    /**
     * Whether a sign-in surface is on screen.
     *
     * At most one `CloudSignInSheet` exists at a time, which is why one latch is enough for what is
     * otherwise a counter: the credential-recovery gate and the tab root are the two mutually
     * exclusive branches of `RootTabView.body`, the guest-sign-in prompt is blocked outright while
     * this count is non-zero, and a presented sheet covers the tab bar, so no second presenter can
     * be reached. `beginCloudSignInSurfacePresence` asserts on the overlap rather than leaving
     * that as an assumption.
     */
    var isCloudSignInSurfacePresented: Bool {
        self.activeCloudSignInSheetCount > 0
    }

    /**
     * One sign-in attempt reports exactly one `signin_failed`, and only while its surface is on
     * screen.
     *
     * Reporting a failure settles the attempt, so closing the sheet afterwards cannot add a second
     * event. The same holds from the other side: `sendCode` and the OTP calls outlive the sheet, so
     * a request that fails after the sheet is gone reports nothing, because the dismissal has
     * already accounted for that attempt. Two failures the person actually saw stay two events —
     * the surface is on screen for both, and neither is an abandonment.
     */
    func reportCloudSignInFailure(reason: AnalyticsSignInFailureReason) {
        guard self.isCloudSignInSurfacePresented else {
            return
        }

        self.trackCloudSignInFailed(reason: reason)
    }

    /// Credentials were verified, so whatever happens next in post-auth is not an abandoned sign-in.
    func recordCloudSignInVerified() {
        self.isCloudSignInAttemptOpen = false
    }

    private var isCloudCredentialRecoveryGateActive: Bool {
        self.cloudCredentialRecoveryState != nil
    }

    private func trackCloudSignInFailed(reason: AnalyticsSignInFailureReason) {
        self.isCloudSignInAttemptOpen = false
        Analytics.track(.signInFailed(reason: reason), screen: self.cloudSignInOriginSurface)
    }
}

enum CloudPostAuthRetryAction: Hashable {
    case prepareLink(verifiedContext: CloudVerifiedAuthContext)
    case completeLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection)
    case completeGuestLink(linkContext: CloudWorkspaceLinkContext, selection: CloudWorkspaceLinkSelection)
    case syncOnly
}

/**
 * Where a sign-in sheet was opened from, and with it the `screen` its `signin_failed` carries.
 *
 * The credential-recovery gate carries no surface on purpose: it replaces the app's root because a
 * stored credential stopped working, so the person was on no product surface and naming one would be
 * a lie. Every other presenter names the surface that owns the control the person tapped, out of the
 * shared server-owned catalog, so a prompt owned by the review flow stays Review whichever tab it
 * floats over.
 */
enum CloudSignInPresentationContext: Hashable {
    case standard(originSurface: AnalyticsSurface)
    case credentialRecoveryGate

    var originSurface: AnalyticsSurface? {
        switch self {
        case .standard(let originSurface):
            return originSurface
        case .credentialRecoveryGate:
            return nil
        }
    }
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
        localizedCloudCredentialRecoveryBlockedMessage(reason: .linkedWorkspaceUnavailable),
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
