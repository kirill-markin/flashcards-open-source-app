package com.flashcardsopensourceapp.feature.cards.catalog

import com.flashcardsopensourceapp.data.local.model.catalog.CatalogBrowseIndexDeck
import java.text.Collator
import java.text.Normalizer
import java.util.Locale

enum class CatalogSortOrder {
    RELEVANCE,
    TITLE,
    NEWEST
}

sealed interface CatalogLanguageFilter {
    data object AllLanguages : CatalogLanguageFilter
    data class Language(val languageCode: String) : CatalogLanguageFilter
}

/** A deck with its search fields folded once per index, so typing never re-normalizes the catalog. */
data class CatalogSearchableDeck(
    val deck: CatalogBrowseIndexDeck,
    val languageCodes: Set<String>,
    val foldedTitle: String,
    val foldedSummary: String,
    val foldedSubject: String
)

private val combiningMarksPattern: Regex = Regex("\\p{Mn}+")

/** Case- and diacritic-insensitive form used on both sides of a catalog search. */
fun foldCatalogSearchText(text: String): String {
    return Normalizer.normalize(text, Normalizer.Form.NFD)
        .replace(combiningMarksPattern, "")
        .lowercase(Locale.ROOT)
}

/** Primary language subtag, so `pt-BR` and `pt` filter together. */
fun catalogLanguageCode(languageTag: String): String {
    return Locale.forLanguageTag(languageTag).language
}

fun makeCatalogSearchableDecks(decks: List<CatalogBrowseIndexDeck>): List<CatalogSearchableDeck> {
    return decks.map { deck ->
        CatalogSearchableDeck(
            deck = deck,
            languageCodes = deck.languageTags.map(::catalogLanguageCode).filter(String::isNotEmpty).toSet(),
            foldedTitle = foldCatalogSearchText(text = deck.title),
            foldedSummary = foldCatalogSearchText(text = deck.summary),
            foldedSubject = foldCatalogSearchText(text = deck.educationalSubject)
        )
    }
}

fun catalogAvailableLanguageCodes(decks: List<CatalogSearchableDeck>): List<String> {
    return decks.flatMap(CatalogSearchableDeck::languageCodes).distinct().sorted()
}

/** The app language when any deck is in it, otherwise every language. */
fun defaultCatalogLanguageFilter(
    availableLanguageCodes: List<String>,
    appLanguageCode: String
): CatalogLanguageFilter {
    return if (availableLanguageCodes.contains(appLanguageCode)) {
        CatalogLanguageFilter.Language(languageCode = appLanguageCode)
    } else {
        CatalogLanguageFilter.AllLanguages
    }
}

/** Lower is more relevant: title prefix, then title substring, then summary or subject; null excludes. */
private fun catalogSearchRank(deck: CatalogSearchableDeck, foldedQuery: String): Int? {
    return when {
        deck.foldedTitle.startsWith(foldedQuery) -> 0
        deck.foldedTitle.contains(foldedQuery) -> 1
        deck.foldedSummary.contains(foldedQuery) || deck.foldedSubject.contains(foldedQuery) -> 2
        else -> null
    }
}

private data class RankedCatalogDeck(
    val deck: CatalogSearchableDeck,
    val rank: Int
)

fun queryCatalogDecks(
    decks: List<CatalogSearchableDeck>,
    searchQuery: String,
    languageFilter: CatalogLanguageFilter,
    sortOrder: CatalogSortOrder,
    locale: Locale
): List<CatalogBrowseIndexDeck> {
    val foldedQuery = foldCatalogSearchText(text = searchQuery.trim())
    val rankedDecks = decks
        .filter { deck ->
            when (languageFilter) {
                CatalogLanguageFilter.AllLanguages -> true
                is CatalogLanguageFilter.Language -> deck.languageCodes.contains(languageFilter.languageCode)
            }
        }
        .mapNotNull { deck ->
            if (foldedQuery.isEmpty()) {
                RankedCatalogDeck(deck = deck, rank = 0)
            } else {
                catalogSearchRank(deck = deck, foldedQuery = foldedQuery)?.let { rank ->
                    RankedCatalogDeck(deck = deck, rank = rank)
                }
            }
        }
    val newestFirst = compareByDescending<RankedCatalogDeck> { ranked -> ranked.deck.deck.publishedAtMillis }
    val titleCollator = Collator.getInstance(locale)
    val byTitle = Comparator<RankedCatalogDeck> { left, right ->
        titleCollator.compare(left.deck.deck.title, right.deck.deck.title)
    }
    val comparator = when (sortOrder) {
        CatalogSortOrder.RELEVANCE -> compareBy<RankedCatalogDeck> { ranked -> ranked.rank }
            .then(newestFirst)
            .then(byTitle)
        CatalogSortOrder.TITLE -> byTitle.then(newestFirst)
        CatalogSortOrder.NEWEST -> newestFirst.then(byTitle)
    }
    return rankedDecks.sortedWith(comparator).map { ranked -> ranked.deck.deck }
}
