package com.flashcardsopensourceapp.data.local.ai

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import org.json.JSONObject

private const val guestAiSessionPreferencesName: String = "flashcards-ai-chat-guest-session"
private const val guestAiDefaultSessionKey: String = "guest-ai-session"
private const val guestAiWorkspaceSessionPrefix: String = "guest-ai-session::"

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
        val session = decodeSession(rawValue = rawValue)
        if (
            session.apiBaseUrl != configuration.apiBaseUrl
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

    fun loadAnySession(configuration: CloudServiceConfiguration): StoredGuestAiSession? {
        val invalidStorageKeys = mutableListOf<String>()
        val storedSession = preferences.all.entries
            .asSequence()
            .mapNotNull { entry ->
                val rawValue = entry.value as? String ?: return@mapNotNull null
                val session = decodeSession(rawValue = rawValue)
                if (
                    session.apiBaseUrl != configuration.apiBaseUrl
                    || session.configurationMode != configuration.mode
                    || isWorkspaceBindingInvalid(storageKey = entry.key, session = session)
                ) {
                    invalidStorageKeys += entry.key
                    return@mapNotNull null
                }
                session
            }
            .firstOrNull()

        if (invalidStorageKeys.isNotEmpty()) {
            preferences.edit(commit = true) {
                invalidStorageKeys.forEach(::remove)
            }
        }

        return storedSession
    }

    fun clearSession(localWorkspaceId: String?) {
        preferences.edit(commit = true) {
            remove(storageKey(localWorkspaceId = localWorkspaceId))
        }
    }

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
            if (entry.key == targetStorageKey) {
                return@mapNotNull null
            }

            val rawValue = entry.value as? String ?: return@mapNotNull null
            val storedSession = decodeSession(rawValue = rawValue)
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
            apiBaseUrl = jsonObject.getString("apiBaseUrl")
        )
    }
}
