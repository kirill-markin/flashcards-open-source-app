package com.flashcardsopensourceapp.data.local.ai.store

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import org.json.JSONException
import org.json.JSONObject

private const val guestAiSessionPreferencesName: String = "flashcards-ai-chat-guest-session"
private const val guestAiDefaultSessionKey: String = "guest-ai-session"
private const val guestAiWorkspaceSessionPrefix: String = "guest-ai-session::"
private const val guestSessionCreationIdempotencyPreferenceKey: String = "guest-session-creation-idempotency-key"

class GuestAiSessionStore(
    context: Context
) {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        guestAiSessionPreferencesName,
        Context.MODE_PRIVATE
    )

    fun loadSession(
        localWorkspaceId: String?,
        configuration: CloudServiceConfiguration
    ): StoredGuestAiSession? {
        val sessionStorageKey = storageKey(localWorkspaceId = localWorkspaceId)
        val rawValue = preferences.getString(sessionStorageKey, null)
            ?: return null
        val session = decodeSessionOrNull(rawValue = rawValue)
        if (
            session == null
            || session.apiBaseUrl != configuration.apiBaseUrl
            || session.configurationMode != configuration.mode
            || isWorkspaceBindingInvalid(storageKey = sessionStorageKey, session = session)
        ) {
            clearSessionByStorageKey(storageKey = sessionStorageKey)
            return null
        }

        return session
    }

    fun saveSession(localWorkspaceId: String?, session: StoredGuestAiSession) {
        val sessionStorageKey = storageKey(localWorkspaceId = localWorkspaceId)
        preferences.edit(commit = true) {
            duplicateSessionStorageKeys(
                session = session,
                targetStorageKey = sessionStorageKey
            ).forEach { duplicateStorageKey ->
                remove(duplicateStorageKey)
            }
            putString(sessionStorageKey, encodeSession(session = session).toString())
        }
    }

    /**
     * The one session this install is treated as holding, picked deterministically.
     *
     * `preferences.all` is a `HashMap`, so nothing may depend on the order it hands entries back. An
     * analytics-only entry wins over a cloud-owned one: it is the credential a sign-in still has to
     * claim through `/guest-auth/identity/link`, which is append-only and first-link-wins with no
     * repair path, while a cloud guest converts through the upgrade flow instead. Remaining ties are
     * broken on the storage key, so the answer is the same on every call.
     *
     * Every entry is inspected rather than stopping at the first usable one, which is also what
     * makes the invalid-entry cleanup below reach all of them.
     */
    fun loadAnySession(configuration: CloudServiceConfiguration): StoredGuestAiSession? {
        val invalidStorageKeys = mutableListOf<String>()
        val storedSessions: List<StoredGuestAiSession> = preferences.all.entries
            .filter { entry -> isSessionStorageKey(storageKey = entry.key) }
            .sortedBy { entry -> entry.key }
            .mapNotNull { entry ->
                val rawValue = entry.value as? String ?: return@mapNotNull null
                val session = decodeSessionOrNull(rawValue = rawValue)
                if (
                    session == null
                    || session.apiBaseUrl != configuration.apiBaseUrl
                    || session.configurationMode != configuration.mode
                    || isWorkspaceBindingInvalid(storageKey = entry.key, session = session)
                ) {
                    invalidStorageKeys += entry.key
                    return@mapNotNull null
                }
                session
            }

        if (invalidStorageKeys.isNotEmpty()) {
            preferences.edit(commit = true) {
                invalidStorageKeys.forEach(::remove)
            }
        }

        return storedSessions.firstOrNull { session -> session.isAnalyticsOnly }
            ?: storedSessions.firstOrNull()
    }

    fun clearSession(localWorkspaceId: String?) {
        preferences.edit(commit = true) {
            remove(storageKey(localWorkspaceId = localWorkspaceId))
        }
    }

    /**
     * The idempotency key of a guest session creation whose result is not durably stored yet. It
     * lives beside the session so a retry after a lost response reuses it and the server returns the
     * same guest identity, and so an identity reset drops both in one wipe.
     *
     * It is cleared only once the created session has been committed to this store, never merely
     * once the response was decoded: everything between those two points — a failed persist, a
     * process death, the network work a caller does before persisting — would otherwise leave a
     * server-side guest user, workspace and membership with no key naming them, and the next attempt
     * would create a second permanent identity.
     */
    fun loadPendingCreationIdempotencyKey(): String? {
        return preferences.getString(guestSessionCreationIdempotencyPreferenceKey, null)
    }

    fun savePendingCreationIdempotencyKey(idempotencyKey: String) {
        preferences.edit(commit = true) {
            putString(guestSessionCreationIdempotencyPreferenceKey, idempotencyKey)
        }
    }

    fun clearPendingCreationIdempotencyKey() {
        preferences.edit(commit = true) {
            remove(guestSessionCreationIdempotencyPreferenceKey)
        }
    }

    /**
     * Drops every stored session while leaving a pending creation idempotency key in place, for the
     * cleanups that retire this install's guest without ending anyone's use of the install.
     *
     * It scans for session keys rather than removing the two the caller happens to know about: a
     * session bound to another local workspace would otherwise survive and later be presented as an
     * analytics credential or sent to the identity-link route again.
     */
    fun clearStoredSessions() {
        val sessionStorageKeys: List<String> = preferences.all.keys.filter { storageKey ->
            isSessionStorageKey(storageKey = storageKey)
        }
        if (sessionStorageKeys.isEmpty()) {
            return
        }
        preferences.edit(commit = true) {
            sessionStorageKeys.forEach(::remove)
        }
    }

    /**
     * Drops the stored sessions that own cloud data, keeping any analytics-only guest and the
     * pending creation idempotency key.
     *
     * For a sign-in that has to retire this install's cloud guest while a guest minted purely to
     * authenticate product analytics is still waiting to be claimed through
     * `/guest-auth/identity/link`. That claim is first-link-wins on the server with no repair path,
     * so wiping the credential before it is presented orphans that guest's whole pre-sign-in tail
     * permanently.
     */
    fun clearCloudOwnedSessions() {
        val cloudOwnedStorageKeys: List<String> = preferences.all.entries.mapNotNull { entry ->
            if (isSessionStorageKey(storageKey = entry.key).not()) {
                return@mapNotNull null
            }
            val rawValue = entry.value as? String ?: return@mapNotNull entry.key
            // An entry this build cannot read is not a claimable analytics credential, so it goes
            // with the cloud-owned ones rather than failing the sign-in recovery this runs inside.
            val session = decodeSessionOrNull(rawValue = rawValue) ?: return@mapNotNull entry.key
            if (session.isAnalyticsOnly) {
                null
            } else {
                entry.key
            }
        }
        if (cloudOwnedStorageKeys.isEmpty()) {
            return
        }
        preferences.edit(commit = true) {
            cloudOwnedStorageKeys.forEach(::remove)
        }
    }

    /**
     * The identity-boundary wipe: sessions and the pending creation idempotency key together.
     *
     * Dropping the key is deliberate, and it is load-bearing rather than incidental now that the key
     * outlives the request it was minted for. A boundary — logout, account deletion, the credential
     * recovery erase — must leave the next creation minting a brand new guest user and workspace,
     * and a surviving key would instead rotate the pre-boundary guest's secret and hand this install
     * that identity back. A mint in flight across a boundary loses its key and creates a second
     * server-side guest, which is the correct outcome here: the first one belongs to the person who
     * left.
     */
    fun clearAllSessions() {
        preferences.edit(commit = true) {
            clear()
        }
    }

    private fun storageKey(localWorkspaceId: String?): String {
        if (localWorkspaceId.isNullOrBlank()) {
            return guestAiDefaultSessionKey
        }

        return guestAiWorkspaceSessionPrefix + localWorkspaceId
    }

    private fun isSessionStorageKey(storageKey: String): Boolean {
        return storageKey == guestAiDefaultSessionKey ||
            storageKey.startsWith(guestAiWorkspaceSessionPrefix)
    }

    private fun clearSessionByStorageKey(storageKey: String) {
        preferences.edit(commit = true) {
            remove(storageKey)
        }
    }

    private fun expectedWorkspaceId(storageKey: String): String? {
        return if (storageKey.startsWith(guestAiWorkspaceSessionPrefix)) {
            storageKey.removePrefix(guestAiWorkspaceSessionPrefix)
        } else {
            null
        }
    }

    private fun isWorkspaceBindingInvalid(storageKey: String, session: StoredGuestAiSession): Boolean {
        val expectedWorkspaceId = expectedWorkspaceId(storageKey = storageKey) ?: return false
        return expectedWorkspaceId != session.workspaceId
    }

    private fun duplicateSessionStorageKeys(
        session: StoredGuestAiSession,
        targetStorageKey: String
    ): List<String> {
        return preferences.all.entries.mapNotNull { entry ->
            if (entry.key == targetStorageKey || isSessionStorageKey(storageKey = entry.key).not()) {
                return@mapNotNull null
            }

            val rawValue = entry.value as? String ?: return@mapNotNull null
            val storedSession = decodeSessionOrNull(rawValue = rawValue) ?: return@mapNotNull null
            if (
                storedSession.configurationMode == session.configurationMode
                && storedSession.apiBaseUrl == session.apiBaseUrl
                && (
                    storedSession.guestToken == session.guestToken
                        || storedSession.workspaceId == session.workspaceId
                )
            ) {
                entry.key
            } else {
                null
            }
        }
    }

    private fun encodeSession(session: StoredGuestAiSession): JSONObject {
        return JSONObject()
            .put("guestToken", session.guestToken)
            .put("userId", session.userId)
            .put("workspaceId", session.workspaceId)
            .put("configurationMode", session.configurationMode.name)
            .put("apiBaseUrl", session.apiBaseUrl)
            .put("isAnalyticsOnly", session.isAnalyticsOnly)
    }

    /**
     * Null rather than a throw for a stored value this build cannot read: a truncated or malformed
     * write, and a `configurationMode` naming an enum constant this build does not have. The latter
     * is reachable rather than theoretical — this preferences file is deliberately inside cloud
     * backup and device transfer, so a restore can hand an install a session another build wrote.
     *
     * Every caller treats such an entry as invalid and drops it. Throwing would instead fail
     * whatever happens to read the store first, and one of those readers is
     * [clearCloudOwnedSessions] inside `completeLinkedCredentialRecoveryCloudLink`, where guest
     * session bookkeeping must never be able to fail a sign-in recovery.
     */
    private fun decodeSessionOrNull(rawValue: String): StoredGuestAiSession? {
        return try {
            decodeSession(rawValue = rawValue)
        } catch (_: JSONException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun decodeSession(rawValue: String): StoredGuestAiSession {
        val jsonObject = JSONObject(rawValue)
        return StoredGuestAiSession(
            guestToken = jsonObject.getString("guestToken"),
            userId = jsonObject.getString("userId"),
            workspaceId = jsonObject.getString("workspaceId"),
            configurationMode = CloudServiceConfigurationMode.valueOf(
                jsonObject.getString("configurationMode")
            ),
            apiBaseUrl = jsonObject.getString("apiBaseUrl"),
            // Absent on every session written before the marker existed, and those all belong to a
            // guest this install entered guest cloud state for.
            isAnalyticsOnly = jsonObject.optBoolean("isAnalyticsOnly", false)
        )
    }
}
