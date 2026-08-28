package com.flashcardsopensourceapp.core.observability.analytics

import java.util.concurrent.ConcurrentHashMap

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

    override fun onConnectivityRestored() = Unit

    override fun reset() = Unit

    override fun setEnabled(enabled: Boolean) = Unit
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
