package com.flashcardsopensourceapp.app

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.model.CloudFeedbackState

const val feedbackPromptPreferencesName: String = "feedback_prompt_preferences"

private const val lastAutomaticFeedbackPromptShownAtMillisKey: String =
    "lastAutomaticFeedbackPromptShownAtMillis"
private const val lastFeedbackSubmittedAtMillisKey: String = "lastFeedbackSubmittedAtMillis"
private const val nextAutomaticFeedbackPromptAtMillisKey: String = "nextAutomaticFeedbackPromptAtMillis"
private const val lastFeedbackStateFetchedAtMillisKey: String = "lastFeedbackStateFetchedAtMillis"
private const val lastFeedbackStateFetchAttemptAtMillisKey: String = "lastFeedbackStateFetchAttemptAtMillis"
private const val draftMessageKey: String = "draftMessage"

interface FeedbackPromptStore {
    fun loadState(identityKey: FeedbackPromptIdentityKey): FeedbackPromptLocalState
    fun recordFeedbackStateFetchAttempt(identityKey: FeedbackPromptIdentityKey, nowMillis: Long)
    fun recordFetchedFeedbackState(
        identityKey: FeedbackPromptIdentityKey,
        feedbackState: CloudFeedbackState,
        nowMillis: Long
    )
    fun recordAutomaticPromptShown(identityKey: FeedbackPromptIdentityKey, nowMillis: Long)
    fun recordFeedbackSubmitted(
        identityKey: FeedbackPromptIdentityKey,
        feedbackState: CloudFeedbackState,
        nowMillis: Long
    )
    fun saveDraftMessage(identityKey: FeedbackPromptIdentityKey, message: String)
    fun clearDraftMessage(identityKey: FeedbackPromptIdentityKey)
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
            lastFeedbackSubmittedAtMillis = loadLongOrNull(
                identityKey = identityKey,
                key = lastFeedbackSubmittedAtMillisKey
            ),
            nextAutomaticFeedbackPromptAtMillis = loadLongOrNull(
                identityKey = identityKey,
                key = nextAutomaticFeedbackPromptAtMillisKey
            ),
            lastFeedbackStateFetchedAtMillis = loadLongOrNull(
                identityKey = identityKey,
                key = lastFeedbackStateFetchedAtMillisKey
            ),
            lastFeedbackStateFetchAttemptAtMillis = loadLongOrNull(
                identityKey = identityKey,
                key = lastFeedbackStateFetchAttemptAtMillisKey
            ),
            draftMessage = preferences.getString(
                scopedKey(identityKey = identityKey, key = draftMessageKey),
                null
            ) ?: ""
        )
    }

    override fun recordFeedbackStateFetchAttempt(
        identityKey: FeedbackPromptIdentityKey,
        nowMillis: Long
    ) {
        preferences.edit(commit = true) {
            putLong(
                scopedKey(identityKey = identityKey, key = lastFeedbackStateFetchAttemptAtMillisKey),
                nowMillis
            )
        }
    }

    override fun recordFetchedFeedbackState(
        identityKey: FeedbackPromptIdentityKey,
        feedbackState: CloudFeedbackState,
        nowMillis: Long
    ) {
        val currentState = loadState(identityKey = identityKey)
        preferences.edit(commit = true) {
            putMergedLong(
                key = scopedKey(identityKey = identityKey, key = lastAutomaticFeedbackPromptShownAtMillisKey),
                currentValue = currentState.lastAutomaticFeedbackPromptShownAtMillis,
                nextValue = feedbackState.lastAutomaticPromptShownAtMillis
            )
            putMergedLong(
                key = scopedKey(identityKey = identityKey, key = lastFeedbackSubmittedAtMillisKey),
                currentValue = currentState.lastFeedbackSubmittedAtMillis,
                nextValue = feedbackState.lastFeedbackSubmittedAtMillis
            )
            putMergedLong(
                key = scopedKey(identityKey = identityKey, key = nextAutomaticFeedbackPromptAtMillisKey),
                currentValue = currentState.nextAutomaticFeedbackPromptAtMillis,
                nextValue = feedbackState.nextAutomaticPromptAtMillis
            )
            putLong(
                scopedKey(identityKey = identityKey, key = lastFeedbackStateFetchedAtMillisKey),
                nowMillis
            )
        }
    }

    override fun recordAutomaticPromptShown(identityKey: FeedbackPromptIdentityKey, nowMillis: Long) {
        preferences.edit(commit = true) {
            putLong(
                scopedKey(identityKey = identityKey, key = lastAutomaticFeedbackPromptShownAtMillisKey),
                nowMillis
            )
            putLong(
                scopedKey(identityKey = identityKey, key = nextAutomaticFeedbackPromptAtMillisKey),
                nextAutomaticFeedbackPromptAtMillis(nowMillis = nowMillis)
            )
        }
    }

    override fun recordFeedbackSubmitted(
        identityKey: FeedbackPromptIdentityKey,
        feedbackState: CloudFeedbackState,
        nowMillis: Long
    ) {
        val submittedAtMillis = feedbackState.lastFeedbackSubmittedAtMillis ?: nowMillis
        val nextPromptAtMillis = feedbackState.nextAutomaticPromptAtMillis
            ?: nextAutomaticFeedbackPromptAtMillis(nowMillis = submittedAtMillis)
        val currentState = loadState(identityKey = identityKey)
        preferences.edit(commit = true) {
            putMergedLong(
                key = scopedKey(identityKey = identityKey, key = lastAutomaticFeedbackPromptShownAtMillisKey),
                currentValue = currentState.lastAutomaticFeedbackPromptShownAtMillis,
                nextValue = feedbackState.lastAutomaticPromptShownAtMillis
            )
            putMergedLong(
                key = scopedKey(identityKey = identityKey, key = lastFeedbackSubmittedAtMillisKey),
                currentValue = currentState.lastFeedbackSubmittedAtMillis,
                nextValue = submittedAtMillis
            )
            putMergedLong(
                key = scopedKey(identityKey = identityKey, key = nextAutomaticFeedbackPromptAtMillisKey),
                currentValue = currentState.nextAutomaticFeedbackPromptAtMillis,
                nextValue = nextPromptAtMillis
            )
            putLong(
                scopedKey(identityKey = identityKey, key = lastFeedbackStateFetchedAtMillisKey),
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

private fun SharedPreferences.Editor.putMergedLong(
    key: String,
    currentValue: Long?,
    nextValue: Long?
) {
    val mergedValue = when {
        currentValue == null -> nextValue
        nextValue == null -> currentValue
        else -> maxOf(currentValue, nextValue)
    }
    if (mergedValue == null) {
        remove(key)
    } else {
        putLong(key, mergedValue)
    }
}
