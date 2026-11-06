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

func catalogLanguageCodes(decks: [CatalogBrowseIndexDeck]) -> Set<String> {
    Set(decks.flatMap { deck in
        deck.languageTags.map { tag in
            catalogBaseLanguageCode(languageIdentifier: tag)
        }
    })
}

func catalogLanguageDisplayName(code: String, locale: Locale) -> String {
    guard let name = locale.localizedString(forLanguageCode: code), name.isEmpty == false else {
        return code
    }

    return name.prefix(1).uppercased(with: locale) + name.dropFirst()
}

func sortedCatalogLanguageCodes(codes: Set<String>, locale: Locale) -> [String] {
    codes.sorted { left, right in
        catalogLanguageDisplayName(code: left, locale: locale)
            .compare(catalogLanguageDisplayName(code: right, locale: locale), locale: locale) == .orderedAscending
    }
}

/// The app's language when the catalog has decks in it, otherwise every language.
func defaultCatalogLanguageFilter(
    languageCodes: Set<String>,
    appLocaleIdentifier: String?
) -> CatalogLanguageFilter {
    guard let appLocaleIdentifier else {
        return .allLanguages
    }

    let appLanguageCode = catalogBaseLanguageCode(languageIdentifier: appLocaleIdentifier)
    return languageCodes.contains(appLanguageCode) ? .language(code: appLanguageCode) : .allLanguages
}

func catalogDecksMatching(
    decks: [CatalogBrowseIndexDeck],
    languageFilter: CatalogLanguageFilter,
    searchText: String,
    sortOrder: CatalogSortOrder
) -> [CatalogBrowseIndexDeck] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    let rankedDecks: [(deck: CatalogBrowseIndexDeck, rank: Int)] = decks.compactMap { deck in
        guard catalogDeckMatchesLanguage(deck: deck, languageFilter: languageFilter),
              let rank = catalogSearchRank(deck: deck, query: query) else {
            return nil
        }

        return (deck: deck, rank: rank)
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

private func catalogDeckMatchesLanguage(deck: CatalogBrowseIndexDeck, languageFilter: CatalogLanguageFilter) -> Bool {
    switch languageFilter {
    case .allLanguages:
        return true
    case .language(let code):
        return deck.languageTags.contains { tag in
            catalogBaseLanguageCode(languageIdentifier: tag) == code
        }
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
