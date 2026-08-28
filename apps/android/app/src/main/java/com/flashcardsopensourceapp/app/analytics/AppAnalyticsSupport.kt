package com.flashcardsopensourceapp.app.analytics

import android.database.sqlite.SQLiteFullException
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsCredential
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsCredentialProvider
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsLaunchType
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSyncFailureReason
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.shouldRefreshCloudIdToken
import com.flashcardsopensourceapp.data.local.network.isLikelyTransientNetworkIoException
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.AnalyticsGuestSessionMinter
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException

private const val maxAnalyticsFailureCauseDepth: Int = 8

/**
 * Process-scoped so exactly one launch per process is `cold`. It deliberately does not live in
 * `AppGraph`, which can be torn down and rebuilt inside a running process.
 */
private val hasReportedColdLaunch = AtomicBoolean(false)

/**
 * Whether the process is currently in the foreground, so `app_opened` counts foreground entries
 * rather than observer registrations.
 *
 * `ProcessLifecycleOwner` already ignores configuration changes and intra-app activity
 * transitions, but adding an observer replays the current state to it. The observer is registered
 * once per process from `FlashcardsApplication`, so that replay happens at most once; the flag
 * keeps it a no-op regardless, so only a real background-to-foreground transition produces an
 * event. It is process-scoped for the same reason the observer is: `AppGraph` is rebuilt inside a
 * running process, and `FlashcardsApp` returns early on three branches before the composition
 * reaches any effect.
 */
private val isProcessForegrounded = AtomicBoolean(false)

/**
 * Process-wide kill switch, set by the instrumentation runner before the application exists.
 *
 * Instrumentation signs into a real account in the live-smoke flow, so anything a test run emitted
 * would land in production `product_events` indistinguishable from a real person's rows. This is
 * process-scoped rather than graph-scoped because the graph is rebuilt several times per test and
 * most instrumentation classes never touch the reset rule.
 */
private val productAnalyticsDisabledForProcess = AtomicBoolean(false)

/**
 * Bounds guest minting to one attempt per process. Process-scoped rather than graph-scoped for the
 * same reason as the flags above: `AppGraph` is rebuilt inside a running process.
 */
private val hasAttemptedAnalyticsGuestMint = AtomicBoolean(false)

internal fun disableProductAnalyticsForProcess() {
    productAnalyticsDisabledForProcess.set(true)
}

internal fun isProductAnalyticsDisabledForProcess(): Boolean {
    return productAnalyticsDisabledForProcess.get()
}

/** Returns null when the process was already foregrounded, which is not a new app open. */
internal fun consumeAnalyticsForegroundEntry(): AnalyticsLaunchType? {
    if (isProcessForegrounded.compareAndSet(false, true).not()) {
        return null
    }
    return if (hasReportedColdLaunch.compareAndSet(false, true)) {
        AnalyticsLaunchType.COLD
    } else {
        AnalyticsLaunchType.WARM
    }
}

internal fun markAnalyticsProcessBackgrounded() {
    isProcessForegrounded.set(false)
}

/**
 * Supplies the human-authenticated transport the analytics endpoint requires.
 *
 * It deliberately never refreshes an account token: analytics may not drive auth traffic. A
 * signed-in install whose id token has expired therefore keeps its events queued, which the 14-day
 * queue TTL and the 30-day server window make free.
 *
 * An install that never signs in has no account token to wait for, so the first credential miss
 * mints a guest session instead. That credential is read independently of `cloudState`, because an
 * install now commonly holds one while not being a cloud guest. Being its only user, this provider
 * is also the only thing that can notice the server revoking it, which is what
 * [onCredentialRefused] is for.
 */
