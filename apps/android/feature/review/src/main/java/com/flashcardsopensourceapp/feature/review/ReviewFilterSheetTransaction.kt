package com.flashcardsopensourceapp.feature.review

import android.os.Bundle
import androidx.compose.runtime.saveable.Saver
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter

private const val reviewFilterSheetVisibleKey = "visible"
private const val reviewFilterSheetWorkspaceIdKey = "workspace_id"
private const val reviewFilterSheetOpeningSelectionKey = "opening_selection"
private const val reviewFilterSheetDraftSelectionKey = "draft_selection"
private const val reviewFilterAllCardsType = "all_cards"
private const val reviewFilterDeckType = "deck"
private const val reviewFilterTagsType = "tags"

internal data class ReviewFilterSheetTransaction(
    val isVisible: Boolean,
    val workspaceId: String?,
    val openingSelection: ReviewFilter,
    val draftSelection: ReviewFilter
)

internal val reviewFilterSheetTransactionSaver: Saver<ReviewFilterSheetTransaction, Bundle> = Saver(
    save = { transaction ->
        Bundle().apply {
            putBoolean(reviewFilterSheetVisibleKey, transaction.isVisible)
            putString(reviewFilterSheetWorkspaceIdKey, transaction.workspaceId)
            putStringArrayList(
                reviewFilterSheetOpeningSelectionKey,
                ArrayList(serializeReviewFilter(reviewFilter = transaction.openingSelection))
            )
            putStringArrayList(
                reviewFilterSheetDraftSelectionKey,
                ArrayList(serializeReviewFilter(reviewFilter = transaction.draftSelection))
            )
        }
    },
    restore = { savedState ->
        require(savedState.containsKey(reviewFilterSheetVisibleKey)) {
            "Saved review filter sheet transaction is missing its visibility state."
        }
        require(savedState.containsKey(reviewFilterSheetWorkspaceIdKey)) {
            "Saved review filter sheet transaction is missing its workspace context."
        }

        ReviewFilterSheetTransaction(
            isVisible = savedState.getBoolean(reviewFilterSheetVisibleKey),
            workspaceId = savedState.getString(reviewFilterSheetWorkspaceIdKey),
            openingSelection = deserializeReviewFilter(
                savedFilter = requireSavedReviewFilter(
                    savedState = savedState,
                    key = reviewFilterSheetOpeningSelectionKey
                )
            ),
            draftSelection = deserializeReviewFilter(
                savedFilter = requireSavedReviewFilter(
                    savedState = savedState,
                    key = reviewFilterSheetDraftSelectionKey
                )
            )
        )
    }
)

internal fun closedReviewFilterSheetTransaction(
    workspaceId: String?,
    selection: ReviewFilter
): ReviewFilterSheetTransaction {
    return ReviewFilterSheetTransaction(
        isVisible = false,
        workspaceId = workspaceId,
        openingSelection = selection,
        draftSelection = selection
    )
}

internal fun openReviewFilterSheetTransaction(
    workspaceId: String,
    selection: ReviewFilter
): ReviewFilterSheetTransaction {
    return ReviewFilterSheetTransaction(
        isVisible = true,
        workspaceId = workspaceId,
        openingSelection = selection,
        draftSelection = selection
    )
}

private fun serializeReviewFilter(reviewFilter: ReviewFilter): List<String> {
    return when (reviewFilter) {
        ReviewFilter.AllCards -> listOf(reviewFilterAllCardsType)
        is ReviewFilter.Deck -> listOf(reviewFilterDeckType, reviewFilter.deckId)
        is ReviewFilter.Tags -> listOf(reviewFilterTagsType) + reviewFilter.tags
    }
}

private fun deserializeReviewFilter(savedFilter: List<String>): ReviewFilter {
    val filterType: String = savedFilter.firstOrNull()
        ?: throw IllegalStateException("Saved review filter is empty.")
    return when (filterType) {
        reviewFilterAllCardsType -> {
            require(savedFilter.size == 1) {
                "Saved All cards review filter must not contain values."
            }
            ReviewFilter.AllCards
        }
        reviewFilterDeckType -> {
            require(savedFilter.size == 2 && savedFilter[1].isNotEmpty()) {
                "Saved deck review filter must contain exactly one non-empty deck ID."
            }
            ReviewFilter.Deck(deckId = savedFilter[1])
        }
        reviewFilterTagsType -> ReviewFilter.Tags(tags = savedFilter.drop(1))
        else -> throw IllegalStateException("Saved review filter has unsupported type '$filterType'.")
    }
}

private fun requireSavedReviewFilter(savedState: Bundle, key: String): List<String> {
    return savedState.getStringArrayList(key)
        ?: throw IllegalStateException("Saved review filter sheet transaction is missing '$key'.")
}
