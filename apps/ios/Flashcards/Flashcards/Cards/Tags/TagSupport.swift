import Foundation

func normalizeTag(rawValue: String) -> String {
    rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
}

func normalizeTagKey(tag: String) -> String {
    normalizeTag(rawValue: tag).lowercased()
}

func resolveExactStoredTagNames(requestedTagNames: [String], storedTagNames: [String]) -> [String] {
    let requestedTagKeys = requestedTagNames.reduce(into: [String]()) { result, tagName in
        let tagKey = normalizeTagKey(tag: tagName)
        guard tagKey.isEmpty == false else {
            return
        }
        guard result.contains(tagKey) == false else {
            return
        }

        result.append(tagKey)
    }
    if requestedTagKeys.isEmpty {
        return []
    }

    let requestedTagKeySet = Set(requestedTagKeys)
    return storedTagNames.reduce(into: [String]()) { result, storedTagName in
        guard requestedTagKeySet.contains(normalizeTagKey(tag: storedTagName)) else {
            return
        }
        guard result.contains(storedTagName) == false else {
            return
        }

        result.append(storedTagName)
    }
}

func hasTagMatchingRequest(storedTagNames: [String], requestedTagName: String) -> Bool {
    resolveExactStoredTagNames(
        requestedTagNames: [requestedTagName],
        storedTagNames: storedTagNames
    ).isEmpty == false
}

func canonicalTagValue(rawValue: String, referenceTags: [String]) -> String? {
    let normalizedValue = normalizeTag(rawValue: rawValue)
    if normalizedValue.isEmpty {
        return nil
    }

    let normalizedKey = normalizeTagKey(tag: normalizedValue)
    if let matchingReferenceTag = referenceTags.first(where: { referenceTag in
        normalizeTagKey(tag: referenceTag) == normalizedKey
    }) {
        return normalizeTag(rawValue: matchingReferenceTag)
    }

    return normalizedValue
}

func normalizeTags(values: [String], referenceTags: [String]) -> [String] {
    values.reduce(into: [String]()) { result, value in
        guard let canonicalValue = canonicalTagValue(rawValue: value, referenceTags: referenceTags + result) else {
            return
        }

        let canonicalKey = normalizeTagKey(tag: canonicalValue)
        if result.contains(where: { existingValue in
            normalizeTagKey(tag: existingValue) == canonicalKey
        }) {
            return
        }

        result.append(canonicalValue)
    }
}

private func tagSuggestionReferenceTags(suggestions: [TagSuggestion]) -> [String] {
    suggestions.map(\.tag)
}

private func makeTagSuggestionsIndex(suggestions: [TagSuggestion]) -> [String: TagSuggestion] {
    suggestions.reduce(into: [String: TagSuggestion]()) { result, suggestion in
        result[normalizeTagKey(tag: suggestion.tag)] = suggestion
    }
}

private func compareTagSuggestions(left: TagSuggestion, right: TagSuggestion) -> Bool {
    switch (left.countState, right.countState) {
    case (.ready(let leftCount), .ready(let rightCount)):
        if leftCount != rightCount {
            return leftCount > rightCount
        }
    case (.ready, .loading):
        return true
    case (.loading, .ready):
        return false
    case (.loading, .loading):
        break
    }

    return left.tag.localizedCaseInsensitiveCompare(right.tag) == .orderedAscending
}

func normalizeTagSuggestions(suggestions: [TagSuggestion]) -> [TagSuggestion] {
    suggestions.reduce(into: [TagSuggestion]()) { result, suggestion in
        guard let canonicalTag = canonicalTagValue(
            rawValue: suggestion.tag,
            referenceTags: tagSuggestionReferenceTags(suggestions: result)
        ) else {
            return
        }

        let nextSuggestion = TagSuggestion(
            tag: canonicalTag,
            countState: suggestion.countState
        )
        let canonicalKey = normalizeTagKey(tag: canonicalTag)
        if let existingIndex = result.firstIndex(where: { existingSuggestion in
            normalizeTagKey(tag: existingSuggestion.tag) == canonicalKey
        }) {
            switch (result[existingIndex].countState, nextSuggestion.countState) {
            case (.loading, .ready):
                result[existingIndex] = nextSuggestion
            case (.ready(let existingCount), .ready(let nextCount)):
                if nextCount > existingCount {
                    result[existingIndex] = nextSuggestion
                }
            case (.ready, .loading), (.loading, .loading):
                break
            }

            return
        }

        result.append(nextSuggestion)
    }.sorted(by: compareTagSuggestions)
}

