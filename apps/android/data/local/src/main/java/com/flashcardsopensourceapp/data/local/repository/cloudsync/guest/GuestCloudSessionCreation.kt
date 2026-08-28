package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import com.flashcardsopensourceapp.data.local.ai.remote.GuestCloudSessionCreator
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import java.security.SecureRandom
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** 48 lowercase hexadecimal characters, inside the 32-200 the server accepts. */
private const val guestSessionIdempotencyKeyByteCount: Int = 24

private const val lowercaseHexDigits: String = "0123456789abcdef"

private val guestSessionRandom: SecureRandom = SecureRandom()

/**
 * The single creation path for the one guest identity an install is allowed to hold.
 *
 * Both creators go through it — the analytics mint and the cloud guest restore behind AI chat,
 * feedback and sync — and one instance is shared between them, because its mutex is the only thing
 * that keeps them apart. They otherwise serialize on different locks, and each creation is a
 * permanent server-side user, workspace and membership that `analytics.identity_links` cannot
 * repair afterwards:
 *
 * - two concurrent creations present the same pending idempotency key, the server rotates the named
 *   session's secret on the repeat, and the path that persists last stores the token the other one
 *   already killed — leaving AI chat, feedback and guest sync on `401 GUEST_AUTH_INVALID`;
 * - in the other ordering the second call runs after the first cleared the key and mints a **second
 *   permanent guest identity** for one install.
 *
 * The lock is deliberately not `CloudOperationCoordinator`: the request runs inside it, and the
 * cloud operation lock serializes user actions. Holding this one across the request does mean a user
 * action that needs a guest session can wait behind an analytics mint already in flight — bounded by
 * one HTTP call, after which that action finds the session stored and makes no request of its own.
 */
class GuestCloudSessionCreationCoordinator(
    private val guestSessionStore: GuestAiSessionStore,
    private val guestSessionCreator: GuestCloudSessionCreator
) {
    private val creationMutex = Mutex()

    /**
     * Returns the session this install already holds, or creates the one it is allowed to hold.
     *
     * [isAnalyticsOnly] marks a guest minted purely to authenticate product analytics. It is applied
     * only to a session created here; a session that already exists keeps the marker it was stored
     * with, so an analytics mint never re-labels a guest that owns cloud data, and a cloud restore
     * never silently adopts one either — `finishGuestCloudLink` clears the marker when it takes it
     * over.
     */
    suspend fun loadOrCreateGuestCloudSession(
        configuration: CloudServiceConfiguration,
        isAnalyticsOnly: Boolean
    ): StoredGuestAiSession {
        return creationMutex.withLock {
            // Re-read under the lock: the caller's own lookup ran before it, and the other creation
            // path may have persisted a session in between.
            guestSessionStore.loadAnySession(configuration = configuration)
                ?: createGuestCloudSessionLocked(
                    configuration = configuration,
                    isAnalyticsOnly = isAnalyticsOnly
                )
        }
    }

    private suspend fun createGuestCloudSessionLocked(
        configuration: CloudServiceConfiguration,
        isAnalyticsOnly: Boolean
    ): StoredGuestAiSession {
        val idempotencyKey: String = guestSessionStore.loadPendingCreationIdempotencyKey()
            ?: newGuestSessionIdempotencyKey().also(guestSessionStore::savePendingCreationIdempotencyKey)
        val createdSession: StoredGuestAiSession = guestSessionCreator.createGuestSession(
            apiBaseUrl = configuration.apiBaseUrl,
            configurationMode = configuration.mode,
            idempotencyKey = idempotencyKey
        )
        val session: StoredGuestAiSession = createdSession.copy(isAnalyticsOnly = isAnalyticsOnly)
        // Persisted unbound to a local workspace, and before the key is dropped. Committing first is
        // what makes the key's guarantee real: anything the caller does between the response and its
        // own persist can fail, and a lost key leaves a live server-side guest nothing names. A
        // later `finishGuestCloudLink` rebinds this entry to the guest's workspace key.
        guestSessionStore.saveSession(localWorkspaceId = null, session = session)
        // The key is dropped once the attempt has succeeded because rotation hands whoever presents
        // it a fresh valid token for that guest's user and workspace.
        guestSessionStore.clearPendingCreationIdempotencyKey()
        return session
    }
}

/**
 * Rendered by hand rather than through `String.format`, which resolves its digits against the
 * default locale.
 */
private fun newGuestSessionIdempotencyKey(): String {
    val randomBytes = ByteArray(guestSessionIdempotencyKeyByteCount)
    guestSessionRandom.nextBytes(randomBytes)
    return buildString(capacity = randomBytes.size * 2) {
        randomBytes.forEach { randomByte ->
            val unsignedValue: Int = randomByte.toInt() and 0xFF
            append(lowercaseHexDigits[unsignedValue ushr 4])
            append(lowercaseHexDigits[unsignedValue and 0x0F])
        }
    }
}
