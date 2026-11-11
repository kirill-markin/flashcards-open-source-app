import Foundation

enum CardsPresentationRequest: Hashable, Sendable {
    case createCard
}

struct CardEditorReadOnlyMetadata: Hashable, Sendable {
    let maintenanceScope: CardMaintenanceScope
    let dueAt: String?
    let reps: Int
    let lapses: Int
}

func cardEditorReadOnlyMetadata(card: Card) -> CardEditorReadOnlyMetadata {
    CardEditorReadOnlyMetadata(
        maintenanceScope: CardMaintenanceScope(
            workspaceId: card.workspaceId,
            kind: .resetCard,
            target: card.cardId,
            expectedDeckFilter: nil
        ),
        dueAt: card.dueAt,
        reps: card.reps,
        lapses: card.lapses
    )
}

func localizedCardDueValue(dueAt: String?) -> String {
    guard let dueAt else {
        return String(localized: "New", table: "ReviewCards")
    }

    guard let date = parseIsoTimestamp(value: dueAt) else {
        return dueAt
    }

    return date.formatted(date: .abbreviated, time: .shortened)
}

func localizedCardCountValue(count: Int) -> String {
    count.formatted()
}
