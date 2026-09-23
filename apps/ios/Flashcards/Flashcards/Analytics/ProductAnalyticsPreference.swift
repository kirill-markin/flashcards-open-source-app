import Foundation

let productAnalyticsEnabledUserDefaultsKey: String = "product-analytics-enabled"
let productAnalyticsPendingPushUserDefaultsKey: String = "product-analytics-enabled-pending-push"
let productAnalyticsPendingPushIdentityUserDefaultsKey: String = "product-analytics-enabled-pending-push-identity"
let productAnalyticsAnsweredOnDeviceUserDefaultsKey: String = "product-analytics-enabled-answered-on-device"

/**
 * Whether this install may record and send product analytics.
 *
 * The server owns the answer for the account or the guest session, but the client cannot wait for it.
 * `FlashcardsApp.init` emits the cold `app_opened` before any store is opened and before the first
 * `/me` of the launch, so the decision has to be readable synchronously, from `UserDefaults`, with no
 * identity resolved yet. That is what this mirror is: the last known effective answer, written
 * whenever the user changes it and whenever the server reports one.
 *
 * Absent means nobody has answered anywhere, which reads as enabled — the basis is legitimate
 * interest, not consent, so the switch is on by default and `NULL` from the server is not an opt-out.
 * Only an explicit `false` is.
 *
 * The settled rule, the same one Android applies: the answer given on this device wins on this
 * device. A value the server reports is adopted only when this device holds no answer of its own, and
 * an answer made here is handed to an identity that has none. The consequence is deliberate — a
 * remote change made on another device does not re-enable recording here; this device's own switch
 * does — and it is the safe direction, because the alternative silently turns recording back on for
 * someone who turned it off.
 *
 * Only an answer given here is that sticky, which is why the origin is recorded beside it. A value
 * merely mirrored from the server is nothing this device chose, so a later reported value replaces it
 * and two installs on one account keep showing the same switch.
 *
 * `pendingPush` is the second half of holding offline. A choice made with no connectivity is applied
 * to the client immediately and kept, and the flag marks it as not yet stored server-side so an
 * arriving `/me` cannot quietly undo it. The flag is scoped to the identity the answer was made
 * under, because a debt owed to one account must never be paid onto another person's: an answer is
 * pushed only to the identity it was made under, or to one the server reports no answer for at all.
 *
 * What a push tells the server about where its answer came from is deliberately not recorded beside
 * the debt, because it is not a property of the debt: it belongs to the delivery. The push a
 * person's own press makes is `user_action`; every delivery of a debt that outlived that press is
 * `reconciliation`, including one re-owed below to an identity the person never gave it for. The
 * server refuses a `reconciliation` that would loosen what it already holds, which is what stops a
 * stale opt-in idling here from reverting an opt-out taken since on another device.
 */
enum ProductAnalyticsPreference {
    /// The effective answer, or nil when nobody has answered on this device or for its identity.
    static func storedAnswer(userDefaults: UserDefaults) -> Bool? {
        userDefaults.object(forKey: productAnalyticsEnabledUserDefaultsKey) as? Bool
    }

    static func isEnabled(userDefaults: UserDefaults) -> Bool {
        self.storedAnswer(userDefaults: userDefaults) ?? true
    }

    /// The value the client switch actually holds, which a UI-test launch forces off for the whole
    /// process. The settings surfaces report this rather than the stored answer, so they cannot read
    /// "On" while the client is recording nothing.
    static func effectiveIsEnabled(userDefaults: UserDefaults, processInfo: ProcessInfo) -> Bool {
        guard isFlashcardsUITestLaunch(processInfo: processInfo) == false else {
            return false
        }

        return self.isEnabled(userDefaults: userDefaults)
    }

    /**
     * The answer this device still owes `identityKey`, if any.
     *
     * `nil` for `identityKey` is the install that has no cloud identity at all: its answer is owed to
     * the analytics-only guest credential, which is the only thing the server can key a refusal on
     * for someone who never signs in.
     */
    static func answerOwed(toIdentityKey identityKey: String?, userDefaults: UserDefaults) -> Bool? {
        guard userDefaults.bool(forKey: productAnalyticsPendingPushUserDefaultsKey),
            let answer = self.storedAnswer(userDefaults: userDefaults),
            userDefaults.string(forKey: productAnalyticsPendingPushIdentityUserDefaultsKey) == identityKey else {
            return nil
        }

        return answer
    }

    /// The user just answered here. Marked as given on this device, which is what makes it outlive
    /// later server values, and owed to the identity it was made under until that identity accepts it.
    static func recordLocalAnswer(isEnabled: Bool, identityKey: String?, userDefaults: UserDefaults) {
        userDefaults.set(isEnabled, forKey: productAnalyticsEnabledUserDefaultsKey)
        userDefaults.set(true, forKey: productAnalyticsAnsweredOnDeviceUserDefaultsKey)
        self.setPendingPush(identityKey: identityKey, userDefaults: userDefaults)
    }

