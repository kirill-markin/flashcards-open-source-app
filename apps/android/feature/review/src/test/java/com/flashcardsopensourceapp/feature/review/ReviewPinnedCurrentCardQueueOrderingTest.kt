package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.buildBoundedReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import org.junit.Assert.assertEquals
import org.junit.Test

private const val pinnedReviewWorkspaceId: String = "workspace-review-pinned-current"

class ReviewPinnedCurrentCardQueueOrderingTest {
    @Test
    fun pinnedCurrentCardStaysOptionBearingWhenCanonicalQueueMovesItBehindRecentDueCards() {
        val pinnedCard = makePinnedReviewCardSummary(
            cardId = "pinned-old-card",
            dueAtMillis = pinnedReviewNowMillis - pinnedReviewOneHourMillis - 1L,
            createdAtMillis = 400L,
            updatedAtMillis = 400L
        )
        val canonicalCards = listOf(
            makePinnedReviewCardSummary(
                cardId = "recent-due-1115-card",
                dueAtMillis = pinnedReviewNowMillis - (45L * 60L * 1_000L),
                createdAtMillis = 100L,
                updatedAtMillis = 100L
            ),
            makePinnedReviewCardSummary(
                cardId = "recent-due-1155-card",
                dueAtMillis = pinnedReviewNowMillis - (5L * 60L * 1_000L),
                createdAtMillis = 200L,
                updatedAtMillis = 200L
            ),
            makePinnedReviewCardSummary(
                cardId = "null-due-card",
                dueAtMillis = null,
                createdAtMillis = 300L,
                updatedAtMillis = 300L
            )
        )
        val sessionSnapshot = makePinnedReviewSessionSnapshot(
            canonicalCards = canonicalCards,
            presentedCard = pinnedCard,
            dueCount = 4,
            remainingCount = 4,
            totalCount = 4
        )

        assertEquals(
            listOf("recent-due-1115-card", "recent-due-1155-card", "null-due-card"),
            sessionSnapshot.cards.map { card -> card.cardId }
        )
        assertEquals("pinned-old-card", sessionSnapshot.presentedCard?.cardId)
        assertEquals(
            setOf("recent-due-1115-card", "recent-due-1155-card", "pinned-old-card"),
            sessionSnapshot.answerOptionsByCardId.keys
        )

        val displayedCurrentCard = requireNotNull(
            resolveDisplayedCurrentCard(
                sessionCards = sessionSnapshot.cards,
                presentedCard = sessionSnapshot.presentedCard
            )
        )
        val displayedQueue = buildDisplayedReviewQueue(
            sessionCards = sessionSnapshot.cards,
            displayedCurrentCard = displayedCurrentCard
        )
        assertEquals(
            listOf("pinned-old-card", "recent-due-1115-card", "recent-due-1155-card", "null-due-card"),
            displayedQueue.map { card -> card.cardId }
        )

        val pinnedAnswerOptions = requireNotNull(
            resolveDisplayedSessionAnswerOptions(
                displayedCard = displayedCurrentCard,
                answerOptionsByCardId = sessionSnapshot.answerOptionsByCardId
            )
        )
        assertEquals(
            listOf(ReviewRating.AGAIN, ReviewRating.HARD, ReviewRating.GOOD, ReviewRating.EASY),
            pinnedAnswerOptions.map { option -> option.rating }
        )

        val preparedNextAnswerOptions = requireNotNull(
            resolveDisplayedSessionAnswerOptions(
                displayedCard = displayedQueue[1],
                answerOptionsByCardId = sessionSnapshot.answerOptionsByCardId
            )
        )
        assertEquals(sessionSnapshot.answerOptions, preparedNextAnswerOptions)

        val afterAnswerSnapshot = makePinnedReviewSessionSnapshot(
            canonicalCards = canonicalCards,
            presentedCard = canonicalCards.first(),
            dueCount = 4,
            remainingCount = 3,
            totalCount = 4
        )
        val displayedCardAfterAnswer = requireNotNull(
            resolveDisplayedCurrentCard(
                sessionCards = afterAnswerSnapshot.cards,
                presentedCard = afterAnswerSnapshot.presentedCard
            )
        )
        val answerOptionsAfterAnswer = requireNotNull(
            resolveDisplayedSessionAnswerOptions(
                displayedCard = displayedCardAfterAnswer,
                answerOptionsByCardId = afterAnswerSnapshot.answerOptionsByCardId
            )
        )

        assertEquals("recent-due-1115-card", displayedCardAfterAnswer.cardId)
        assertEquals(
            setOf("recent-due-1115-card", "recent-due-1155-card"),
            afterAnswerSnapshot.answerOptionsByCardId.keys
        )
        assertEquals(afterAnswerSnapshot.answerOptions, answerOptionsAfterAnswer)
    }
}

private const val pinnedReviewOneDayMillis: Long = 24L * 60L * 60L * 1_000L

private fun makePinnedReviewSessionSnapshot(
    canonicalCards: List<CardSummary>,
    presentedCard: CardSummary?,
    dueCount: Int,
    remainingCount: Int,
    totalCount: Int
): ReviewSessionSnapshot {
    return buildBoundedReviewSessionSnapshot(
        selectedFilter = ReviewFilter.AllCards,
        decks = emptyList(),
        canonicalCards = canonicalCards,
        presentedCard = presentedCard,
        dueCount = dueCount,
        remainingCount = remainingCount,
        totalCount = totalCount,
        hasMoreCards = false,
        availableDeckFilters = emptyList(),
        availableEffortFilters = emptyList(),
        availableTagFilters = emptyList(),
        settings = makeDefaultWorkspaceSchedulerSettings(
            workspaceId = pinnedReviewWorkspaceId,
            updatedAtMillis = pinnedReviewNowMillis
        ),
        reviewedAtMillis = pinnedReviewNowMillis
    )
}

private fun makePinnedReviewCardSummary(
    cardId: String,
    dueAtMillis: Long?,
    createdAtMillis: Long,
    updatedAtMillis: Long
): CardSummary {
    return CardSummary(
        cardId = cardId,
        workspaceId = pinnedReviewWorkspaceId,
        frontText = "Front $cardId",
        backText = "Back $cardId",
        tags = emptyList(),
        effortLevel = EffortLevel.FAST,
        dueAtMillis = dueAtMillis,
        createdAtMillis = createdAtMillis,
        updatedAtMillis = updatedAtMillis,
        reps = 2,
        lapses = 0,
        fsrsCardState = FsrsCardState.REVIEW,
        fsrsStepIndex = null,
        fsrsStability = 2.5,
        fsrsDifficulty = 5.0,
        fsrsLastReviewedAtMillis = pinnedReviewNowMillis - pinnedReviewOneDayMillis,
        fsrsScheduledDays = 1,
        deletedAtMillis = null
    )
}
