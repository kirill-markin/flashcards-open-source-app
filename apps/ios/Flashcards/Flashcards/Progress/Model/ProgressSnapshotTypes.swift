import Foundation

struct ProgressCalendarDay: Hashable, Identifiable, Sendable {
    let date: Date
    let localDate: String
    let reviewCount: Int
    let isToday: Bool
    let isFuturePlaceholder: Bool
    let dayNumber: Int

    var id: String {
        self.localDate
    }
}

struct ProgressCalendarWeek: Hashable, Identifiable, Sendable {
    let days: [ProgressCalendarDay]

    var id: String {
        guard let firstDay = self.days.first else {
            preconditionFailure("Progress calendar week must contain at least one day")
        }

        return firstDay.localDate
    }
}

struct ProgressChartDay: Hashable, Identifiable, Sendable {
    let date: Date
    let localDate: String
    let reviewCount: Int
    let isToday: Bool

    var id: String {
        self.localDate
    }
}

struct ProgressChartData: Hashable, Sendable {
    let chartDays: [ProgressChartDay]
}

struct ProgressSnapshot: Hashable, Sendable {
    let scopeKey: ProgressScopeKey
    let summary: ProgressSummary
    let chartData: ProgressChartData
    let summarySourceState: ProgressSourceState
    let seriesSourceState: ProgressSourceState
    let isApproximate: Bool
    let generatedAt: String?
}

struct ReviewScheduleSnapshot: Hashable, Sendable {
    let scopeKey: ReviewScheduleScopeKey
    let schedule: UserReviewSchedule
    let sourceState: ProgressSourceState
    let isApproximate: Bool
    let generatedAt: String?
}
