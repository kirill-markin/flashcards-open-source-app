import Foundation

enum CatalogLanguageFilter: Hashable, Sendable {
    case allLanguages
    /// A base language code such as `en` or `pt`, compared against each deck tag's base language.
    case language(code: String)
}

enum CatalogSortOrder: Hashable, CaseIterable, Sendable {
    case relevance
    case title
    case newest

    var localizedTitle: String {
        switch self {
        case .relevance: String(localized: "catalog.list.sort.relevance", table: "Foundation")
        case .title: String(localized: "catalog.list.sort.title_option", table: "Foundation")
        case .newest: String(localized: "catalog.list.sort.newest", table: "Foundation")
        }
    }
}

private let catalogSearchOptions: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]

/// Deck tags and app locales differ in region and script (`pt` against `pt-BR`), so both sides
/// compare by base language.
func catalogBaseLanguageCode(languageIdentifier: String) -> String {
    Locale.Language(identifier: languageIdentifier).languageCode?.identifier ?? languageIdentifier
}

/// An index deck with its base language codes, resolved once per published index.
struct CatalogListedDeck: Hashable, Sendable {
    let deck: CatalogBrowseIndexDeck
    let languageCodes: Set<String>
}

func makeCatalogListedDecks(decks: [CatalogBrowseIndexDeck]) -> [CatalogListedDeck] {
    decks.map { deck in
        CatalogListedDeck(
            deck: deck,
            languageCodes: Set(deck.languageTags.map { tag in
                catalogBaseLanguageCode(languageIdentifier: tag)
            })
        )
    }
}

func catalogLanguageCodes(listedDecks: [CatalogListedDeck]) -> Set<String> {
    listedDecks.reduce(into: Set<String>()) { codes, listedDeck in
        codes.formUnion(listedDeck.languageCodes)
    }
}

func catalogLanguageDisplayName(code: String, locale: Locale) -> String {
    guard let name = locale.localizedString(forLanguageCode: code), name.isEmpty == false else {
        return code
    }

    return name.prefix(1).uppercased(with: locale) + name.dropFirst()
}

func sortedCatalogLanguageCodes(codes: Set<String>, locale: Locale) -> [String] {
    codes.map { code in
        (code: code, name: catalogLanguageDisplayName(code: code, locale: locale))
    }.sorted { left, right in
        left.name.compare(right.name, locale: locale) == .orderedAscending
    }.map(\.code)
}

/// The app's language when the catalog has decks in it, otherwise every language.
func defaultCatalogLanguageFilter(
    languageCodes: [String],
    appLocaleIdentifier: String?
) -> CatalogLanguageFilter {
    guard let appLocaleIdentifier else {
        return .allLanguages
    }

    let appLanguageCode = catalogBaseLanguageCode(languageIdentifier: appLocaleIdentifier)
    return languageCodes.contains(appLanguageCode) ? .language(code: appLanguageCode) : .allLanguages
}

func catalogDecksMatching(
    listedDecks: [CatalogListedDeck],
    languageFilter: CatalogLanguageFilter,
    searchText: String,
    sortOrder: CatalogSortOrder
) -> [CatalogBrowseIndexDeck] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    let rankedDecks: [(deck: CatalogBrowseIndexDeck, rank: Int)] = listedDecks.compactMap { listedDeck in
        guard catalogDeckMatchesLanguage(listedDeck: listedDeck, languageFilter: languageFilter),
              let rank = catalogSearchRank(deck: listedDeck.deck, query: query) else {
            return nil
        }

        return (deck: listedDeck.deck, rank: rank)
    }

    return rankedDecks.sorted { left, right in
        switch sortOrder {
        case .relevance:
            if left.rank != right.rank {
                return left.rank < right.rank
            }
            return catalogDeckIsNewer(left: left.deck, right: right.deck)
        case .title:
            let titleOrder = left.deck.title.localizedStandardCompare(right.deck.title)
            if titleOrder != .orderedSame {
                return titleOrder == .orderedAscending
            }
            return catalogDeckIsNewer(left: left.deck, right: right.deck)
        case .newest:
            return catalogDeckIsNewer(left: left.deck, right: right.deck)
        }
    }.map(\.deck)
}

private func catalogDeckMatchesLanguage(listedDeck: CatalogListedDeck, languageFilter: CatalogLanguageFilter) -> Bool {
    switch languageFilter {
    case .allLanguages:
        return true
    case .language(let code):
        return listedDeck.languageCodes.contains(code)
    }
}

/// Lower ranks are more relevant: title prefix, then title substring, then summary or subject.
/// Nil means the deck does not match.
private func catalogSearchRank(deck: CatalogBrowseIndexDeck, query: String) -> Int? {
    if query.isEmpty {
        return 0
    }
    if deck.title.range(of: query, options: catalogSearchOptions.union(.anchored)) != nil {
        return 0
    }
    if deck.title.range(of: query, options: catalogSearchOptions) != nil {
        return 1
    }
    if deck.summary.range(of: query, options: catalogSearchOptions) != nil
        || deck.educationalSubject.range(of: query, options: catalogSearchOptions) != nil {
        return 2
    }

    return nil
}

/// Newest first; equal timestamps fall back to the package id so the order is stable.
private func catalogDeckIsNewer(left: CatalogBrowseIndexDeck, right: CatalogBrowseIndexDeck) -> Bool {
    if left.publishedAt != right.publishedAt {
        return left.publishedAt > right.publishedAt
    }

    return left.packageId < right.packageId
}
