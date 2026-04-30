package com.flashcardsopensourceapp.feature.settings.deck

import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceOverviewSummary
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver

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
    overview: WorkspaceOverviewSummary?,
    strings: SettingsStringResolver
): List<DeckListEntryUiState> {
    val allCardsEntry = buildAllCardsDeckListEntry(overview = overview, strings = strings)
    val persistedDeckEntries = decks.map { deck ->
        DeckListEntryUiState(
            target = DeckListTargetUiState.PersistedDeck(deckId = deck.deckId),
            title = deck.name,
            filterSummary = formatDeckFilter(filterDefinition = deck.filterDefinition, strings = strings),
            totalCards = deck.totalCards,
            dueCards = deck.dueCards,
            newCards = deck.newCards,
            reviewedCards = deck.reviewedCards
        )
    }

    return listOf(allCardsEntry) + persistedDeckEntries
}

internal fun buildAllCardsDeckDetailInfo(
    overview: WorkspaceOverviewSummary?,
    strings: SettingsStringResolver
): DeckDetailInfoUiState.AllCards {
    return DeckDetailInfoUiState.AllCards(
        title = strings.get(R.string.settings_decks_all_cards),
        filterSummary = strings.get(R.string.settings_decks_all_cards),
        totalCards = overview?.totalCards ?: 0,
        dueCards = overview?.dueCount ?: 0,
        newCards = overview?.newCount ?: 0,
        reviewedCards = overview?.reviewedCount ?: 0
    )
}

internal fun toPersistedDeckDetailInfo(
    deck: DeckSummary,
    strings: SettingsStringResolver
): DeckDetailInfoUiState.PersistedDeck {
    return DeckDetailInfoUiState.PersistedDeck(
        deckId = deck.deckId,
        title = deck.name,
        filterSummary = formatDeckFilter(filterDefinition = deck.filterDefinition, strings = strings),
        totalCards = deck.totalCards,
        dueCards = deck.dueCards,
        newCards = deck.newCards,
        reviewedCards = deck.reviewedCards
    )
}

internal fun formatDeckFilter(
    filterDefinition: DeckFilterDefinition,
    strings: SettingsStringResolver
): String {
    val parts = buildList {
        if (filterDefinition.effortLevels.isNotEmpty()) {
            add(
                strings.get(
                    R.string.settings_deck_filter_effort,
                    filterDefinition.effortLevels.joinToString(separator = ", ") { effortLevel ->
                        when (effortLevel) {
                            com.flashcardsopensourceapp.data.local.model.EffortLevel.FAST -> strings.get(R.string.settings_effort_fast)
                            com.flashcardsopensourceapp.data.local.model.EffortLevel.MEDIUM -> strings.get(R.string.settings_effort_medium)
                            com.flashcardsopensourceapp.data.local.model.EffortLevel.LONG -> strings.get(R.string.settings_effort_long)
                        }
                    }
                )
            )
        }
        if (filterDefinition.tags.isNotEmpty()) {
            add(
                strings.get(
                    R.string.settings_deck_filter_tags_any,
                    filterDefinition.tags.joinToString(separator = ", ")
                )
            )
        }
    }

    if (parts.isEmpty()) {
        return strings.get(R.string.settings_decks_all_cards)
    }

    return parts.joinToString(separator = strings.get(R.string.settings_deck_filter_join))
}

private fun buildAllCardsDeckListEntry(
    overview: WorkspaceOverviewSummary?,
    strings: SettingsStringResolver
): DeckListEntryUiState {
    return DeckListEntryUiState(
        target = DeckListTargetUiState.AllCards,
        title = strings.get(R.string.settings_decks_all_cards),
        filterSummary = strings.get(R.string.settings_decks_all_cards),
        totalCards = overview?.totalCards ?: 0,
        dueCards = overview?.dueCount ?: 0,
        newCards = overview?.newCount ?: 0,
        reviewedCards = overview?.reviewedCount ?: 0
    )
}