func makeTagSuggestions(cards: [Card]) -> [TagSuggestion] {
    let activeCards = cards.filter { card in
        card.deletedAt == nil
    }
    let counts = activeCards.reduce(into: [String: Int]()) { result, card in
        for tag in normalizeTags(values: card.tags, referenceTags: []) {
            result[tag, default: 0] += 1
        }
    }

    return counts.map { entry in
        TagSuggestion(
            tag: entry.key,
            countState: .ready(cardsCount: entry.value)
        )
    }.sorted(by: compareTagSuggestions)
}

func makeWorkspaceTagsSummary(cards: [Card]) -> WorkspaceTagsSummary {
    let activeCards = cards.filter { card in
        card.deletedAt == nil
    }
    let counts = activeCards.reduce(into: [String: Int]()) { result, card in
        for tag in card.tags {
            result[tag, default: 0] += 1
        }
    }
    let tags = counts.map { entry in
        WorkspaceTagSummary(tag: entry.key, cardsCount: entry.value)
    }.sorted { leftTag, rightTag in
        if leftTag.cardsCount != rightTag.cardsCount {
            return leftTag.cardsCount > rightTag.cardsCount
        }

        return leftTag.tag.localizedCaseInsensitiveCompare(rightTag.tag) == .orderedAscending
    }

    return WorkspaceTagsSummary(tags: tags, totalCards: activeCards.count)
}

func filterTagSuggestions(suggestions: [TagSuggestion], selectedTags: [String], searchText: String) -> [TagSuggestion] {
    let selectedTagKeys = Set(selectedTags.map { tag in
        normalizeTagKey(tag: tag)
    })
    let normalizedSearchText = normalizeTag(rawValue: searchText).lowercased()

    return suggestions.filter { suggestion in
        if selectedTagKeys.contains(normalizeTagKey(tag: suggestion.tag)) {
            return false
        }

        if normalizedSearchText.isEmpty {
            return true
        }

        return suggestion.tag.lowercased().contains(normalizedSearchText)
    }
}

func selectedTagSuggestions(selectedTags: [String], suggestions: [TagSuggestion]) -> [TagSuggestion] {
    let referenceTags = tagSuggestionReferenceTags(suggestions: suggestions)
    let suggestionsIndex = makeTagSuggestionsIndex(suggestions: suggestions)

    return normalizeTags(values: selectedTags, referenceTags: referenceTags).map { tag in
        if let existingSuggestion = suggestionsIndex[normalizeTagKey(tag: tag)] {
            return existingSuggestion
        }

        return TagSuggestion(
            tag: tag,
            countState: .ready(cardsCount: 0)
        )
    }.sorted(by: compareTagSuggestions)
}

func creatableTagValue(searchText: String, selectedTags: [String], suggestions: [TagSuggestion]) -> String? {
    let normalizedSearchText = normalizeTag(rawValue: searchText)
    if normalizedSearchText.isEmpty {
        return nil
    }

    let normalizedSearchKey = normalizeTagKey(tag: normalizedSearchText)
    let existingTags = selectedTags + tagSuggestionReferenceTags(suggestions: suggestions)
    if existingTags.contains(where: { tag in
        normalizeTagKey(tag: tag) == normalizedSearchKey
    }) {
        return nil
    }

    return normalizedSearchText
}

func toggleTagSelection(selectedTags: [String], tag: String, suggestions: [TagSuggestion]) -> [String] {
    let tagKey = normalizeTagKey(tag: tag)
    if selectedTags.contains(where: { selectedTag in
        normalizeTagKey(tag: selectedTag) == tagKey
    }) {
        return selectedTags.filter { selectedTag in
            normalizeTagKey(tag: selectedTag) != tagKey
        }
    }

    return normalizeTags(
        values: selectedTags + [tag],
        referenceTags: tagSuggestionReferenceTags(suggestions: suggestions)
    )
}

func formatTagSelectionSummary(tags: [String]) -> String {
    if tags.isEmpty {
        return "No tags"
    }

    if tags.count <= 2 {
        return tags.joined(separator: ", ")
    }

    return "\(tags[0]), \(tags[1]) +\(tags.count - 2)"
}

func formatTags(tags: [String]) -> String {
    tags.joined(separator: ", ")
}
