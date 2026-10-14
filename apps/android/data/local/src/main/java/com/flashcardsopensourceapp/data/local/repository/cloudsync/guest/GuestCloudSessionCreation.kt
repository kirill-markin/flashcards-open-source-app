package com.flashcardsopensourceapp.data.local.repository.cloudsync.guest

import com.flashcardsopensourceapp.data.local.ai.remote.GuestCloudSessionCreator
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import java.security.SecureRandom
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** 48 lowercase hexadecimal characters, inside the 32-200 the server accepts. */
private const val guestSessionIdempotencyKeyByteCount: Int = 24

private const val lowercaseHexDigits: String = "0123456789abcdef"

private val guestSessionRandom: SecureRandom = SecureRandom()

/**
 * One creation per install: concurrent retries rotate the same guest token, while a new key mints
 * a second permanent identity. Keep lookup, request and durable save under the creation mutex.
 * Callers hold the shared cloud operation coordinator across configuration capture and creation,
 * so an identity reset or server change cannot cross the encrypted persistence suspensions.
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
            withContext(Dispatchers.IO) {
                guestSessionStore.loadAnySession(configuration = configuration)
            } ?: createGuestCloudSessionLocked(
                configuration = configuration,
                isAnalyticsOnly = isAnalyticsOnly
            )
        }
    }

    private suspend fun createGuestCloudSessionLocked(
        configuration: CloudServiceConfiguration,
        isAnalyticsOnly: Boolean
    ): StoredGuestAiSession {
        val idempotencyKey: String = withContext(Dispatchers.IO) {
            guestSessionStore.loadPendingCreationIdempotencyKey()
                ?: newGuestSessionIdempotencyKey().also(guestSessionStore::savePendingCreationIdempotencyKey)
        }
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
        withContext(Dispatchers.IO) {
            guestSessionStore.saveSession(localWorkspaceId = null, session = session)
            guestSessionStore.clearPendingCreationIdempotencyKey()
        }
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
