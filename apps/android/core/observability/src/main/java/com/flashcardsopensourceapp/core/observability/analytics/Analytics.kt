package com.flashcardsopensourceapp.core.observability.analytics

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Product analytics entry point.
 *
 * A user action must never be blocked, delayed or failed by anything behind this interface:
 * [track] is fire-and-forget into a local queue and every network path is off the interaction path.
 */
interface Analytics {
    /** Never suspends, never throws, never touches the database on the calling thread. */
    fun track(event: AnalyticsEvent)

    /** Asks for a delivery attempt. Returns immediately; delivery happens on the IO dispatcher. */
    fun flush()

    /**
     * Drains the queue and suspends until it has left the device, or until an internal two-second
     * bound expires, whichever comes first. Never throws.
     *
     * The one exception to the rule above this interface, and it is the whole point of the call: a
     * person pressed a control that is about to destroy the credential everything queued would go
     * out on — the sign-out, or the account deletion — and [reset] then discards that queue. This is
     * the last moment those events can be delivered, and the control shows its ordinary loading
     * state while it happens.
     *
     * Only a pressed control may call it, and only the two a person presses to leave an account. A
     * teardown nobody pressed — an expired credential, an account context that came back naming
     * somebody else, a silent restore that did not resolve — has no control to show a wait on, and
     * loses its queued events; the `signed_out` catalog entry states that under-count so it is
     * visible in the data. The credential-recovery erase is pressed and still does not call it, for
     * its own reason, the same one the `signed_out` catalog entry and the iOS client give: the
     * credential it would drain with is the one being erased, and every reason this client raises
     * that gate for is a stored credential that is missing or unusable, so the provider behind the
     * drain finds nothing to send at all. Nothing is minted in its place either, here or on iOS:
     * `AppAnalyticsCredentialProvider.mintedGuestCredential` returns null while a recovery state is
     * stored, and `CloudIdentityResetCoordinator.eraseLocalDataForCredentialRecovery` requires one.
     * Nothing may put this call, or any other suspension, inside
     * `CloudIdentityResetCoordinator`, between a teardown's precondition and its clears.
     *
     * On expiry the drain is left running rather than cancelled: a request already on the wire is
     * better finished than abandoned, and the caller is only released from waiting for it.
     */
    suspend fun drainBeforeIdentityTeardown()

    /**
     * Connectivity came back. Clears a backoff that only an offline stretch produced and asks for a
     * delivery attempt; a `429`/`5xx` backoff is deliberately left alone.
     */
    fun onConnectivityRestored()

    /**
     * Identity boundary: logout, an account switch, a server change, the credential-recovery erase,
     * and an account deletion — whether this device asked for it or discovered it as a `410
     * ACCOUNT_DELETED` answer while syncing.
     *
     * Rotates `anonymous_id` so a second person on this install does not inherit the first person's
     * identity, and **discards** whatever is still queued. Queued events belong to the person who is
     * leaving, and the server attributes a batch to the credential that carries it, so anything left
     * behind would land under the next person's account, permanently, on an append-only table. The
     * discarded count is reported through the platform's error reporter, never as an
     * `analytics_events_dropped` reason.
     *
     * Nothing rescues those events from here, and nothing may try: a flush started from this path is
     * ordered after the credential is cleared, and an awaited one would put a suspension inside the
     * teardown between its precondition and its clears. The rescue lives at the pressed controls
     * instead, in [drainBeforeIdentityTeardown], called before the teardown starts.
     *
     * Unlike [track] this may not be dropped, and it may not be deferred either: the durable half of
     * the boundary — rotating the stored `anonymous_id` — happens synchronously on the calling
     * thread, so a process death immediately afterwards still finds a rotated id on disk and the
     * outgoing person's rows unsendable. Only the queue delete and the reporting are asynchronous.
     *
     * That synchronous half is a single `SharedPreferences` commit and does no network or database
     * work, so it never delays a user action; call it off the main thread all the same.
     */
    fun reset()

    /** Kill switch, honored immediately. Disabling also drops whatever is still queued. */
    fun setEnabled(enabled: Boolean)
}

object NoOpAnalytics : Analytics {
    override fun track(event: AnalyticsEvent) = Unit

    override fun flush() = Unit

    override suspend fun drainBeforeIdentityTeardown() = Unit

    override fun onConnectivityRestored() = Unit

    override fun reset() = Unit

    override fun setEnabled(enabled: Boolean) = Unit
}