internal class AppAnalyticsCredentialProvider(
    private val cloudPreferencesStore: CloudPreferencesStore,
    private val guestAiSessionStore: GuestAiSessionStore,
    private val analyticsGuestSessionMinter: AnalyticsGuestSessionMinter,
    private val reportGuestSessionMintFailure: () -> Unit = {},
    private val currentTimeMillisProvider: () -> Long = System::currentTimeMillis
) : AnalyticsCredentialProvider {
    override suspend fun currentCredential(): AnalyticsCredential? {
        val configuration: CloudServiceConfiguration = cloudPreferencesStore.currentServerConfiguration()
        val cloudSettings: CloudSettings = cloudPreferencesStore.currentCloudSettings()

        return when (cloudSettings.cloudState) {
            CloudAccountState.LINKED -> bearerCredential(configuration = configuration)
            // A guest session missing under `GUEST` is the credential-recovery flow's business, not
            // something to mint over: that install already owns a guest workspace on the server.
            CloudAccountState.GUEST -> guestCredential(configuration = configuration)
            CloudAccountState.DISCONNECTED, CloudAccountState.LINKING_READY ->
                guestCredential(configuration = configuration)
                    ?: mintedGuestCredential()
        }
    }

    /**
     * Retires an analytics-only guest the server has revoked, so a later process mints a fresh one.
     *
     * Nothing else on this install ever exercises such a credential. A cloud guest is validated and
     * cleared on `GUEST_AUTH_INVALID` by AI chat, feedback and sync; an analytics-only guest has no
     * other user, and [guestCredential] returns whatever is stored while [mintedGuestCredential] is
     * unreachable as long as it is. Left in place it would be handed back on every flush and
     * analytics for that install would stay silent until the 14-day queue TTL discarded the events.
     *
     * Only `401` and `410` retire it: those are the revoked-credential and deleted-account answers.
     * A `403` is an authorization refusal that says nothing about the credential being dead.
     *
     * The replacement arrives on the next process rather than immediately, because the mint stays
     * bounded to one attempt per process. That is deliberate: every mint is a permanent server-side
     * user, workspace and membership, and a refusal loop must never be able to create them in a row.
     */
    override suspend fun onCredentialRefused(credential: AnalyticsCredential, statusCode: Int) {
        if (statusCode != 401 && statusCode != 410) {
            return
        }

        try {
            retireRefusedAnalyticsGuestSession(credential = credential)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // The next refusal retries. `AnalyticsClient` reports everything that escapes a
            // non-enqueue command as `QUEUE_STORE_READ_FAILED`, which a store write fault here is
            // not, and the refusal itself is already handled by the caller's backoff.
        }
    }

    private fun retireRefusedAnalyticsGuestSession(credential: AnalyticsCredential) {
        val configuration: CloudServiceConfiguration = cloudPreferencesStore.currentServerConfiguration()
        val guestSession: StoredGuestAiSession = guestAiSessionStore.loadAnySession(
            configuration = configuration
        ) ?: return
        if (guestSession.isAnalyticsOnly.not()) {
            return
        }
        // The refused credential has to be this session: a bearer token, or a guest already replaced
        // between the flush and this callback, says nothing about what is stored now.
        if (credential.authorizationHeader != guestAuthorizationHeader(guestSession = guestSession)) {
            return
        }

        // Not the two keys it happens to sit under: a session bound to another local workspace would
        // survive and be presented as the next analytics credential.
        guestAiSessionStore.clearStoredSessions()
    }

    /**
     * Bounded to one attempt per process: every mint is a permanent server-side user, workspace and
     * membership, and the credential miss repeats on every flush. A failed attempt leaves the events
     * queued exactly as before and the persisted idempotency key makes the next process reuse rather
     * than duplicate.
     *
     * The failure is swallowed here rather than left to the caller. This is the only request this
     * provider makes, and `AnalyticsClient`'s command loop reports everything that escapes a
     * non-enqueue command as `QUEUE_STORE_READ_FAILED`, so an offline first launch — the likeliest
     * mint failure by far — would be filed as a SQLite read fault.
     */
    private suspend fun mintedGuestCredential(): AnalyticsCredential? {
        if (isProductAnalyticsDisabledForProcess()) {
            return null
        }
        if (cloudPreferencesStore.loadCloudCredentialRecoveryState() != null) {
            return null
        }
        if (hasAttemptedAnalyticsGuestMint.compareAndSet(false, true).not()) {
            return null
        }

        val guestSession: StoredGuestAiSession = try {
            analyticsGuestSessionMinter.mintAnalyticsGuestSession()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (isSilentAnalyticsGuestMintFailure(error = error).not()) {
                reportGuestSessionMintFailure()
            }
            return null
        }
        return AnalyticsCredential(
            apiBaseUrl = guestSession.apiBaseUrl,
            authorizationHeader = guestAuthorizationHeader(guestSession = guestSession)
        )
    }

    private fun bearerCredential(configuration: CloudServiceConfiguration): AnalyticsCredential? {
        val credentials: StoredCloudCredentials = cloudPreferencesStore.loadCredentials() ?: return null
        if (
            shouldRefreshCloudIdToken(
                idTokenExpiresAtMillis = credentials.idTokenExpiresAtMillis,
                nowMillis = currentTimeMillisProvider()
            )
        ) {
            return null
        }

        return AnalyticsCredential(
            apiBaseUrl = configuration.apiBaseUrl,
            authorizationHeader = "Bearer ${credentials.idToken}"
        )
    }

    private fun guestCredential(configuration: CloudServiceConfiguration): AnalyticsCredential? {
        val guestSession: StoredGuestAiSession = guestAiSessionStore.loadAnySession(
            configuration = configuration
        ) ?: return null

        return AnalyticsCredential(
            apiBaseUrl = guestSession.apiBaseUrl,
            authorizationHeader = guestAuthorizationHeader(guestSession = guestSession)
        )
    }

    /** Rendered in one place so [onCredentialRefused] can recognise a credential it handed out. */
    private fun guestAuthorizationHeader(guestSession: StoredGuestAiSession): String {
        return "Guest ${guestSession.guestToken}"
    }
}

