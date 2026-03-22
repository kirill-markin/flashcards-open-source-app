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
        assertTrue(page.hasMoreCards.not())
    }

    private fun sampleCards(): List<CardSummary> {
        return listOf(
            CardSummary(
                cardId = "card-1",
                workspaceId = "workspace-demo",
                frontText = "What does val mean in Kotlin?",
                backText = "A read-only reference.",
                tags = listOf("basics"),
                effortLevel = EffortLevel.FAST,
                dueAtMillis = null,
                createdAtMillis = 100L,
                updatedAtMillis = 100L,
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
                cardId = "card-2",
                workspaceId = "workspace-demo",
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
                workspaceId = "workspace-demo",
                frontText = "What does Room wrap on Android?",
                backText = "SQLite with typed DAO and entity APIs.",
                tags = listOf("sqlite"),
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
                workspaceId = "workspace-demo",
                frontText = "What is Compose used for?",
                backText = "Building Android UI declaratively.",
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
                workspaceId = "workspace-demo",
                name = "Kotlin Basics",
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
                workspaceId = "workspace-demo",
                name = "Android UI",
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
            workspaceId = "workspace-demo",
            updatedAtMillis = 100L
        )
    }
}
