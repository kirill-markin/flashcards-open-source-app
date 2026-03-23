package com.flashcardsopensourceapp.data.local.ai

import android.content.Context
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
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
    private val preferences = EncryptedSharedPreferences.create(
        context,
        guestAiSessionPreferencesName,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun loadSession(
        localWorkspaceId: String?,
        configuration: CloudServiceConfiguration
    ): StoredGuestAiSession? {
        val rawValue = preferences.getString(storageKey(localWorkspaceId = localWorkspaceId), null)
            ?: return null
        val session = decodeSession(rawValue = rawValue)
        if (session.apiBaseUrl != configuration.apiBaseUrl || session.configurationMode != configuration.mode) {
            clearSession(localWorkspaceId = localWorkspaceId)
            return null
        }

        return session
    }

    fun saveSession(localWorkspaceId: String?, session: StoredGuestAiSession) {
        preferences.edit(commit = true) {
            putString(storageKey(localWorkspaceId = localWorkspaceId), encodeSession(session = session).toString())
        }
    }

    fun loadAnySession(configuration: CloudServiceConfiguration): StoredGuestAiSession? {
        val storedSession = preferences.all.values
            .asSequence()
            .mapNotNull { value ->
                (value as? String)?.let(::decodeSession)
            }
            .firstOrNull { session ->
                session.apiBaseUrl == configuration.apiBaseUrl && session.configurationMode == configuration.mode
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
