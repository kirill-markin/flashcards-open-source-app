package com.flashcardsopensourceapp.app.prompts.feedback

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

const val feedbackPromptPreferencesName: String = "feedback_prompt_preferences"

private const val lastAutomaticFeedbackPromptShownAtMillisKey: String =
    "lastAutomaticFeedbackPromptShownAtMillis"
private const val draftMessageKey: String = "draftMessage"

interface FeedbackPromptStore {
    fun loadState(identityKey: FeedbackPromptIdentityKey): FeedbackPromptLocalState
    fun recordAutomaticPromptShown(identityKey: FeedbackPromptIdentityKey, nowMillis: Long)
    fun saveDraftMessage(identityKey: FeedbackPromptIdentityKey, message: String)
    fun clearDraftMessage(identityKey: FeedbackPromptIdentityKey)
    fun clearAllAutomaticPromptShownAt()
}

class SharedPreferencesFeedbackPromptStore(
    context: Context
) : FeedbackPromptStore {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        feedbackPromptPreferencesName,
        Context.MODE_PRIVATE
    )

    override fun loadState(identityKey: FeedbackPromptIdentityKey): FeedbackPromptLocalState {
        return FeedbackPromptLocalState(
            lastAutomaticFeedbackPromptShownAtMillis = loadLongOrNull(
                identityKey = identityKey,
                key = lastAutomaticFeedbackPromptShownAtMillisKey
            ),
            draftMessage = preferences.getString(
                scopedKey(identityKey = identityKey, key = draftMessageKey),
                null
            ) ?: ""
        )
    }

    override fun recordAutomaticPromptShown(identityKey: FeedbackPromptIdentityKey, nowMillis: Long) {
        preferences.edit(commit = true) {
            putLong(
                scopedKey(identityKey = identityKey, key = lastAutomaticFeedbackPromptShownAtMillisKey),
                nowMillis
            )
        }
    }

    override fun saveDraftMessage(identityKey: FeedbackPromptIdentityKey, message: String) {
        val storageKey = scopedKey(identityKey = identityKey, key = draftMessageKey)
        preferences.edit {
            if (message.isEmpty()) {
                remove(storageKey)
            } else {
                putString(storageKey, message)
            }
        }
    }

    override fun clearDraftMessage(identityKey: FeedbackPromptIdentityKey) {
        preferences.edit(commit = true) {
            remove(scopedKey(identityKey = identityKey, key = draftMessageKey))
        }
    }

    override fun clearAllAutomaticPromptShownAt() {
        val shownAtKeySuffix = ":$lastAutomaticFeedbackPromptShownAtMillisKey"
        val shownAtStorageKeys = preferences.all.keys.filter { storageKey -> storageKey.endsWith(shownAtKeySuffix) }
        preferences.edit(commit = true) {
            shownAtStorageKeys.forEach { storageKey -> remove(storageKey) }
        }
    }

    private fun loadLongOrNull(identityKey: FeedbackPromptIdentityKey, key: String): Long? {
        val storageKey = scopedKey(identityKey = identityKey, key = key)
        if (preferences.contains(storageKey).not()) {
            return null
        }

        return preferences.getLong(storageKey, 0L)
    }
}

private fun scopedKey(identityKey: FeedbackPromptIdentityKey, key: String): String {
    return "${identityKey.value}:$key"
}
