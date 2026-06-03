package com.flashcardsopensourceapp.data.local.model.review

import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState

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

    data class Effort(
        val effortLevel: EffortLevel
    ) : ReviewFilter

    data class Tag(
        val tag: String
    ) : ReviewFilter
}

data class ReviewCard(
    val cardId: String,
    val frontText: String,
    val backText: String,
    val tags: List<String>,
    val effortLevel: EffortLevel,
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
    val totalCount: Int
)

data class ReviewEffortFilterOption(
    val effortLevel: EffortLevel,
    val title: String,
    val totalCount: Int
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
    val answerOptions: List<ReviewAnswerOption>,
    val nextAnswerOptions: List<ReviewAnswerOption>,
    val answerOptionsByCardId: Map<String, List<ReviewAnswerOption>>,
    val dueCount: Int,
    val remainingCount: Int,
    val totalCount: Int,
    val hasMoreCards: Boolean,
    val availableDeckFilters: List<ReviewDeckFilterOption>,
    val availableEffortFilters: List<ReviewEffortFilterOption>,
    val availableTagFilters: List<ReviewTagFilterOption>,
    val isLoading: Boolean
)

data class ReviewTimelinePage(
    val cards: List<ReviewCard>,
    val hasMoreCards: Boolean
)
