import Foundation

/**
 * Lets a technical cloud sync failure that no trigger would report reach Sentry once it has repeated,
 * and bounds how many such reports one app session may send.
 *
 * The admission rule is the trigger's own flag and nothing narrower: every trigger that carries
 * `capturesTechnicalFailures: false` reaches this gate, automatic and user-initiated alike, and
 * anything a trigger already captures never arrives here at all. So the traffic through this gate is
 * not one cadence, and neither the bound below nor any later change to it can be reasoned about from
 * a polling interval alone.
 *
 * **Repetition, not a consecutive streak.** Occurrences accumulate for the whole app session and a
 * successful sync does not reset them. The failure this exists to expose succeeds roughly four syncs
 * out of five, so a streak that a success clears would stay silent exactly where the problem is real,
 * and would fire only for a device that is wholly broken — which is the case that already reaches
 * someone through support. The third occurrence is also not paced by the polling interval alone:
 * every trigger reaching the same sync entry point adds to the same signature, so on a device failing
 * every attempt it can arrive within seconds of launch.
 *
 * **Identity is in the key, not in a reset.** The signature carries the cloud identity the event would
 * be scoped to, so occurrences counted under one identity can never be added to another's first
 * failure and a signature already captured under one identity cannot silence another's. That is a
 * property of the key, so it holds at every identity rotation without this type knowing where the
 * rotations are.
 *
 * **Bound.** `occurrencesBeforeCapture` silences the first two occurrences of a signature. A signature
 * that has been captured is never captured again, which is what holds one repeating failure to a
 * single event rather than one per attempt: from the automatic polling alone that would otherwise be
 * 240 attempts per hour at the 15 s fast-poll cadence and 60 per hour at the 60 s default one, on a
 * device that fails every attempt. `capturedSignatureLimit` then bounds how many distinct signatures
 * may each spend that one event, at three. Nothing empties this state, so its lifetime is exactly one
 * process launch and the bound is exactly that: at most 3 events per app launch, however long it runs
 * and however often sync retries. Multiply by launches for the daily ceiling — a device relaunched ten
 * times can pay that three-event cost ten times.
 *
 * **The budget spans identities, deliberately.** `capturedSignatureLimit` is not per identity and not
 * per action: a launch that signs out and back in, or switches server, shares the same three slots,
 * and so does a device failing on two surfaces. A per-identity budget would multiply the ceiling by
 * however many rotations a launch performs, which is the flood this bound exists to prevent, and the
 * cost of sharing is small and self-limiting: to find the budget spent, this launch must already have
 * sent up to three repeated-failure events, so the device is not silent, and the next launch starts
 * with a full budget.
 *
 * In memory only, and reached only from `@MainActor` sync code, so it needs no lock.
 */
struct CloudSyncFailureRepetitionGate {
    /// Occurrences of one signature within an app session before that signature may be captured.
    static let occurrencesBeforeCapture: Int = 3
    /// Distinct signatures one app session may capture, each of them exactly once.
    static let capturedSignatureLimit: Int = 3

    private var occurrencesBySignature: [String: Int]
    private var capturedSignatures: Set<String>

    init() {
        self.occurrencesBySignature = [:]
        self.capturedSignatures = []
    }

    /// Records one failure, reporting whether this occurrence of it earns a capture.
    mutating func admitsCapture(signature: String) -> Bool {
        let occurrenceCount: Int = (self.occurrencesBySignature[signature] ?? 0) + 1
        self.occurrencesBySignature[signature] = occurrenceCount

        guard occurrenceCount >= Self.occurrencesBeforeCapture else {
            return false
        }
        guard self.capturedSignatures.contains(signature) == false else {
            return false
        }
        guard self.capturedSignatures.count < Self.capturedSignatureLimit else {
            return false
        }

        self.capturedSignatures.insert(signature)
        return true
    }
}

/**
 * The key repetition is counted on. Local to the process: it is used only as a dictionary key here,
 * and nothing derived from it is ever attached to a capture.
 *
 * Built from the sanitized error, the diagnostics the capture path already computes, and the session
 * that capture would be scoped to. `linkedSession` is the same value `captureCloudSyncFailure` reads
 * `userId` and `workspaceId` from, passed rather than re-read so the key cannot describe a different
 * scope than the event it admits.
 *
 * `sanitizedNSError` alone is too coarse to mean "the same failure": it takes `code` from
 * `error as NSError`, which for a Swift error enum is the case index, so every
 * `CloudSyncError.invalidResponse` would collapse into one key whatever its HTTP status or backend
 * code. Three unrelated one-off failures in a session — a 500, a 404 and a conflict — would then trip
 * the gate and report a repetition that never happened. `statusCode` and `backendCode` are already
 * computed on this path by `CloudSyncFailurePolicy.diagnostics(error:)`, so folding them in costs
 * nothing.
 *
 * `userId`, `workspaceId`, account kind and `apiBaseUrl` are what make the count mean one thing. A
 * capture is scoped to a `userId` and a `workspaceId` and labelled guest or linked, so a count
 * assembled under another identity, or in another workspace, would describe a repetition that scope
 * never had; `apiBaseUrl` is there for the same reason, because a failure against one backend says
 * nothing about the next one.
 *
 * None of that reaches Sentry. The key is finer than the domain-and-code grouping Sentry applies to
 * the capture, and a finer key cannot split an issue: it only means two of the at most three events a
 * process sends may land in the same issue.
 */
func cloudSyncFailureRepetitionSignature(
    error: Error,
    action: String,
    linkedSession: CloudLinkedSession
) -> String {
    let sanitizedError: NSError = sanitizedNSError(error, action: action)
    let diagnostics: CloudFailureDiagnostics = CloudSyncFailurePolicy.diagnostics(error: error)
    let statusCode: String = diagnostics.statusCode.map { statusCode in String(statusCode) } ?? ""
    let backendCode: String = diagnostics.backendCode ?? ""
    let accountKind: String = linkedSession.authorization.isGuest ? "guest" : "linked"
    return [
        sanitizedError.domain,
        String(sanitizedError.code),
        statusCode,
        backendCode,
        action,
        accountKind,
        linkedSession.userId,
        linkedSession.workspaceId,
        linkedSession.apiBaseUrl
    ].joined(separator: "|")
}
