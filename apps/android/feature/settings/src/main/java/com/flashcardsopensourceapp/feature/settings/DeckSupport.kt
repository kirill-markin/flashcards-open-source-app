package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceOverviewSummary

internal fun filterDeckEntries(
    deckEntries: List<DeckListEntryUiState>,
    searchQuery: String
): List<DeckListEntryUiState> {
    val normalizedQuery = searchQuery.trim().lowercase()

    if (normalizedQuery.isEmpty()) {
        return deckEntries
    }

    return deckEntries.filter { deckEntry ->
        deckEntry.title.lowercase().contains(normalizedQuery)
            || deckEntry.filterSummary.lowercase().contains(normalizedQuery)
    }
}

internal fun buildDeckListEntries(
    decks: List<DeckSummary>,
    overview: WorkspaceOverviewSummary?
): List<DeckListEntryUiState> {
    val allCardsEntry = buildAllCardsDeckListEntry(overview = overview)
    val persistedDeckEntries = decks.map { deck ->
        DeckListEntryUiState(
            target = DeckListTargetUiState.PersistedDeck(deckId = deck.deckId),
            title = deck.name,
            filterSummary = formatDeckFilter(filterDefinition = deck.filterDefinition),
            totalCards = deck.totalCards,
            dueCards = deck.dueCards,
            newCards = deck.newCards,
            reviewedCards = deck.reviewedCards
        )
    }

    return listOf(allCardsEntry) + persistedDeckEntries
}

internal fun buildAllCardsDeckDetailInfo(overview: WorkspaceOverviewSummary?): DeckDetailInfoUiState.AllCards {
    return DeckDetailInfoUiState.AllCards(
        title = "All cards",
        filterSummary = "All cards",
        totalCards = overview?.totalCards ?: 0,
        dueCards = overview?.dueCount ?: 0,
        newCards = overview?.newCount ?: 0,
        reviewedCards = overview?.reviewedCount ?: 0
    )
}

internal fun toPersistedDeckDetailInfo(deck: DeckSummary): DeckDetailInfoUiState.PersistedDeck {
    return DeckDetailInfoUiState.PersistedDeck(
        deckId = deck.deckId,
        title = deck.name,
        filterSummary = formatDeckFilter(filterDefinition = deck.filterDefinition),
        totalCards = deck.totalCards,
        dueCards = deck.dueCards,
        newCards = deck.newCards,
        reviewedCards = deck.reviewedCards
    )
}

internal fun formatDeckFilter(filterDefinition: DeckFilterDefinition): String {
    val parts = buildList {
        if (filterDefinition.effortLevels.isNotEmpty()) {
            add("effort in ${filterDefinition.effortLevels.joinToString(separator = ", ") { effortLevel -> effortLevel.name.lowercase() }}")
        }
        if (filterDefinition.tags.isNotEmpty()) {
            add("tags any of ${filterDefinition.tags.joinToString(separator = ", ")}")
        }
    }

    if (parts.isEmpty()) {
        return "All cards"
    }

    return parts.joinToString(separator = " AND ")
}

private fun buildAllCardsDeckListEntry(overview: WorkspaceOverviewSummary?): DeckListEntryUiState {
    return DeckListEntryUiState(
        target = DeckListTargetUiState.AllCards,
        title = "All cards",
        filterSummary = "All cards",
        totalCards = overview?.totalCards ?: 0,
        dueCards = overview?.dueCount ?: 0,
        newCards = overview?.newCount ?: 0,
        reviewedCards = overview?.reviewedCount ?: 0
    )
}