/**
 * Offline and transient transport failures stay unreported, the same way every other background
 * capture path in this repository treats them: on a first launch without connectivity the mint is
 * expected to fail, and the events simply stay queued for the next process.
 */
private fun isSilentAnalyticsGuestMintFailure(error: Throwable): Boolean {
    var currentError: Throwable? = error
    var depth = 0
    while (currentError != null && depth < maxAnalyticsFailureCauseDepth) {
        val inspectedError: Throwable = currentError
        if (inspectedError is IOException && isLikelyTransientNetworkIoException(error = inspectedError)) {
            return true
        }
        currentError = inspectedError.cause
        depth += 1
    }
    return false
}

/**
 * Maps a Compose navigation route onto the shared cross-platform surface enum. Native destination
 * names are never sent: cross-platform funnel comparison is the only reason the enum is shared.
 *
 * Every destination registered in `navigation/` is covered today, so nothing reachable falls
 * through to `null`: `review` and `review/preview`; `cards`; `ai`; `progress`; the three
 * `cards/editor/…` steps; `settings` and every `settings/…` leaf, of which
 * `settings/decks/detail/{deckId}` and `settings/decks/all-cards` are the two that report
 * `deck_detail` instead of `settings`.
 *
 * `catalog` and `onboarding` have no Android destination today, so no route maps onto them. When a
 * destination is added that belongs on either, map it here: an unmapped route ends the previous
 * surface's visit at the call site, so leaving it unmapped costs the view rather than corrupting
 * the counts, but it still costs it.
 */
internal fun analyticsSurfaceForRoute(route: String?): AnalyticsSurface? {
    val normalizedRoute: String = route?.trim().orEmpty()
    if (normalizedRoute.isEmpty()) {
        return null
    }

    return when {
        normalizedRoute.startsWith(prefix = "cards/editor") -> AnalyticsSurface.CARD_EDITOR
        normalizedRoute.startsWith(prefix = "settings/decks/detail") ||
            normalizedRoute == "settings/decks/all-cards" -> AnalyticsSurface.DECK_DETAIL
        normalizedRoute == "settings" || normalizedRoute.startsWith(prefix = "settings/") -> AnalyticsSurface.SETTINGS
        normalizedRoute == "review" || normalizedRoute.startsWith(prefix = "review/") -> AnalyticsSurface.REVIEW
        normalizedRoute == "cards" -> AnalyticsSurface.CARDS
        normalizedRoute == "ai" -> AnalyticsSurface.AI
        normalizedRoute == "progress" -> AnalyticsSurface.PROGRESS
        else -> null
    }
}

/** Maps a sync failure onto the closed reason set the server catalog declares. */
internal fun analyticsSyncFailureReason(error: Throwable): AnalyticsSyncFailureReason {
    var currentError: Throwable? = error
    var depth = 0
    while (currentError != null && depth < maxAnalyticsFailureCauseDepth) {
        val inspectedError: Throwable = currentError
        when (inspectedError) {
            is SQLiteFullException -> return AnalyticsSyncFailureReason.STORAGE_FULL
            is SyncBlockedException -> return AnalyticsSyncFailureReason.CONFLICT
            is SocketTimeoutException -> return AnalyticsSyncFailureReason.TIMEOUT
            is IOException -> return AnalyticsSyncFailureReason.OFFLINE
            is CloudRemoteException -> return analyticsCloudSyncFailureReason(error = inspectedError)
            else -> Unit
        }
        currentError = inspectedError.cause
        depth += 1
    }
    return AnalyticsSyncFailureReason.SERVER_ERROR
}

private fun analyticsCloudSyncFailureReason(error: CloudRemoteException): AnalyticsSyncFailureReason {
    if (
        error.syncConflict != null ||
        error.errorCode?.trim()?.uppercase() == "SYNC_WORKSPACE_FORK_REQUIRED"
    ) {
        return AnalyticsSyncFailureReason.CONFLICT
    }

    return when (error.statusCode) {
        401, 403 -> AnalyticsSyncFailureReason.UNAUTHORIZED
        408, 504 -> AnalyticsSyncFailureReason.TIMEOUT
        409 -> AnalyticsSyncFailureReason.CONFLICT
        else -> AnalyticsSyncFailureReason.SERVER_ERROR
    }
}