    /**
     * The server reported `isEnabled` as `identityKey`'s stored answer.
     *
     * The answer given on this device wins on this device, so a reported value is adopted only over a
     * mirror of an earlier reported one, or over nothing at all. Adopting over an answer made here
     * would silently undo it: the account's column can be written by any other client on it, and it
     * still reads `true` for an account that was answered before this device ever opted out. A mirror
     * carries no such choice, and holding on to it would only make two installs on one account
     * disagree about what the switch reads.
     *
     * When this device holds an answer of its own and the identity has none — `nil` is the absence of
     * an answer, never an instruction — the held answer becomes owed to that identity and the next
     * push stores it there. That is what carries a choice across an account deletion and re-signup on
     * the same device. When the identity has an explicit answer of its own, this device keeps its own
     * and leaves the identity's alone, so signing into an account somebody answered elsewhere neither
     * flips this device nor overwrites their choice.
     *
     * Reaching the write below means no answer was given here, and a pending push is only ever owed
     * for one that was, so neither marker can already be set on that branch.
     */
    static func adoptServerAnswer(_ isEnabled: Bool?, identityKey: String, userDefaults: UserDefaults) {
        guard self.isAnswerGivenOnThisDevice(userDefaults: userDefaults) == false else {
            guard isEnabled == nil else {
                return
            }

            self.setPendingPush(identityKey: identityKey, userDefaults: userDefaults)
            return
        }
        guard let isEnabled else {
            return
        }

        userDefaults.set(isEnabled, forKey: productAnalyticsEnabledUserDefaultsKey)
    }

    /**
     * A push to `identityKey` finished, and `acknowledged` is what its column now holds.
     *
     * The debt is cleared only when the acknowledged value is still the answer this device owes. A
     * different one means the answer changed while the body was in flight, or that an older body won
     * the race, so the debt has to survive and the caller has to send again — otherwise the server
     * keeps a value nobody chose with no retry left to repair it. The stored answer is never written
     * here: a push settles a debt, it does not decide the answer.
     *
     * The three outcomes are reported apart because only one of them means a server took the answer.
     * A caller that folds `debtMoved` into `settled` tells the person their choice was saved when no
     * column holds it.
     */
    static func settlePush(
        acknowledged: Bool?,
        identityKey: String?,
        userDefaults: UserDefaults
    ) -> PushSettlement {
        guard let owedAnswer = self.answerOwed(toIdentityKey: identityKey, userDefaults: userDefaults) else {
            return .debtMoved
        }
        guard acknowledged == owedAnswer else {
            return .disagreed
        }

        self.clearPendingPush(userDefaults: userDefaults)
        return .settled
    }

    /// What one push's response did to the debt it was sent to settle.
    enum PushSettlement {
        /// The identity's column now holds the answer this device owed it, and the debt is cleared.
        case settled
        /// The acknowledged value still disagrees, so the debt survives and the caller sends again.
        case disagreed
        /// Nothing is owed to this identity any more. A cloud identity reset landing while the body
        /// was in flight re-owes the answer to the credential this install holds next, so this
        /// response settles nothing and the choice is stored on no server.
        case debtMoved
    }

    /// Whether this device still owes its answer to some identity, whichever one that is. Distinguishes
    /// a debt that moved to another identity from one that is genuinely paid, which a drain scoped to a
    /// single identity cannot tell apart on its own.
    static func isAnswerOwedToAnyIdentity(userDefaults: UserDefaults) -> Bool {
        userDefaults.bool(forKey: productAnalyticsPendingPushUserDefaultsKey)
            && self.storedAnswer(userDefaults: userDefaults) != nil
    }

    /**
     * The identity this device answered for is gone.
     *
     * An answer given here survives: it is a privacy choice made on this device and must not silently
     * revert. Its binding to the identity that left does not, so the answer becomes owed to the
     * analytics-only guest credential instead — `nil` — which is the only identity a disconnected
     * install has and the one the server keys its ingest-time refusal on. Re-owing rather than
     * clearing is what keeps the answer marked as stored nowhere, so the next identity that reports
     * none is handed it; clearing outright would leave it owed to nobody and silently stored only on
     * this device. It is still handed on from there only to an identity that has no answer of its own.
     *
     * For someone who refused, that debt simply idles: no analytics-only credential is minted while
     * recording is disabled, so nothing carries it until they re-enable here or sign in, and the `/me`
     * read re-points it to that account. The value is in the opt-in direction and in staying honest
     * about what the server holds, not in repairing a `NULL` column that stays `NULL` either way.
     *
     * Callers must clear the stored credentials before this runs, so the credential the re-armed debt
     * is owed to never saw the answer, and a reset repeated over unchanged state cannot re-send it to
     * one that already accepted it.
     *
     * A value merely mirrored from the identity that left is dropped rather than re-owed: this device
     * never chose it, and keeping it would show the next person the previous one's switch while their
     * own column stays `NULL` and their other installs read the opposite. With the mirror gone, the
     * next identity's own answer is adopted normally and an install with no answer anywhere reads as
     * enabled again.
     */
    static func clearIdentityBindingForCloudIdentityReset(userDefaults: UserDefaults) {
        guard self.isAnswerGivenOnThisDevice(userDefaults: userDefaults) else {
            userDefaults.removeObject(forKey: productAnalyticsEnabledUserDefaultsKey)
            return
        }

        self.setPendingPush(identityKey: nil, userDefaults: userDefaults)
    }

    /// Whether the stored answer is one the user gave here, rather than a mirror of a reported value.
    private static func isAnswerGivenOnThisDevice(userDefaults: UserDefaults) -> Bool {
        userDefaults.bool(forKey: productAnalyticsAnsweredOnDeviceUserDefaultsKey)
    }

    private static func clearPendingPush(userDefaults: UserDefaults) {
        userDefaults.removeObject(forKey: productAnalyticsPendingPushUserDefaultsKey)
        userDefaults.removeObject(forKey: productAnalyticsPendingPushIdentityUserDefaultsKey)
    }

    private static func setPendingPush(identityKey: String?, userDefaults: UserDefaults) {
        userDefaults.set(true, forKey: productAnalyticsPendingPushUserDefaultsKey)
        if let identityKey {
            userDefaults.set(identityKey, forKey: productAnalyticsPendingPushIdentityUserDefaultsKey)
        } else {
            userDefaults.removeObject(forKey: productAnalyticsPendingPushIdentityUserDefaultsKey)
        }
    }
}
