package com.flashcardsopensourceapp.data.local.review.prompts

import android.content.Context
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.encodeReviewPromptConfig
import com.flashcardsopensourceapp.data.local.cloud.wire.parseReviewPromptConfig
import org.json.JSONException
import org.json.JSONObject

private const val reviewPromptConfigPreferencesName: String = "flashcards-review-prompt-config"
private const val remoteReviewPromptConfigKey: String = "remote-review-prompt-config"

/** `reviewPrompts` as GET /me sent it. */
sealed interface RemoteReviewPromptConfig {
    data class Valid(val config: ReviewPromptConfig) : RemoteReviewPromptConfig

    /** Rejected whole: the app reports it and keeps its current config. */
    data class Rejected(val error: CloudContractMismatchException) : RemoteReviewPromptConfig
}

/** The last valid server config, per install; the built-in defaults until the first one arrives. */
class ReviewPromptConfigStore(
    context: Context,
    /** Reported once: the unreadable copy is dropped and the built-in defaults apply until the next valid one. */
    private val onCacheUnreadable: (Throwable) -> Unit
) {
    private val preferences = context.getSharedPreferences(reviewPromptConfigPreferencesName, Context.MODE_PRIVATE)

    fun loadActiveConfig(): ReviewPromptConfig {
        val rawConfig: String = preferences.getString(remoteReviewPromptConfigKey, null)
            ?: return reviewPromptConfigDefaults
        return try {
            parseReviewPromptConfig(json = JSONObject(rawConfig), fieldPath = "cachedReviewPrompts")
        } catch (error: JSONException) {
            dropUnreadableCache(error = error)
        } catch (error: CloudContractMismatchException) {
            dropUnreadableCache(error = error)
        }
    }

    fun saveRemoteConfig(config: ReviewPromptConfig) {
        val rawConfig: String = encodeReviewPromptConfig(config = config).toString()
        if (preferences.getString(remoteReviewPromptConfigKey, null) == rawConfig) {
            return
        }
        preferences.edit(commit = true) {
            putString(remoteReviewPromptConfigKey, rawConfig)
        }
    }

    private fun dropUnreadableCache(error: Throwable): ReviewPromptConfig {
        onCacheUnreadable(error)
        preferences.edit(commit = true) {
            remove(remoteReviewPromptConfigKey)
        }
        return reviewPromptConfigDefaults
    }
}
