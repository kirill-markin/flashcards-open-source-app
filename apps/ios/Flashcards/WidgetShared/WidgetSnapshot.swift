import Foundation

/// The next card Review would show; carries the question only, never the answer.
struct WidgetSnapshotCard: Codable, Sendable, Equatable {
    let cardId: String
    let frontPlainText: String
}

/// Review state the app hands to the Home Screen widget through the App Group.
struct WidgetSnapshot: Codable, Sendable, Equatable {
    let generatedAt: Date
    let workspaceId: String
    /// Equals the Review tab badge count at `generatedAt`.
    let dueCount: Int
    /// The next due times strictly after `generatedAt`, ascending, at most 100, with no time window.
    let upcomingDueAt: [Date]
    let streakDays: Int?
    let nextCard: WidgetSnapshotCard?
}
