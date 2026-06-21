package com.flashcardsopensourceapp.data.local.model.cards

import org.json.JSONArray
import org.json.JSONObject

private const val maximumSearchTokenCount: Int = 5

fun tokenizeSearchText(searchText: String): List<String> {
    val normalizedSearchText = searchText.trim().lowercase()

    if (normalizedSearchText.isEmpty()) {
        return emptyList()
    }

    val tokens = normalizedSearchText.split(Regex("\\s+")).filter { token ->
        token.isNotEmpty()
    }

    if (tokens.size <= maximumSearchTokenCount) {
        return tokens
    }

    return tokens.take(maximumSearchTokenCount - 1) + listOf(
        tokens.drop(maximumSearchTokenCount - 1).joinToString(separator = " ")
    )
}

fun normalizeTag(rawValue: String): String {
    return rawValue.trim()
}

fun normalizeTagKey(tag: String): String {
    return normalizeTag(rawValue = tag).lowercase()
}

fun canonicalTagValue(rawValue: String, referenceTags: List<String>): String? {
    val normalizedValue = normalizeTag(rawValue = rawValue)

    if (normalizedValue.isEmpty()) {
        return null
    }

    val normalizedKey = normalizeTagKey(tag = normalizedValue)
    val matchingReferenceTag = referenceTags.firstOrNull { referenceTag ->
        normalizeTagKey(tag = referenceTag) == normalizedKey
    }

    return matchingReferenceTag?.let(::normalizeTag) ?: normalizedValue
}

fun normalizeTags(values: List<String>, referenceTags: List<String>): List<String> {
    return values.fold(emptyList()) { result, value ->
        val canonicalValue = canonicalTagValue(
            rawValue = value,
            referenceTags = referenceTags + result
        ) ?: return@fold result

        if (result.any { existingValue ->
                normalizeTagKey(tag = existingValue) == normalizeTagKey(tag = canonicalValue)
            }) {
            return@fold result
        }

        result + canonicalValue
    }
}

fun buildCardFilter(tags: List<String>, referenceTags: List<String>): CardFilter {
    return CardFilter(
        tags = normalizeTags(values = tags, referenceTags = referenceTags)
    )
}

fun cardFilterActiveDimensionCount(filter: CardFilter): Int {
    val tagDimension = if (filter.tags.isEmpty()) 0 else 1
    return tagDimension
}

fun formatCardFilterSummary(filter: CardFilter): String {
    val parts = buildList {
        if (filter.tags.isNotEmpty()) {
            add("tags any of ${filter.tags.joinToString(separator = ", ")}")
        }
    }

    if (parts.isEmpty()) {
        return "No filters"
    }

    return parts.joinToString(separator = " AND ")
}

fun buildDeckFilterDefinition(tags: List<String>): DeckFilterDefinition {
    return DeckFilterDefinition(
        version = 2,
        tags = normalizeTags(values = tags, referenceTags = emptyList())
    )
}

fun formatDeckFilterDefinition(filterDefinition: DeckFilterDefinition): String {
    val parts = buildList {
        if (filterDefinition.tags.isNotEmpty()) {
            add("tags any of ${filterDefinition.tags.joinToString(separator = ", ")}")
        }
    }

    if (parts.isEmpty()) {
        return "All cards"
    }

    return parts.joinToString(separator = " AND ")
}

fun encodeDeckFilterDefinitionJson(filterDefinition: DeckFilterDefinition): String {
    return buildDeckFilterDefinitionJsonObject(filterDefinition = filterDefinition).toString()
}

fun buildDeckFilterDefinitionJsonObject(filterDefinition: DeckFilterDefinition): JSONObject {
    return JSONObject()
        .put("version", filterDefinition.version)
        .put("tags", JSONArray(filterDefinition.tags))
}

fun decodeDeckFilterDefinitionJson(filterDefinitionJson: String): DeckFilterDefinition {
    val jsonObject = JSONObject(filterDefinitionJson)
    val version = jsonObject.getInt("version")
    val tags = jsonObject.optJSONArray("tags")?.toStringList() ?: emptyList()

    return buildDeckFilterDefinition(
        tags = tags
    ).copy(version = version)
}

fun matchesCardFilter(filter: CardFilter, card: CardSummary): Boolean {
    if (filter.tags.isEmpty()) {
        return true
    }

    val cardTags = card.tags.map(::normalizeTagKey).toSet()
    return filter.tags.any { tag ->
        cardTags.contains(normalizeTagKey(tag = tag))
    }
}

fun matchesDeckFilterDefinition(filterDefinition: DeckFilterDefinition, card: CardSummary): Boolean {
    // Keep deck matching semantics aligned with apps/web/src/appData/domain/index.ts::matchesDeckFilterDefinition and apps/ios/Flashcards/Flashcards/Cards/List/CardFilterSupport.swift::matchesDeckFilterDefinition.
    if (filterDefinition.tags.isEmpty()) {
        return true
    }

    val cardTags = card.tags.map(::normalizeTagKey).toSet()
    return filterDefinition.tags.any { tag ->
        cardTags.contains(normalizeTagKey(tag = tag))
    }
}

private fun matchesSearchTokens(values: List<String>, searchTokens: List<String>): Boolean {
    val normalizedValues = values.map { value ->
        value.lowercase()
    }

    return searchTokens.all { token ->
        normalizedValues.any { value ->
            value.contains(other = token)
        }
    }
}

fun queryCards(cards: List<CardSummary>, searchText: String, filter: CardFilter): List<CardSummary> {
    val filteredCards = if (cardFilterActiveDimensionCount(filter = filter) == 0) {
        cards
    } else {
        cards.filter { card ->
            matchesCardFilter(filter = filter, card = card)
        }
    }
    val searchTokens = tokenizeSearchText(searchText = searchText)

    if (searchTokens.isEmpty()) {
        return filteredCards
    }

    return filteredCards.filter { card ->
        matchesSearchTokens(
            values = listOf(card.frontText, card.backText) + card.tags,
            searchTokens = searchTokens
        )
    }
}

private fun JSONArray.toStringList(): List<String> {
    return buildList {
        for (index in 0 until length()) {
            add(getString(index))
        }
    }
}
