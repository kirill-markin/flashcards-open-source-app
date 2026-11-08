package com.flashcardsopensourceapp.data.local.model.review

import com.flashcardsopensourceapp.data.local.model.cards.normalizeTagKey
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState
import java.time.LocalDate

enum class ReviewRating {
    AGAIN,
    HARD,
    GOOD,
    EASY
}

sealed interface ReviewFilter {
    data object AllCards : ReviewFilter

    data class Deck(
        val deckId: String
    ) : ReviewFilter

    data class Tags(
        val tags: List<String>
    ) : ReviewFilter {
        init {
            require(tags == normalizeReviewTagNames(tagNames = tags)) {
                "Review tag selection must be normalized, deduplicated, and deterministically ordered."
            }
        }
    }
}

fun normalizeReviewTagNames(tagNames: List<String>): List<String> {
    return tagNames.map(String::trim)
        .filter(String::isNotEmpty)
        .groupBy { tagName ->
            normalizeTagKey(tag = tagName)
        }
        .values
        .map { equivalentTagNames ->
            equivalentTagNames.minOrNull() ?: error("Normalized review tag group cannot be empty.")
        }
        .sortedWith(
            compareBy<String> { tagName ->
                normalizeTagKey(tag = tagName)
            }.thenBy { tagName ->
                tagName
            }
        )
}

fun makeReviewTagFilter(tagNames: List<String>): ReviewFilter.Tags {
    return ReviewFilter.Tags(tags = normalizeReviewTagNames(tagNames = tagNames))
}

data class ReviewCard(
    val cardId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val dueAtMillis: Long?,
    val updatedAtMillis: Long,
    val createdAtMillis: Long,
    val reps: Int,
    val lapses: Int,
    val queueStatus: ReviewCardQueueStatus
)

data class PendingReviewedCard(
    val cardId: String,
    val updatedAtMillis: Long
)

enum class ReviewCardQueueStatus {
    ACTIVE,
    FUTURE,
    RATED
}

// Keep in sync with apps/backend/src/scheduling/index.ts::ReviewSchedule, apps/ios/Flashcards/Flashcards/Review/Scheduling/FsrsScheduler.swift::ReviewSchedule, and the Android scheduler mirror in FsrsScheduler.kt.
data class ReviewSchedule(
    val dueAtMillis: Long?,
    val reps: Int,
    val lapses: Int,
    val fsrsCardState: FsrsCardState,
    val fsrsStepIndex: Int?,
    val fsrsStability: Double?,
    val fsrsDifficulty: Double?,
    val fsrsLastReviewedAtMillis: Long?,
    val fsrsScheduledDays: Int?
)

// Keep review answer option presentation aligned with apps/ios/Flashcards/Flashcards/Review/View/ReviewAnswerSupport.swift and the Android scheduler mirror in ReviewAnswerSupport.kt.
data class ReviewAnswerOption(
    val rating: ReviewRating,
    val intervalDescription: ReviewIntervalDescription
)

data class ReviewDeckFilterOption(
    val deckId: String,
    val title: String,
    val totalCount: Int,
    val tags: List<String>
)

data class ReviewTagFilterOption(
    val tag: String,
    val totalCount: Int
)

data class ReviewSessionSnapshot(
    val selectedFilter: ReviewFilter,
    val selectedFilterTitle: String,
    val cards: List<ReviewCard>,
    val presentedCard: ReviewCard?,
    /** The card a rating shows next; see docs/fsrs-scheduling-logic.md#non-blocking-review. */
    val preparedNextCard: ReviewCard?,
    val answerOptions: List<ReviewAnswerOption>,
    val nextAnswerOptions: List<ReviewAnswerOption>,
    val answerOptionsByCardId: Map<String, List<ReviewAnswerOption>>,
    val dueCount: Int,
    val remainingCount: Int,
    val totalCount: Int,
    val hasMoreCards: Boolean,
    /** Stored workspace tag names, so a requested tag filter can be checked without loading filter options. */
    val reviewTagNames: List<String>,
    /** The earliest future due time in the filter, for the one next-due refresh timer. */
    val nextDueAtMillis: Long?,
    val isLoading: Boolean
)

/**
 * Everything the bounded review queue query reads besides the filter. A rating changes only these, so
 * it re-runs the queue window, the pinned cards, and counts, never the workspace-wide reads.
 * See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
data class ReviewSessionQueryInputs(
    val pendingReviewedCards: Set<PendingReviewedCard>,
    val presentedCardId: String?,
    val preparedNextCardId: String?,
    val nowMillis: Long
)

/** The Review tab badge count with the card Review shows first, for the Home Screen widget. */
data class ReviewQueueHead(
    val workspaceId: String,
    val dueCount: Int,
    /** The earliest future due time in the filter. */
    val nextDueAtMillis: Long?,
    val topCard: ReviewQueueHeadCard?
)

data class ReviewQueueHeadCard(
    val cardId: String,
    val frontText: String
)

/** Cards in the Review filter that fall due on [localDate]; new cards have no due time and never count. */
data class ReviewDueDay(
    val localDate: LocalDate,
    val dueCount: Int
)

/** Filter sheet choices with their due counts, loaded only while the filter sheet is open. */
data class ReviewFilterOptions(
    val deckFilters: List<ReviewDeckFilterOption>,
    val tagFilters: List<ReviewTagFilterOption>
)

data class ReviewTimelinePage(
    val cards: List<ReviewCard>,
    val hasMoreCards: Boolean
)
