package com.flashcardsopensourceapp.data.local.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewSupportTest {
    @Test
    fun buildReviewSessionSnapshotFallsBackToAllCardsWhenDeckIsMissing() {
        val snapshot = buildReviewSessionSnapshot(
            selectedFilter = ReviewFilter.Deck(deckId = "missing-deck"),
            pendingReviewedCardIds = emptySet(),
            decks = sampleDecks(),
            cards = sampleCards(),
            tagsSummary = sampleTagsSummary(),
            settings = sampleSchedulerSettings(),
            reviewedAtMillis = 1_000L
        )

        assertEquals(ReviewFilter.AllCards, snapshot.selectedFilter)
        assertEquals("All cards", snapshot.selectedFilterTitle)
        assertEquals(4, snapshot.totalCount)
        assertEquals(4, snapshot.remainingCount)
    }

    @Test
    fun buildReviewSessionSnapshotReturnsOnlyDeckCardsAndSubtractsPendingFromRemaining() {
        val snapshot = buildReviewSessionSnapshot(
            selectedFilter = ReviewFilter.Deck(deckId = "deck-kotlin"),
            pendingReviewedCardIds = setOf("card-1"),
            decks = sampleDecks(),
            cards = sampleCards(),
            tagsSummary = sampleTagsSummary(),
            settings = sampleSchedulerSettings(),
            reviewedAtMillis = 1_000L
        )

        assertEquals(ReviewFilter.Deck(deckId = "deck-kotlin"), snapshot.selectedFilter)
        assertEquals(2, snapshot.totalCount)
        assertEquals(1, snapshot.remainingCount)
        assertEquals(listOf("card-2"), snapshot.cards.map { card -> card.cardId })
    }

    @Test
    fun buildReviewSessionSnapshotPreservesCardSchedulingMetadata() {
        val snapshot = buildReviewSessionSnapshot(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCardIds = emptySet(),
            decks = sampleDecks(),
            cards = sampleCards(),
            tagsSummary = sampleTagsSummary(),
            settings = sampleSchedulerSettings(),
            reviewedAtMillis = 1_000L
        )

        assertEquals(0L, snapshot.cards.first().dueAtMillis)
        assertEquals(2, snapshot.cards.first().reps)
        assertEquals(1, snapshot.cards.first().lapses)
    }

    @Test
    fun buildReviewSessionSnapshotFallsBackToAllCardsWhenTagIsMissing() {
        val snapshot = buildReviewSessionSnapshot(
            selectedFilter = ReviewFilter.Tag(tag = "missing"),
            pendingReviewedCardIds = emptySet(),
            decks = sampleDecks(),
            cards = sampleCards(),
            tagsSummary = sampleTagsSummary(),
            settings = sampleSchedulerSettings(),
            reviewedAtMillis = 1_000L
        )

        assertEquals(ReviewFilter.AllCards, snapshot.selectedFilter)
        assertEquals(4, snapshot.totalCount)
    }

    @Test
    fun buildReviewTimelinePagePlacesRemainingCardsBeforeAlreadyRatedTail() {
        val page = buildReviewTimelinePage(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCardIds = setOf("card-1", "card-3"),
            decks = sampleDecks(),
            cards = sampleCards(),
            tagsSummary = sampleTagsSummary(),
            reviewedAtMillis = 1_000L,
            offset = 0,
            limit = 10
        )

        assertEquals(
            listOf("card-2", "card-4", "card-1", "card-3"),
            page.cards.map { card -> card.cardId }
        )
        assertEquals(
            listOf(
                ReviewCardQueueStatus.ACTIVE,
                ReviewCardQueueStatus.ACTIVE,
                ReviewCardQueueStatus.RATED,
                ReviewCardQueueStatus.RATED
            ),
            page.cards.map { card -> card.queueStatus }
        )
        assertTrue(page.hasMoreCards.not())
    }

    @Test
    fun buildReviewTimelinePagePlacesFutureCardsBeforeAlreadyRatedTail() {
        val cards = sampleCards() + CardSummary(
            cardId = "card-5",
            workspaceId = "workspace-local",
            frontText = "Future card",
            backText = "Shows later in preview.",
            tags = listOf("future"),
            effortLevel = EffortLevel.FAST,
            dueAtMillis = 5_000L,
            createdAtMillis = 104L,
            updatedAtMillis = 104L,
            reps = 1,
            lapses = 0,
            fsrsCardState = FsrsCardState.REVIEW,
            fsrsStepIndex = null,
            fsrsStability = 2.0,
            fsrsDifficulty = 5.0,
            fsrsLastReviewedAtMillis = 500L,
            fsrsScheduledDays = 2,
            deletedAtMillis = null
        )
        val page = buildReviewTimelinePage(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCardIds = setOf("card-1"),
            decks = sampleDecks(),
            cards = cards,
            tagsSummary = sampleTagsSummary(),
            reviewedAtMillis = 1_000L,
            offset = 0,
            limit = 10
        )

        assertEquals(
            listOf("card-2", "card-3", "card-4", "card-5", "card-1"),
            page.cards.map { card -> card.cardId }
        )
        assertEquals(
            listOf(
                ReviewCardQueueStatus.ACTIVE,
                ReviewCardQueueStatus.ACTIVE,
                ReviewCardQueueStatus.ACTIVE,
                ReviewCardQueueStatus.FUTURE,
                ReviewCardQueueStatus.RATED
            ),
            page.cards.map { card -> card.queueStatus }
        )
    }

    private fun sampleCards(): List<CardSummary> {
        return listOf(
            CardSummary(
                cardId = "card-1",
                workspaceId = "workspace-local",
                frontText = "What is an immutable binding?",
                backText = "A value that cannot be reassigned after creation.",
                tags = listOf("basics"),
                effortLevel = EffortLevel.FAST,
                dueAtMillis = 0L,
                createdAtMillis = 100L,
                updatedAtMillis = 100L,
                reps = 2,
                lapses = 1,
                fsrsCardState = FsrsCardState.NEW,
                fsrsStepIndex = null,
                fsrsStability = null,
                fsrsDifficulty = null,
                fsrsLastReviewedAtMillis = null,
                fsrsScheduledDays = null,
                deletedAtMillis = null
            ),
            CardSummary(
                cardId = "card-2",
                workspaceId = "workspace-local",
                frontText = "What is a data class?",
                backText = "A class optimized for immutable value-like data.",
                tags = listOf("basics"),
                effortLevel = EffortLevel.MEDIUM,
                dueAtMillis = null,
                createdAtMillis = 101L,
                updatedAtMillis = 101L,
                reps = 0,
                lapses = 0,
                fsrsCardState = FsrsCardState.NEW,
                fsrsStepIndex = null,
                fsrsStability = null,
                fsrsDifficulty = null,
                fsrsLastReviewedAtMillis = null,
                fsrsScheduledDays = null,
                deletedAtMillis = null
            ),
            CardSummary(
                cardId = "card-3",
                workspaceId = "workspace-local",
                frontText = "What does local persistence store?",
                backText = "Structured records on device.",
                tags = listOf("storage"),
                effortLevel = EffortLevel.LONG,
                dueAtMillis = null,
                createdAtMillis = 102L,
                updatedAtMillis = 102L,
                reps = 0,
                lapses = 0,
                fsrsCardState = FsrsCardState.NEW,
                fsrsStepIndex = null,
                fsrsStability = null,
                fsrsDifficulty = null,
                fsrsLastReviewedAtMillis = null,
                fsrsScheduledDays = null,
                deletedAtMillis = null
            ),
            CardSummary(
                cardId = "card-4",
                workspaceId = "workspace-local",
                frontText = "What is declarative UI?",
                backText = "A UI model driven by state updates.",
                tags = listOf("ui"),
                effortLevel = EffortLevel.FAST,
                dueAtMillis = null,
                createdAtMillis = 103L,
                updatedAtMillis = 103L,
                reps = 0,
                lapses = 0,
                fsrsCardState = FsrsCardState.NEW,
                fsrsStepIndex = null,
                fsrsStability = null,
                fsrsDifficulty = null,
                fsrsLastReviewedAtMillis = null,
                fsrsScheduledDays = null,
                deletedAtMillis = null
            )
        )
    }

    private fun sampleDecks(): List<DeckSummary> {
        return listOf(
            DeckSummary(
                deckId = "deck-kotlin",
                workspaceId = "workspace-local",
                name = "Basics",
                filterDefinition = DeckFilterDefinition(
                    version = 2,
                    effortLevels = emptyList(),
                    tags = listOf("basics")
                ),
                totalCards = 2,
                dueCards = 2,
                newCards = 2,
                reviewedCards = 0,
                createdAtMillis = 100L,
                updatedAtMillis = 100L
            ),
            DeckSummary(
                deckId = "deck-ui",
                workspaceId = "workspace-local",
                name = "UI",
                filterDefinition = DeckFilterDefinition(
                    version = 2,
                    effortLevels = emptyList(),
                    tags = listOf("ui")
                ),
                totalCards = 1,
                dueCards = 1,
                newCards = 1,
                reviewedCards = 0,
                createdAtMillis = 101L,
                updatedAtMillis = 101L
            )
        )
    }

    private fun sampleTagsSummary(): WorkspaceTagsSummary {
        return WorkspaceTagsSummary(
            tags = listOf(
                WorkspaceTagSummary(tag = "basics", cardsCount = 2),
                WorkspaceTagSummary(tag = "sqlite", cardsCount = 1),
                WorkspaceTagSummary(tag = "ui", cardsCount = 1)
            ),
            totalCards = 4
        )
    }

    private fun sampleSchedulerSettings(): WorkspaceSchedulerSettings {
        return makeDefaultWorkspaceSchedulerSettings(
            workspaceId = "workspace-local",
            updatedAtMillis = 100L
        )
    }
}
