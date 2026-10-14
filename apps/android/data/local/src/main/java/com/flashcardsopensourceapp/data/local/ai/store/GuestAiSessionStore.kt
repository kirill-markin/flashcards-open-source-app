package com.flashcardsopensourceapp.data.local.ai.store

import android.content.Context
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.isSameCloudService
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import org.json.JSONException
import org.json.JSONObject

private const val guestAiDefaultSessionKey: String = "guest-ai-session"
private const val guestAiWorkspaceSessionPrefix: String = "guest-ai-session::"
private const val guestSessionCreationIdempotencyPreferenceKey: String = "guest-session-creation-idempotency-key"

class GuestAiSessionStore(
    context: Context
) {
    private val storage = GuestAiSessionStorage(context = context)

    fun loadSession(
        localWorkspaceId: String?,
        configuration: CloudServiceConfiguration
    ): StoredGuestAiSession? = synchronized(guestSessionsLock) {
        val sessionStorageKey = storageKey(localWorkspaceId = localWorkspaceId)
        val entries = storage.load()
        val rawValue = entries[sessionStorageKey]
            ?: return@synchronized null
        val session = decodeSessionOrNull(rawValue = rawValue)
        if (
            session == null
            || isSameCloudService(
                leftMode = session.configurationMode,
                leftApiBaseUrl = session.apiBaseUrl,
                rightMode = configuration.mode,
                rightApiBaseUrl = configuration.apiBaseUrl
            ).not()
            || isWorkspaceBindingInvalid(storageKey = sessionStorageKey, session = session)
        ) {
            storage.save(secrets = entries - sessionStorageKey)
            return@synchronized null
        }

        session
    }

    fun saveSession(localWorkspaceId: String?, session: StoredGuestAiSession) {
        synchronized(guestSessionsLock) {
            val sessionStorageKey = storageKey(localWorkspaceId = localWorkspaceId)
            val entries = storage.load()
            val duplicates = duplicateSessionStorageKeys(
                entries = entries,
                session = session,
                targetStorageKey = sessionStorageKey
            )
            storage.save(
                secrets = (entries - duplicates) +
                    (sessionStorageKey to encodeSession(session = session).toString())
            )
        }
    }

    // Analytics-only guests must be claimed before cloud-owned guests; key ordering breaks ties.
    fun loadAnySession(configuration: CloudServiceConfiguration): StoredGuestAiSession? = synchronized(guestSessionsLock) {
        val entries = storage.load()
        val invalidStorageKeys = mutableListOf<String>()
        val storedSessions: List<StoredGuestAiSession> = entries.entries
            .filter { entry -> isSessionStorageKey(storageKey = entry.key) }
            .sortedBy { entry -> entry.key }
            .mapNotNull { entry ->
                val rawValue = entry.value
                val session = decodeSessionOrNull(rawValue = rawValue)
                if (
                    session == null
                    || isSameCloudService(
                        leftMode = session.configurationMode,
                        leftApiBaseUrl = session.apiBaseUrl,
                        rightMode = configuration.mode,
                        rightApiBaseUrl = configuration.apiBaseUrl
                    ).not()
                    || isWorkspaceBindingInvalid(storageKey = entry.key, session = session)
                ) {
                    invalidStorageKeys += entry.key
                    return@mapNotNull null
                }
                session
            }

        if (invalidStorageKeys.isNotEmpty()) {
            storage.save(secrets = entries - invalidStorageKeys)
        }

        storedSessions.firstOrNull { session -> session.isAnalyticsOnly }
            ?: storedSessions.firstOrNull()
    }

    fun clearSession(localWorkspaceId: String?) {
        synchronized(guestSessionsLock) {
            storage.save(secrets = storage.load() - storageKey(localWorkspaceId = localWorkspaceId))
        }
    }

    // Keep the recovery key until the created session is durably committed, including after restart.
    fun loadPendingCreationIdempotencyKey(): String? = synchronized(guestSessionsLock) {
        storage.load()[guestSessionCreationIdempotencyPreferenceKey]
    }

    fun savePendingCreationIdempotencyKey(idempotencyKey: String) {
        synchronized(guestSessionsLock) {
            storage.save(secrets = storage.load() + (guestSessionCreationIdempotencyPreferenceKey to idempotencyKey))
        }
    }

    fun clearPendingCreationIdempotencyKey() {
        synchronized(guestSessionsLock) {
            storage.save(secrets = storage.load() - guestSessionCreationIdempotencyPreferenceKey)
        }
    }

    fun clearStoredSessions() {
        synchronized(guestSessionsLock) {
            val entries = storage.load()
            val sessionStorageKeys = entries.keys.filter { key -> isSessionStorageKey(storageKey = key) }
            if (sessionStorageKeys.isNotEmpty()) {
                storage.save(secrets = entries - sessionStorageKeys)
            }
        }
    }

    // Preserve the analytics-only credential until its first-link-wins identity claim succeeds.
    fun clearCloudOwnedSessions() {
        synchronized(guestSessionsLock) {
            val entries = storage.load()
            val cloudOwnedStorageKeys: List<String> = entries.entries.mapNotNull { entry ->
                if (isSessionStorageKey(storageKey = entry.key).not()) {
                    return@mapNotNull null
                }
                val session = decodeSessionOrNull(rawValue = entry.value)
                if (session?.isAnalyticsOnly == true) null else entry.key
            }
            if (cloudOwnedStorageKeys.isNotEmpty()) {
                storage.save(secrets = entries - cloudOwnedStorageKeys)
            }
        }
    }

    // A boundary must drop the recovery key too, so the next guest belongs to the next identity.
    // Clear without reading: explicit reset must work even when the encrypted record is unreadable.
    fun clearAllSessions() {
        storage.clear()
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
        entries: Map<String, String>,
        session: StoredGuestAiSession,
        targetStorageKey: String
    ): List<String> {
        return entries.entries.mapNotNull { entry ->
            if (entry.key == targetStorageKey || isSessionStorageKey(storageKey = entry.key).not()) {
                return@mapNotNull null
            }

            val rawValue = entry.value
            val storedSession = decodeSessionOrNull(rawValue = rawValue) ?: return@mapNotNull null
            if (
                isSameCloudService(
                    leftMode = storedSession.configurationMode,
                    leftApiBaseUrl = storedSession.apiBaseUrl,
                    rightMode = session.configurationMode,
                    rightApiBaseUrl = session.apiBaseUrl
                )
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
            isAnalyticsOnly = jsonObject.optBoolean("isAnalyticsOnly", false)
        )
    }
}
