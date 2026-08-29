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

/// How much of the current challenge the server has already spent. It is a fact about the challenge
/// the attempt is holding, not about the view showing it, so it outlives a rebuilt code step and the
/// person keeps seeing "Resend code" instead of a code field they cannot use.
enum CloudOtpChallengeState: Hashable {
    case active
    case consumed
    case expired
    case tooManyAttempts
}

struct CloudSignInPostAuthTaskHandle {
    let stateId: String
    let task: Task<Void, Never>
}

/**
 * Everything one sign-in attempt is made of: the step the person is on, what they typed into it,
 * and the post-auth work the attempt started.
 *
 * This lives on the store rather than in `CloudSignInSheet` or `CloudOtpVerificationSheet` because
 * SwiftUI destroys and rebuilds that content while the presentation stays on screen — switching tabs
 * under the Settings presenter is enough. State the view owns does not survive that, so an attempt
 * anchored to the view loses the typed email, the open code step and everything entered into it, and
 * the in-flight work of a sign-in that already succeeded, without the person ever closing anything.
 * Only state that genuinely describes one view instance — keyboard focus, an open technical-error
 * inspector, a confirmation alert — stays in the view.
 *
 * `id` identifies the attempt, and every write-back from work that can outlive it compares that `id`
 * first: neither `sendCode` nor the code step's verify and resend calls are cancelled by a presenter
 * teardown, so each of them carries the attempt it was started for and drops its result when that
 * attempt is gone. The code step's own state needs one level more, because a single attempt opens a
 * new `otpSheetState` for every code it sends: those write-backs carry that `id` too, so a
 * superseded challenge cannot spend, or answer for, the challenge now on screen. Once post-auth work
 * is under way the per-state `id` guards take over, but only downstream of
 * `handleVerifiedAuthContext`, which is where the post-auth states are created: a write-back that
 * creates the state it then compares against would find its own guard passing, so the attempt `id`
 * is the only thing an entry point can check.
 */
struct CloudSignInAttemptState {
    let id: String
    var email: String
    var otpSheetState: CloudOtpSheetState?
    var postAuthLoadingState: CloudPostAuthLoadingState?
    var postAuthGuestLocalRecoveryPreparationState: CloudPostAuthGuestLocalRecoveryPreparationState?
    var postAuthSyncState: CloudPostAuthSyncState?
    var workspaceLinkContext: CloudWorkspaceLinkContext?
    var postAuthRecoveryNeededState: CloudPostAuthRecoveryNeededState?
    var postAuthFailureState: CloudPostAuthFailureState?
    var authErrorPresentation: CloudAuthInlineErrorPresentation?
    var isSendingCode: Bool
    var otpCode: String
    var otpChallengeState: CloudOtpChallengeState
    var otpAuthErrorPresentation: CloudAuthInlineErrorPresentation?
    var isVerifyingOtpCode: Bool
    var isResendingOtpCode: Bool
    /// The attempt finished its work and the presentation should close. The dismissal itself belongs
    /// to whichever view instance is on screen, which is not always the one that started the work.
    var isCompleted: Bool
    var postAuthLoadingTask: CloudSignInPostAuthTaskHandle?
    var postAuthGuestLocalRecoveryPreparationTask: CloudSignInPostAuthTaskHandle?
    var postAuthSyncTask: CloudSignInPostAuthTaskHandle?

    init() {
        self.id = UUID().uuidString
        self.email = ""
        self.otpSheetState = nil
        self.postAuthLoadingState = nil
        self.postAuthGuestLocalRecoveryPreparationState = nil
        self.postAuthSyncState = nil
        self.workspaceLinkContext = nil
        self.postAuthRecoveryNeededState = nil
        self.postAuthFailureState = nil
        self.authErrorPresentation = nil
        self.isSendingCode = false
        self.otpCode = ""
        self.otpChallengeState = .active
        self.otpAuthErrorPresentation = nil
        self.isVerifyingOtpCode = false
        self.isResendingOtpCode = false
        self.isCompleted = false
        self.postAuthLoadingTask = nil
        self.postAuthGuestLocalRecoveryPreparationTask = nil
        self.postAuthSyncTask = nil
    }

