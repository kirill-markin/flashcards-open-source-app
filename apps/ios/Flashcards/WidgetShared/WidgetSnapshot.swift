import Foundation

/// The next card Review would show; carries the question only, never the answer.
struct WidgetSnapshotCard: Codable, Sendable, Equatable {
    let cardId: String
    let frontPlainText: String
}

enum WidgetSnapshotStreakDayState: String, Codable, Sendable, Equatable {
    case reviewed
    case frozen
    case missed
    case pending
}

struct WidgetSnapshotProgressDay: Codable, Sendable, Equatable {
    /// `yyyy-MM-dd` in the Progress time zone.
    let localDate: String
    let reviewCount: Int
    let againCount: Int
    let hardCount: Int
    let goodCount: Int
    let easyCount: Int
    let streakState: WidgetSnapshotStreakDayState
}

/// The Progress tab's review history and streak facts, as the app computed them; the widget never recomputes them.
struct WidgetSnapshotProgress: Codable, Sendable, Equatable {
    let todayLocalDate: String
    /// `Calendar.firstWeekday` of the Progress presentation calendar: 1 is Sunday.
    let firstWeekday: Int
    /// One entry per local day, ascending, ending with `todayLocalDate`.
    let days: [WidgetSnapshotProgressDay]
    let currentStreakDays: Int
    let longestStreakDays: Int
    let availableFreezeCredits: Int
}

struct WidgetSnapshotDueDay: Codable, Sendable, Equatable {
    let localDate: String
    /// Cards in the workspace whose due time falls on `localDate`.
    let dueCount: Int
}

enum WidgetSnapshotScheduleBucketKey: String, Codable, Sendable, Equatable {
    case new
    case today
    case days1To7
    case days8To30
    case days31To90
    case days91To360
    case years1To2
    case later
}

struct WidgetSnapshotScheduleBucket: Codable, Sendable, Equatable {
    let key: WidgetSnapshotScheduleBucketKey
    let count: Int
}

struct WidgetSnapshotBestDay: Codable, Sendable, Equatable {
    let localDate: String
    let reviewCount: Int
}

struct WidgetSnapshotStudyDay: Codable, Sendable, Equatable {
    let localDate: String
    let seconds: Double
}

/// The server-only Progress facts the widgets show, for the same day and time zone as `progress`.
struct WidgetSnapshotInsights: Codable, Sendable, Equatable {
    /// The best local day before today; nil before the first review day ended.
    let bestDayBeforeToday: WidgetSnapshotBestDay?
    /// Nil under the server's timing sample.
    let secondsPerDueCard: Double?
    /// The last 7 local days; nil under the server's timing sample.
    let studySecondsByDay: [WidgetSnapshotStudyDay]?
}

/// Review state the app hands to the Home Screen widgets through the App Group.
/// Fields added after the first widget release are optional so an older file still decodes.
struct WidgetSnapshot: Codable, Sendable, Equatable {
    let generatedAt: Date
    let workspaceId: String
    /// Ready cards in the workspace at `generatedAt`, including new cards.
    let dueCount: Int
    /// The next due times strictly after `generatedAt`, ascending, at most 100, with no time window.
    let upcomingDueAt: [Date]
    let streakDays: Int?
    let nextCard: WidgetSnapshotCard?
    /// Nil until the app has loaded Progress.
    let progress: WidgetSnapshotProgress?
    /// The 6 local days after the day of `generatedAt`, ascending.
    let upcomingDueDays: [WidgetSnapshotDueDay]?
    /// The Progress review schedule buckets in their stable order; nil until the app has loaded them.
    let reviewSchedule: [WidgetSnapshotScheduleBucket]?
    let accentColor: AccountAccentColor?
    /// New cards among `dueCount`; nil in a file written before the split existed.
    let newCount: Int?
    /// The first cards of the saved Review filter's queue, `nextCard` first when there is one, at most 6.
    let nextCards: [WidgetSnapshotCard]?
    /// Nil until the server's Progress facts for `progress` have loaded.
    let insights: WidgetSnapshotInsights?
}
