package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.decodeDeckFilterDefinitionJson
import com.flashcardsopensourceapp.data.local.model.encodeDeckFilterDefinitionJson
import com.flashcardsopensourceapp.data.local.model.isCardDue
import com.flashcardsopensourceapp.data.local.model.isNewCard
import com.flashcardsopensourceapp.data.local.model.isReviewedCard
import com.flashcardsopensourceapp.data.local.model.matchesDeckFilterDefinition

internal fun normalizeDeckDraft(deckDraft: DeckDraft): DeckDraft {
    val trimmedName: String = deckDraft.name.trim()

    require(trimmedName.isNotEmpty()) {
        "Deck name must not be empty."
    }
    require(deckDraft.filterDefinition.version == 2) {
        "Deck filter version must be 2."
    }

    return DeckDraft(
        name = trimmedName,
        filterDefinition = buildDeckFilterDefinition(
            effortLevels = deckDraft.filterDefinition.effortLevels,
            tags = deckDraft.filterDefinition.tags
        )
    )
}

internal fun toDeckSummary(
    deck: DeckEntity,
    cards: List<CardSummary>,
    nowMillis: Long
): DeckSummary {
    val filterDefinition: DeckFilterDefinition = decodeDeckFilterDefinition(
        filterDefinitionJson = deck.filterDefinitionJson
    )
    val matchingCards: List<CardSummary> = cards.filter { card ->
        matchesDeckFilterDefinition(filterDefinition = filterDefinition, card = card)
    }

    return DeckSummary(
        deckId = deck.deckId,
        workspaceId = deck.workspaceId,
        name = deck.name,
        filterDefinition = filterDefinition,
        totalCards = matchingCards.size,
        dueCards = matchingCards.count { card ->
            isCardDue(card = card, nowMillis = nowMillis)
        },
        newCards = matchingCards.count(::isNewCard),
        reviewedCards = matchingCards.count(::isReviewedCard),
        createdAtMillis = deck.createdAtMillis,
        updatedAtMillis = deck.updatedAtMillis
    )
}

internal fun encodeDeckFilterDefinition(filterDefinition: DeckFilterDefinition): String {
    return encodeDeckFilterDefinitionJson(filterDefinition = filterDefinition)
}

internal fun decodeDeckFilterDefinition(filterDefinitionJson: String): DeckFilterDefinition {
    return decodeDeckFilterDefinitionJson(filterDefinitionJson = filterDefinitionJson)
}
