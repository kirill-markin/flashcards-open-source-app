import Foundation

struct WorkspaceTagSummary: Codable, Hashable, Sendable {
    let tag: String
    let cardsCount: Int
}

struct WorkspaceTagsSummary: Codable, Hashable, Sendable {
    let tags: [WorkspaceTagSummary]
    let totalCards: Int
}

enum TagSuggestionCount: Hashable, Sendable {
    case loading
    case ready(cardsCount: Int)

    var cardsCount: Int? {
        switch self {
        case .loading:
            return nil
        case .ready(let cardsCount):
            return cardsCount
        }
    }
}

struct TagSuggestion: Hashable, Sendable {
    let tag: String
    let countState: TagSuggestionCount
}
