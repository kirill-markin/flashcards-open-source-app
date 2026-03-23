package com.flashcardsopensourceapp.data.local.review

import android.content.Context
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import org.json.JSONObject

private const val reviewPreferencesName: String = "flashcards-review-preferences"
private const val selectedReviewFilterKeyPrefix: String = "selected-review-filter::"
private const val persistedReviewFilterKindKey: String = "kind"
private const val persistedReviewFilterDeckIdKey: String = "deckId"
private const val persistedReviewFilterTagKey: String = "tag"
private const val persistedReviewFilterAllCardsKind: String = "allCards"
private const val persistedReviewFilterDeckKind: String = "deck"
private const val persistedReviewFilterTagKind: String = "tag"

interface ReviewPreferencesStore {
    fun loadSelectedReviewFilter(workspaceId: String): ReviewFilter
    fun saveSelectedReviewFilter(workspaceId: String, reviewFilter: ReviewFilter)
    fun clearSelectedReviewFilter(workspaceId: String)
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

        is ReviewFilter.Tag -> {
            payload.put(persistedReviewFilterKindKey, persistedReviewFilterTagKind)
            payload.put(persistedReviewFilterTagKey, reviewFilter.tag)
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

        persistedReviewFilterTagKind -> {
            val tag = payload.optString(persistedReviewFilterTagKey).trim()
            require(tag.isNotEmpty()) {
                "Persisted review filter is missing tag."
            }
            ReviewFilter.Tag(tag = tag)
        }

        else -> {
            throw IllegalArgumentException("Persisted review filter has an unsupported kind.")
        }
    }
}