    /**
     * A new code step, or a new challenge on the one already open, starts empty: nothing typed,
     * nothing spent, and no error left from the challenge it replaces. Every path that opens a code
     * step or puts a new challenge into one owes this call, which is what keeps a spent challenge's
     * "Resend code" prompt, and the code that was rejected for it, off a freshly sent one.
     *
     * The in-flight flags are deliberately untouched: each belongs to the request that raised it, and
     * lowering one here would re-enable a control while its request is still running.
     */
    mutating func resetOtpEntryState() {
        self.otpCode = ""
        self.otpChallengeState = .active
        self.otpAuthErrorPresentation = nil
    }

    var isPostAuthActionInFlight: Bool {
        self.postAuthLoadingState != nil
            || self.postAuthGuestLocalRecoveryPreparationState != nil
            || self.postAuthSyncState != nil
    }

    /// Whether a step above the email form is on screen. A rebuilt view instance must not pull focus
    /// back to the email field underneath one.
    var isStepAboveEmailFormPresented: Bool {
        self.otpSheetState != nil
            || self.workspaceLinkContext != nil
            || self.postAuthRecoveryNeededState != nil
            || self.postAuthFailureState != nil
            || self.isPostAuthActionInFlight
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
     * This starts an attempt from scratch: it clears the previous attempt's screen state and work
     * and writes every field the attempt is made of, so a presentation that ended without a
     * dismissal — the credential-recovery gate swapping the tab root out from under a presented
     * sheet is the one way that happens — cannot leave an origin surface, a gate latch, a typed
     * email or a running post-auth task behind for the next presentation. Because it re-reads the
     * gate into the latch and resets the sheet's state, the caller owes exactly one call per
     * presentation: `CloudSignInSheetModifier` is the only caller and holds that guarantee.
     */
    func beginCloudSignInAttempt(originSurface: AnalyticsSurface?) {
        self.cancelCloudSignInPostAuthTasks()
        self.cloudSignInAttempt = CloudSignInAttemptState()
        self.isCloudSignInAttemptOpen = true
        self.cloudSignInOriginSurface = originSurface
        self.wasCredentialRecoveryGateActiveAtSignInStart = self.isCloudCredentialRecoveryGateActive
        // The sign-in screen's own `screen_viewed`, reported per presentation for the same reason the
        // attempt is opened here: the sheet's content is destroyed and rebuilt while the presentation
        // stays on screen, so reporting from its `onAppear` would record a view per rebuild.
        Analytics.trackScreenViewed(.signin)
    }

    /**
     * The attempt is over. `CloudSignInSheetModifier`'s `onDismiss` is the usual way in and sees
     * every way the sheet can go: the Close button, the interactive swipe, and the programmatic
     * dismissals that follow success, logout or a post-auth failure. Backgrounding the app does not
     * reach it, so an attempt still open here was abandoned by the person; a dismissal that follows
     * success or a reported failure finds the attempt settled and reports nothing. Ending the
     * attempt also ends its work, which is why the attempt's screen state and post-auth tasks are
     * torn down here. The sheet's content going away is never a reason to do that.
     *
     * `eraseLocalDataForCredentialRecovery` is the other way in, and the only one that is not a
     * dismissal: the recovery gate takes the surface away without dismissing anything, so an attempt
     * can still be running when the person erases local data, and it has to be ended before that
     * reset rather than left to write across it.
     *
     * The credential-recovery-gate comparison below is defence-in-depth on every path in, and is
     * meant to stay that way. It draws one distinction and claims nothing beyond it: an attempt the
     * person walked away from is theirs to abandon and is worth a `signin_failed(cancelled)`, while
     * an attempt whose surface the recovery gate took away is not. That is why the gate's activation
     * is latched when the attempt begins and a mismatch here reports nothing.
     *
     * The surface handed back is `cloudSignInReturnSurface`, which is where the person is now — a
     * different question from where the sheet was opened from, and deliberately not answered by
     * `cloudSignInOriginSurface`, which is `signin_failed`'s entry point and nothing else. The guest
     * after-review prompt is the case that separates the two: it is owned by the review flow
     * whichever tab it floats over, so its entry point stays Review while the person is handed back
     * to the tab they are actually looking at. The restore is conditional on the tracker still
     * holding `signin`, so a sign-in that ended by moving the person somewhere that reported itself
     * first — a workspace landing them on a tab — leaves that report standing.
     *
     * The credential-recovery gate clearing on its own success is not such a case, and does not
     * reach here at all: removing the gate destroys this sheet's presenter without an `onDismiss`.
     * The gate's own `.onDisappear` is what names the screen the person lands on there.
     */
    func endCloudSignInAttempt() {
        if self.isCloudSignInAttemptOpen,
           self.isCloudCredentialRecoveryGateActive == self.wasCredentialRecoveryGateActiveAtSignInStart {
            self.trackCloudSignInFailed(reason: .cancelled)
        }

        Analytics.trackScreenViewedOnDismiss(
            of: .signin,
            restoring: self.cloudSignInReturnSurface
        )
        self.cancelCloudSignInPostAuthTasks()
        self.cloudSignInAttempt = CloudSignInAttemptState()
        self.isCloudSignInAttemptOpen = false
        self.cloudSignInOriginSurface = nil
        self.wasCredentialRecoveryGateActiveAtSignInStart = false
    }

    /// Stops the post-auth work the current attempt started. A rebuilt sheet is not a reason to call
    /// this: the work belongs to the attempt, not to the view instance that happened to start it.
    func cancelCloudSignInPostAuthTasks() {
        self.cloudSignInAttempt.postAuthLoadingTask?.task.cancel()
        self.cloudSignInAttempt.postAuthLoadingTask = nil
        self.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationTask?.task.cancel()
        self.cloudSignInAttempt.postAuthGuestLocalRecoveryPreparationTask = nil
        self.cloudSignInAttempt.postAuthSyncTask?.task.cancel()
        self.cloudSignInAttempt.postAuthSyncTask = nil
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

    /// Where closing the sign-in sheet leaves the person, read live rather than latched at the start
    /// of the attempt: the recovery gate while it is still up, and otherwise the visible tab, which
    /// is what the sheet was covering.
    private var cloudSignInReturnSurface: AnalyticsSurface {
        self.isCloudCredentialRecoveryGateActive
            ? .credentialRecovery
            : analyticsSurface(tab: self.currentVisibleTab)
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
 * Where a sign-in sheet was opened from, and with it the `screen` its `signin_failed` carries. It is
 * the entry-point reading and only that: the surface the sheet hands back when it closes is a
 * separate question, answered live by `cloudSignInReturnSurface`.
 *
 * The credential-recovery gate used to carry no surface, because the catalog had no value for a
 * screen that replaces the app's root when a stored credential stops working, and naming any product
 * surface for it would have been a lie. The catalog now names it, so the gate is `credentialRecovery`
 * and this is no longer an entry point that can only be reported as no screen at all. Every other
 * presenter names the surface that owns the control the person tapped, so a prompt owned by the
 * review flow stays Review whichever tab it floats over — which is exactly why this value must never
 * be reused as the surface the person returns to.
 *
 * `originSurface` stays optional because `signin_failed` takes it directly: the catalog leaves that
 * event's surface open so a sign-in the client genuinely cannot attribute reports none rather than
 * the nearest wrong one.
 */
enum CloudSignInPresentationContext: Hashable {
    case standard(originSurface: AnalyticsSurface)
    case credentialRecoveryGate

    var originSurface: AnalyticsSurface? {
        switch self {
        case .standard(let originSurface):
            return originSurface
        case .credentialRecoveryGate:
            return .credentialRecovery
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
