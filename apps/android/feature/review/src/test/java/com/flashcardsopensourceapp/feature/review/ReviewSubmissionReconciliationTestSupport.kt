package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel
import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewCardQueueStatus
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter

internal const val pinnedReviewNowMillis: Long = 3_600_000L
internal const val pinnedReviewOneHourMillis: Long = 60L * 60L * 1_000L

internal fun makePreparedReviewCardPresentation(card: ReviewCard): PreparedReviewCardPresentation {
    return PreparedReviewCardPresentation(
        card = card,
        effortLabel = "Fast",
        tagsLabel = card.tags.joinToString(),
        dueLabel = "Due",
        repsLabel = "2 reps",
        lapsesLabel = "0 lapses",
        frontContent = ReviewRenderedContent.ShortPlain(text = card.frontText),
        backContent = ReviewRenderedContent.ShortPlain(text = card.backText),
        frontSpeakableText = card.frontText,
        backSpeakableText = card.backText,
        answerOptions = emptyList()
    )
}

internal fun makeReviewSubmissionSessionContext(reviewFilter: ReviewFilter): ReviewSubmissionSessionContext {
    return makeReviewSubmissionSessionContextWithGenerations(
        reviewFilter = reviewFilter,
        sessionGeneration = 0L,
        filterGeneration = 0L
    )
}

internal fun makeReviewSubmissionSessionContextWithGeneration(
    reviewFilter: ReviewFilter,
    sessionGeneration: Long
): ReviewSubmissionSessionContext {
    return makeReviewSubmissionSessionContextWithGenerations(
        reviewFilter = reviewFilter,
        sessionGeneration = sessionGeneration,
        filterGeneration = 0L
    )
}

internal fun makeReviewSubmissionSessionContextWithGenerations(
    reviewFilter: ReviewFilter,
    sessionGeneration: Long,
    filterGeneration: Long
): ReviewSubmissionSessionContext {
    return ReviewSubmissionSessionContext(
        requestedFilter = reviewFilter,
        observedRequestedFilter = reviewFilter,
        selectedFilter = reviewFilter,
        sessionGeneration = sessionGeneration,
        filterGeneration = filterGeneration
    )
}

internal fun makePinnedReviewDraftState(
    requestedFilter: ReviewFilter,
    presentedCard: ReviewCard?,
    reviewedInSessionCount: Int,
    pendingReviewedCards: Set<PendingReviewedCard>,
    optimisticPreparedCurrentCard: PreparedReviewCardPresentation?,
    errorMessage: String
): ReviewDraftState {
    return ReviewDraftState(
        requestedFilter = requestedFilter,
        presentedCard = presentedCard,
        revealedCardId = null,
        reviewedInSessionCount = reviewedInSessionCount,
        pendingReviewedCards = pendingReviewedCards,
        optimisticPreparedCurrentCard = optimisticPreparedCurrentCard,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = errorMessage,
        isNotificationPermissionPromptVisible = false,
        isHardAnswerReminderVisible = false
    )
}

internal fun makePinnedReviewCard(
    cardId: String,
    tags: List<String>,
    updatedAtMillis: Long
): ReviewCard {
    return ReviewCard(
        cardId = cardId,
        frontText = "Front $cardId",
        backText = "Back $cardId",
        tags = tags,
        effortLevel = EffortLevel.FAST,
        dueAtMillis = pinnedReviewNowMillis - pinnedReviewOneHourMillis,
        updatedAtMillis = updatedAtMillis,
        createdAtMillis = updatedAtMillis,
        reps = 2,
        lapses = 0,
        queueStatus = ReviewCardQueueStatus.ACTIVE
    )
}
