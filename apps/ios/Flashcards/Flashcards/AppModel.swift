import Foundation

struct DeckSummary: Identifiable {
    let id: UUID
    let title: String
    let description: String
    let dueCount: Int
    let newCount: Int
}

struct ReviewCard: Identifiable {
    let id: UUID
    let deckTitle: String
    let prompt: String
    let answer: String
    let note: String
}

struct HomeSnapshot {
    let deckCount: Int
    let dueCount: Int
    let newCount: Int
    let reviewCount: Int
}

enum AppTab: Hashable {
    case home
    case review
    case settings
}

enum ReviewGrade: String, CaseIterable, Identifiable {
    case again = "Again"
    case good = "Good"
    case easy = "Easy"

    var id: String {
        rawValue
    }

    var symbolName: String {
        switch self {
        case .again:
            return "arrow.uturn.backward.circle.fill"
        case .good:
            return "checkmark.circle.fill"
        case .easy:
            return "sparkles"
        }
    }
}

func makeHomeSnapshot(decks: [DeckSummary], reviewCards: [ReviewCard]) -> HomeSnapshot {
    HomeSnapshot(
        deckCount: decks.count,
        dueCount: totalDueCount(decks: decks),
        newCount: totalNewCount(decks: decks),
        reviewCount: reviewCards.count
    )
}

func totalDueCount(decks: [DeckSummary]) -> Int {
    decks.reduce(0) { partialResult, deck in
        partialResult + deck.dueCount
    }
}

func totalNewCount(decks: [DeckSummary]) -> Int {
    decks.reduce(0) { partialResult, deck in
        partialResult + deck.newCount
    }
}

func sampleDecks() -> [DeckSummary] {
    [
        DeckSummary(
            id: UUID(uuidString: "70D6F3A6-8C53-4C06-83F4-FF6D0D9D0101")!,
            title: "Spanish Basics",
            description: "Travel phrases and daily verbs.",
            dueCount: 12,
            newCount: 6
        ),
        DeckSummary(
            id: UUID(uuidString: "70D6F3A6-8C53-4C06-83F4-FF6D0D9D0102")!,
            title: "Biology",
            description: "Cell structure and metabolism.",
            dueCount: 8,
            newCount: 4
        ),
        DeckSummary(
            id: UUID(uuidString: "70D6F3A6-8C53-4C06-83F4-FF6D0D9D0103")!,
            title: "Product Terms",
            description: "Core language for the first MVP.",
            dueCount: 5,
            newCount: 3
        )
    ]
}

func sampleReviewCards() -> [ReviewCard] {
    [
        ReviewCard(
            id: UUID(uuidString: "C6495A18-6CF6-470B-8C6A-05BDB0B60201")!,
            deckTitle: "Spanish Basics",
            prompt: "How do you say 'good morning' in Spanish?",
            answer: "Buenos dias",
            note: "Keep the answer short and easy to scan on mobile."
        ),
        ReviewCard(
            id: UUID(uuidString: "C6495A18-6CF6-470B-8C6A-05BDB0B60202")!,
            deckTitle: "Biology",
            prompt: "What organelle is known as the powerhouse of the cell?",
            answer: "The mitochondrion",
            note: "The first version can stay text-only."
        ),
        ReviewCard(
            id: UUID(uuidString: "C6495A18-6CF6-470B-8C6A-05BDB0B60203")!,
            deckTitle: "Product Terms",
            prompt: "What does offline-first mean in this app?",
            answer: "The phone writes to local storage first, then syncs later.",
            note: "This matches the repo architecture notes."
        )
    ]
}