/**
 * Whether the `signed_out` row for the sign-out currently being attempted has already been written.
 *
 * One instance per process, shared by every control that performs the deliberate sign-out, because
 * the two that exist sit on different screens behind different view models: the account screen's
 * *Log out*, and the log out the sign-in flow offers as its failure action. A sign-out that throws
 * on the first leaves the person signed in with the row already delivered, and the retry is commonly
 * made on the second, so a per-view-model flag would write a second permanent row for one departure
 * into an append-only table. iOS holds the same flag on its shared store, for the same reason.
 *
 * It is not the once-per-sign-out marker the old teardown-side design needed: it keys on nothing a
 * teardown clears, and it guards only the retry after a teardown that threw. The cost, stated: a
 * sign-out abandoned after a failure and completed much later reports nothing. On a table with no
 * repair path that is the direction to lose in.
 */
class PendingSignOutReport {
    private val isReported = AtomicBoolean(false)

    /**
     * Claims the row for this attempt. `true` means this caller now owes the event; `false` means an
     * earlier attempt at the same departure already wrote it and this one must not.
     */
    fun claim(): Boolean = isReported.compareAndSet(false, true)

    /**
     * Releases the claim so the next person on this install reports their own sign-out.
     *
     * Called from the identity boundary — `AppGraph`'s `onCloudIdentityReset` hook — and not from
     * the control, for reasons in both directions. Released any earlier, before
     * `CloudIdentityResetCoordinator` has cleared the credentials, a retry would post a second row
     * under the departing credential and the server would file both against that same account.
     * Never released, a teardown that threw after those clears would strand the flag set on a device
     * that has already left, and the sign-in sheet's failure action dismisses itself on its error
     * path, so no control would be left to release it.
     */
    fun release() {
        isReported.set(false)
    }
}

/**
 * Emits `sync_failed` at the transition **into** failure rather than once per attempt.
 *
 * Sync is retried on a timer, so a per-attempt event would turn an append-only table into a
 * measurement of poll cadence instead of failure incidence, and an offline device would fill its
 * 5000-event queue with repeats that evict the real events. A failure already reported in the
 * current episode is suppressed while it persists, and the next success re-arms everything, so one
 * failure episode costs one event per distinct way it failed.
 *
 * The gate is keyed on the reason **and** the screen, not on the reason alone. `screen` is the only
 * thing in the frozen catalog that separates a deliberate Settings → *Sync now* from a background
 * poll, and the poll runs every 15 s on Review and Cards, so a reason-only key would let the poll
 * consume the episode first and systematically erase the deliberate action — the rarer and more
 * informative of the two — exactly during the outages where it matters.
 */
class AnalyticsSyncFailureReporter(
    private val analytics: Analytics
) {
    /**
     * Reported failures of the current episode. A set rather than a last-value slot: with a
     * two-part key, a last-value slot would re-emit the background failure every time a user-driven
     * one interleaved with it, which is the poll-cadence measurement this gate exists to prevent.
     */
    private val reportedFailures: MutableSet<AnalyticsSyncFailureSignature> =
        ConcurrentHashMap.newKeySet<AnalyticsSyncFailureSignature>()

    fun reportFailure(
        reason: AnalyticsSyncFailureReason,
        screen: AnalyticsSurface? = null
    ) {
        val signature = AnalyticsSyncFailureSignature(reason = reason, screen = screen)
        if (reportedFailures.add(signature).not()) {
            return
        }
        analytics.track(event = AnalyticsEvent.SyncFailed(reason = reason, screen = screen))
    }

    /** Re-arms the next failure of any reason, on any screen. */
    fun reportSuccess() {
        reportedFailures.clear()
    }
}

private data class AnalyticsSyncFailureSignature(
    val reason: AnalyticsSyncFailureReason,
    val screen: AnalyticsSurface?
)

/**
 * The endpoint requires a human-authenticated transport and accepts `bearer`, `session` and
 * `guest`. When no credential exists yet the client keeps events queued rather than sending an
 * unauthenticated batch; an ordinary sign-up delay costs nothing under the 14-day queue TTL.
 */
data class AnalyticsCredential(
    val apiBaseUrl: String,
    val authorizationHeader: String
)

fun interface AnalyticsCredentialProvider {
    suspend fun currentCredential(): AnalyticsCredential?

    /**
     * Reports that the server refused [credential] with [statusCode], so a provider that owns the
     * credential can retire it. The client itself only backs off and retries: without this, a
     * credential the server has revoked is handed back on every flush and analytics for that install
     * goes silent until the queue TTL discards it.
     *
     * An implementation must not make the refusal worse — no minting, no auth traffic — and must
     * swallow its own failures: the client does not guard this call, and anything that escapes it
     * is reported as a queue-store fault it is not.
     */
    suspend fun onCredentialRefused(credential: AnalyticsCredential, statusCode: Int) {
    }
}

fun interface AnalyticsNetworkStateProvider {
    fun currentNetworkState(): AnalyticsNetworkState
}
