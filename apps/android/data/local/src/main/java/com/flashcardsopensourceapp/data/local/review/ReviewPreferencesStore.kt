package com.flashcardsopensourceapp.data.local.review

import android.content.Context
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.makeReviewTagFilter
import org.json.JSONArray
import org.json.JSONObject

private const val reviewPreferencesName: String = "flashcards-review-preferences"
private const val selectedReviewFilterKeyPrefix: String = "selected-review-filter::"
private const val hardAnswerReminderLastShownAtKey: String = "hard-answer-reminder-last-shown-at"
private const val persistedReviewFilterKindKey: String = "kind"
private const val persistedReviewFilterDeckIdKey: String = "deckId"
private const val persistedReviewFilterEffortLevelKey: String = "effortLevel"
private const val persistedReviewFilterTagKey: String = "tag"
private const val persistedReviewFilterTagsKey: String = "tags"
private const val persistedReviewFilterAllCardsKind: String = "allCards"
private const val persistedReviewFilterDeckKind: String = "deck"
private const val persistedReviewFilterEffortKind: String = "effort"
private const val persistedReviewFilterTagKind: String = "tag"
private const val persistedReviewFilterTagsKind: String = "tags"

interface ReviewPreferencesStore {
    /** Loads the selected review filter for a workspace. */
    fun loadSelectedReviewFilter(workspaceId: String): ReviewFilter

    /** Persists the selected review filter for a workspace. */
    fun saveSelectedReviewFilter(workspaceId: String, reviewFilter: ReviewFilter)

    /** Clears the selected review filter for a workspace. */
    fun clearSelectedReviewFilter(workspaceId: String)

    /** Loads the timestamp of the last hard-answer reminder shown on this device. */
    fun loadHardAnswerReminderLastShownAt(): Long?

    /** Persists the timestamp of the last hard-answer reminder shown on this device. */
    fun saveHardAnswerReminderLastShownAt(timestampMillis: Long)
}

class SharedPreferencesReviewPreferencesStore(
    context: Context
) : ReviewPreferencesStore {
    private val preferences =
        context.getSharedPreferences(reviewPreferencesName, Context.MODE_PRIVATE)

    override fun loadSelectedReviewFilter(workspaceId: String): ReviewFilter {
        val rawValue = preferences.getString(makeSelectedReviewFilterKey(workspaceId = workspaceId), null)
            ?: return ReviewFilter.AllCards

        return try {
            decodePersistedReviewFilter(rawValue = rawValue)
        } catch (_: Exception) {
            clearSelectedReviewFilter(workspaceId = workspaceId)
            ReviewFilter.AllCards
        }
    }

    override fun saveSelectedReviewFilter(workspaceId: String, reviewFilter: ReviewFilter) {
        preferences.edit(commit = true) {
            putString(
                makeSelectedReviewFilterKey(workspaceId = workspaceId),
                encodePersistedReviewFilter(reviewFilter = reviewFilter)
            )
        }
    }

    override fun clearSelectedReviewFilter(workspaceId: String) {
        preferences.edit(commit = true) {
            remove(makeSelectedReviewFilterKey(workspaceId = workspaceId))
        }
    }

    override fun loadHardAnswerReminderLastShownAt(): Long? {
        if (preferences.contains(hardAnswerReminderLastShownAtKey).not()) {
            return null
        }

        return preferences.getLong(hardAnswerReminderLastShownAtKey, 0L)
    }

    override fun saveHardAnswerReminderLastShownAt(timestampMillis: Long) {
        preferences.edit(commit = true) {
            putLong(hardAnswerReminderLastShownAtKey, timestampMillis)
        }
    }
}

private fun makeSelectedReviewFilterKey(workspaceId: String): String {
    return "$selectedReviewFilterKeyPrefix$workspaceId"
}

private fun encodePersistedReviewFilter(reviewFilter: ReviewFilter): String {
    val payload = JSONObject()

    when (reviewFilter) {
        ReviewFilter.AllCards -> {
            payload.put(persistedReviewFilterKindKey, persistedReviewFilterAllCardsKind)
        }

        is ReviewFilter.Deck -> {
            payload.put(persistedReviewFilterKindKey, persistedReviewFilterDeckKind)
            payload.put(persistedReviewFilterDeckIdKey, reviewFilter.deckId)
        }

        is ReviewFilter.Tags -> {
            payload.put(persistedReviewFilterKindKey, persistedReviewFilterTagsKind)
            payload.put(persistedReviewFilterTagsKey, JSONArray(reviewFilter.tags))
        }
    }

    return payload.toString()
}

private fun decodePersistedReviewFilter(rawValue: String): ReviewFilter {
    val payload = JSONObject(rawValue)
    return when (payload.getString(persistedReviewFilterKindKey)) {
        persistedReviewFilterAllCardsKind -> ReviewFilter.AllCards
        persistedReviewFilterDeckKind -> {
            val deckId = payload.optString(persistedReviewFilterDeckIdKey).trim()
            require(deckId.isNotEmpty()) {
                "Persisted review filter is missing deckId."
            }
            ReviewFilter.Deck(deckId = deckId)
        }

        persistedReviewFilterEffortKind -> {
            val effortLevelValue = payload.optString(persistedReviewFilterEffortLevelKey).trim()
            require(effortLevelValue.isNotEmpty()) {
                "Persisted review filter is missing effortLevel."
            }
            decodeLegacyEffortReviewFilter(rawValue = effortLevelValue)
        }

        persistedReviewFilterTagKind -> {
            val tag = payload.optString(persistedReviewFilterTagKey).trim()
            require(tag.isNotEmpty()) {
                "Persisted review filter is missing tag."
            }
            makeReviewTagFilter(tagNames = listOf(tag))
        }

        persistedReviewFilterTagsKind -> {
            val tagsPayload = payload.getJSONArray(persistedReviewFilterTagsKey)
            makeReviewTagFilter(
                tagNames = (0 until tagsPayload.length()).map { index ->
                    tagsPayload.getString(index)
                }
            )
        }

        else -> {
            throw IllegalArgumentException("Persisted review filter has an unsupported kind.")
        }
    }
}

private fun decodeLegacyEffortReviewFilter(rawValue: String): ReviewFilter {
    return when (rawValue.trim().lowercase()) {
        "fast" -> ReviewFilter.AllCards
        "medium" -> makeReviewTagFilter(tagNames = listOf("medium"))
        "long" -> makeReviewTagFilter(tagNames = listOf("long"))
        else -> throw IllegalArgumentException("Persisted review filter has an unsupported effortLevel.")
    }
}
