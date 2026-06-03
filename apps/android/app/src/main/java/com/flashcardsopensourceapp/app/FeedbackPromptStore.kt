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
    fun loadState(): FeedbackPromptLocalState
    fun recordFeedbackStateFetchAttempt(nowMillis: Long)
    fun recordFetchedFeedbackState(feedbackState: CloudFeedbackState, nowMillis: Long)
    fun recordAutomaticPromptShown(nowMillis: Long)
    fun recordFeedbackSubmitted(feedbackState: CloudFeedbackState, nowMillis: Long)
    fun saveDraftMessage(message: String)
    fun clearDraftMessage()
}

class SharedPreferencesFeedbackPromptStore(
    context: Context
) : FeedbackPromptStore {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        feedbackPromptPreferencesName,
        Context.MODE_PRIVATE
    )

    override fun loadState(): FeedbackPromptLocalState {
        return FeedbackPromptLocalState(
            lastAutomaticFeedbackPromptShownAtMillis = loadLongOrNull(
                key = lastAutomaticFeedbackPromptShownAtMillisKey
            ),
            lastFeedbackSubmittedAtMillis = loadLongOrNull(key = lastFeedbackSubmittedAtMillisKey),
            nextAutomaticFeedbackPromptAtMillis = loadLongOrNull(
                key = nextAutomaticFeedbackPromptAtMillisKey
            ),
            lastFeedbackStateFetchedAtMillis = loadLongOrNull(key = lastFeedbackStateFetchedAtMillisKey),
            lastFeedbackStateFetchAttemptAtMillis = loadLongOrNull(
                key = lastFeedbackStateFetchAttemptAtMillisKey
            ),
            draftMessage = preferences.getString(draftMessageKey, null) ?: ""
        )
    }

    override fun recordFeedbackStateFetchAttempt(nowMillis: Long) {
        preferences.edit(commit = true) {
            putLong(lastFeedbackStateFetchAttemptAtMillisKey, nowMillis)
        }
    }

    override fun recordFetchedFeedbackState(feedbackState: CloudFeedbackState, nowMillis: Long) {
        val currentState = loadState()
        preferences.edit(commit = true) {
            putMergedLong(
                key = lastAutomaticFeedbackPromptShownAtMillisKey,
                currentValue = currentState.lastAutomaticFeedbackPromptShownAtMillis,
                nextValue = feedbackState.lastAutomaticPromptShownAtMillis
            )
            putMergedLong(
                key = lastFeedbackSubmittedAtMillisKey,
                currentValue = currentState.lastFeedbackSubmittedAtMillis,
                nextValue = feedbackState.lastFeedbackSubmittedAtMillis
            )
            putMergedLong(
                key = nextAutomaticFeedbackPromptAtMillisKey,
                currentValue = currentState.nextAutomaticFeedbackPromptAtMillis,
                nextValue = feedbackState.nextAutomaticPromptAtMillis
            )
            putLong(lastFeedbackStateFetchedAtMillisKey, nowMillis)
        }
    }

    override fun recordAutomaticPromptShown(nowMillis: Long) {
        preferences.edit(commit = true) {
            putLong(lastAutomaticFeedbackPromptShownAtMillisKey, nowMillis)
            putLong(nextAutomaticFeedbackPromptAtMillisKey, nextAutomaticFeedbackPromptAtMillis(nowMillis = nowMillis))
        }
    }

    override fun recordFeedbackSubmitted(feedbackState: CloudFeedbackState, nowMillis: Long) {
        val submittedAtMillis = feedbackState.lastFeedbackSubmittedAtMillis ?: nowMillis
        val nextPromptAtMillis = feedbackState.nextAutomaticPromptAtMillis
            ?: nextAutomaticFeedbackPromptAtMillis(nowMillis = submittedAtMillis)
        val currentState = loadState()
        preferences.edit(commit = true) {
            putMergedLong(
                key = lastAutomaticFeedbackPromptShownAtMillisKey,
                currentValue = currentState.lastAutomaticFeedbackPromptShownAtMillis,
                nextValue = feedbackState.lastAutomaticPromptShownAtMillis
            )
            putMergedLong(
                key = lastFeedbackSubmittedAtMillisKey,
                currentValue = currentState.lastFeedbackSubmittedAtMillis,
                nextValue = submittedAtMillis
            )
            putMergedLong(
                key = nextAutomaticFeedbackPromptAtMillisKey,
                currentValue = currentState.nextAutomaticFeedbackPromptAtMillis,
                nextValue = nextPromptAtMillis
            )
            putLong(lastFeedbackStateFetchedAtMillisKey, nowMillis)
        }
    }

    override fun saveDraftMessage(message: String) {
        preferences.edit {
            putString(draftMessageKey, message)
        }
    }

    override fun clearDraftMessage() {
        preferences.edit(commit = true) {
            remove(draftMessageKey)
        }
    }

    private fun loadLongOrNull(key: String): Long? {
        if (preferences.contains(key).not()) {
            return null
        }

        return preferences.getLong(key, 0L)
    }
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
