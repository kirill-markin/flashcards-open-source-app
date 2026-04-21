import Foundation
import SwiftUI

private let progressDaysPerWeek: Int = 7
private let progressStreakWeekCount: Int = 5
let reviewProgressBadgeOverflowThreshold: Int = 99

struct ProgressDay: Codable, Hashable, Identifiable, Sendable {
    let date: String
    let reviewCount: Int

    var id: String {
        self.date
    }
}

struct ProgressSummary: Codable, Hashable, Sendable {
    let currentStreakDays: Int
    let hasReviewedToday: Bool
    let lastReviewedOn: String?
    let activeReviewDays: Int
}

struct UserProgressSummary: Codable, Hashable, Sendable {
    let timeZone: String?
    let summary: ProgressSummary
    let generatedAt: String?

    enum CodingKeys: String, CodingKey {
        case timeZone
        case summary
        case generatedAt
        case currentStreakDays
        case hasReviewedToday
        case lastReviewedOn
        case activeReviewDays
    }

    init(
        timeZone: String?,
        summary: ProgressSummary,
        generatedAt: String?
    ) {
        self.timeZone = timeZone
        self.summary = summary
        self.generatedAt = generatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.summary) {
            self.init(
                timeZone: try container.decodeIfPresent(String.self, forKey: .timeZone),
                summary: try container.decode(ProgressSummary.self, forKey: .summary),
                generatedAt: try container.decodeIfPresent(String.self, forKey: .generatedAt)
            )
            return
        }

        self.init(
            timeZone: try container.decodeIfPresent(String.self, forKey: .timeZone),
            summary: ProgressSummary(
                currentStreakDays: try container.decode(Int.self, forKey: .currentStreakDays),
                hasReviewedToday: try container.decode(Bool.self, forKey: .hasReviewedToday),
                lastReviewedOn: try container.decodeIfPresent(String.self, forKey: .lastReviewedOn),
                activeReviewDays: try container.decode(Int.self, forKey: .activeReviewDays)
            ),
            generatedAt: try container.decodeIfPresent(String.self, forKey: .generatedAt)
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(self.timeZone, forKey: .timeZone)
        try container.encode(self.summary, forKey: .summary)
        try container.encodeIfPresent(self.generatedAt, forKey: .generatedAt)
    }
}

struct UserProgressSeries: Codable, Hashable, Sendable {
    let timeZone: String
    let from: String
    let to: String
    let dailyReviews: [ProgressDay]
    let summary: ProgressSummary?
    let generatedAt: String?

    init(
        timeZone: String,
        from: String,
        to: String,
        dailyReviews: [ProgressDay],
        summary: ProgressSummary?,
        generatedAt: String?
    ) {
        self.timeZone = timeZone
        self.from = from
        self.to = to
        self.dailyReviews = dailyReviews
        self.summary = summary
        self.generatedAt = generatedAt
    }
}

enum ProgressSourceState: String, Codable, Hashable, Sendable {
    case localOnly = "local_only"
    case serverBase = "server_base"
    case serverBaseWithPendingLocalOverlay = "server_base_with_pending_local_overlay"
}

struct ProgressScopeKey: Codable, Hashable, Sendable {
    let cloudState: CloudAccountState?
    let linkedUserId: String?
    /// Tracks the canonical cached workspace membership that contributes to aggregated progress.
    /// Switching the active workspace keeps this stable, but create/delete/merge membership changes rotate the scope.
    let workspaceMembershipKey: String
    let timeZone: String
    let from: String
    let to: String

    var storageKey: String {
        let cloudStateKey = self.cloudState?.rawValue ?? "none"
        let linkedUserIdKey = self.linkedUserId ?? "none"
        return [
            cloudStateKey,
            linkedUserIdKey,
            self.workspaceMembershipKey,
            self.timeZone,
            self.from,
            self.to,
        ].joined(separator: "|")
    }
}

struct ProgressSummaryScopeKey: Codable, Hashable, Sendable {
    let cloudState: CloudAccountState?
    let linkedUserId: String?
    let workspaceMembershipKey: String
    let timeZone: String
    /// Summary fields such as hasReviewedToday and currentStreakDays are relative to a local "today".
    /// Keep the cache keyed by that local date so yesterday's summary is never reused after midnight.
    let referenceLocalDate: String

    var storageKey: String {
        let cloudStateKey = self.cloudState?.rawValue ?? "none"
        let linkedUserIdKey = self.linkedUserId ?? "none"
        return [
            cloudStateKey,
            linkedUserIdKey,
            self.workspaceMembershipKey,
            self.timeZone,
            self.referenceLocalDate,
        ].joined(separator: "|")
    }
}

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
    let chartUpperBound: Int
    let hasReviewActivity: Bool
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

struct ReviewProgressBadgeState: Hashable, Sendable {
    let streakDays: Int
    let hasReviewedToday: Bool
    let isInteractive: Bool
}

struct ReviewProgressBadgePresentation {
    let iconSystemName: String
    let borderColor: Color
    let iconColor: Color
    let textColor: Color
}

func makeEmptyReviewProgressBadgeState() -> ReviewProgressBadgeState {
    ReviewProgressBadgeState(
        streakDays: 0,
        hasReviewedToday: false,
        isInteractive: true
    )
}

func makeReviewProgressBadgePresentation(badgeState: ReviewProgressBadgeState) -> ReviewProgressBadgePresentation {
    ReviewProgressBadgePresentation(
        iconSystemName: badgeState.hasReviewedToday ? "flame.fill" : "flame",
        borderColor: badgeState.hasReviewedToday ? .accentColor.opacity(0.55) : .gray.opacity(0.35),
        iconColor: badgeState.hasReviewedToday ? .accentColor : .gray,
        textColor: badgeState.hasReviewedToday ? .primary : .secondary
    )
}

func formatReviewProgressBadgeValue(badgeState: ReviewProgressBadgeState) -> String {
    if badgeState.streakDays > reviewProgressBadgeOverflowThreshold {
        return "\(reviewProgressBadgeOverflowThreshold)+"
    }

    return badgeState.streakDays.formatted()
}

enum ProgressPresentationError: LocalizedError {
    case duplicateDay(String)
    case invalidLocalDate(String)
    case invalidTimeZone(String)
    case invalidRange(String, String)
    case negativeReviewCount(String, Int)
    case summaryMetadataMismatch(expectedTimeZone: String, actualTimeZone: String)
    case seriesMetadataMismatch(expected: ProgressScopeKey, actualTimeZone: String, actualFrom: String, actualTo: String)

    var errorDescription: String? {
        switch self {
        case .duplicateDay(let localDate):
            return "Progress contained duplicate daily entries for \(localDate)."
        case .invalidLocalDate(let localDate):
            return "Progress contained an invalid local date: \(localDate)."
        case .invalidTimeZone(let timeZoneIdentifier):
            return "Progress contained an invalid timezone identifier: \(timeZoneIdentifier)."
        case .invalidRange(let from, let to):
            return "Progress contained an invalid date range from \(from) to \(to)."
        case .negativeReviewCount(let localDate, let reviewCount):
            return "Progress contained a negative review count for \(localDate): \(reviewCount)."
        case .summaryMetadataMismatch(let expectedTimeZone, let actualTimeZone):
            return "Progress summary metadata mismatched the current scope. Expected \(expectedTimeZone), received \(actualTimeZone)."
        case .seriesMetadataMismatch(let expected, let actualTimeZone, let actualFrom, let actualTo):
            return "Progress series metadata mismatched the current scope. Expected \(expected.timeZone) \(expected.from)...\(expected.to), received \(actualTimeZone) \(actualFrom)...\(actualTo)."
        }
    }
}

func makeReviewProgressBadgeState(progressSnapshot: ProgressSnapshot?) -> ReviewProgressBadgeState {
    guard let progressSnapshot else {
        return makeEmptyReviewProgressBadgeState()
    }

    return ReviewProgressBadgeState(
        streakDays: progressSnapshot.summary.currentStreakDays,
        hasReviewedToday: progressSnapshot.summary.hasReviewedToday,
        isInteractive: true
    )
}

func makeReviewProgressBadgeState(summary: ProgressSummary) -> ReviewProgressBadgeState {
    ReviewProgressBadgeState(
        streakDays: summary.currentStreakDays,
        hasReviewedToday: summary.hasReviewedToday,
        isInteractive: true
    )
}

func makeProgressSnapshot(
    summary: ProgressSummary,
    series: UserProgressSeries,
    scopeKey: ProgressScopeKey,
    summarySourceState: ProgressSourceState,
    seriesSourceState: ProgressSourceState,
    calendar: Calendar
) throws -> ProgressSnapshot {
    try validateProgressSeriesMetadata(series: series, scopeKey: scopeKey)
    let timeline = try makeProgressTimeline(series: series, calendar: calendar)
    let todayLocalDate = series.to

    let chartDays = timeline.map { timelineDay in
        ProgressChartDay(
            date: timelineDay.date,
            localDate: timelineDay.localDate,
            reviewCount: timelineDay.reviewCount,
            isToday: timelineDay.localDate == todayLocalDate
        )
    }
    let maximumReviewCount = chartDays.map(\.reviewCount).max() ?? 0
    let chartData = ProgressChartData(
        chartDays: chartDays,
        chartUpperBound: progressChartUpperBound(maximumReviewCount: maximumReviewCount),
        hasReviewActivity: maximumReviewCount > 0
    )

    return ProgressSnapshot(
        scopeKey: scopeKey,
        summary: summary,
        chartData: chartData,
        summarySourceState: summarySourceState,
        seriesSourceState: seriesSourceState,
        isApproximate: summarySourceState == .localOnly || seriesSourceState == .localOnly,
        generatedAt: series.generatedAt
    )
}

private struct ProgressTimelineDay: Hashable, Sendable {
    let date: Date
    let localDate: String
    let reviewCount: Int
}

private func makeProgressTimeline(
    series: UserProgressSeries,
    calendar: Calendar
) throws -> [ProgressTimelineDay] {
    let startDate = try progressDate(localDate: series.from, calendar: calendar)
    let endDate = try progressDate(localDate: series.to, calendar: calendar)

    guard startDate <= endDate else {
        throw ProgressPresentationError.invalidRange(series.from, series.to)
    }

    var reviewCountsByLocalDate: [String: Int] = [:]
    for day in series.dailyReviews {
        guard day.reviewCount >= 0 else {
            throw ProgressPresentationError.negativeReviewCount(day.date, day.reviewCount)
        }

        if reviewCountsByLocalDate.updateValue(day.reviewCount, forKey: day.date) != nil {
            throw ProgressPresentationError.duplicateDay(day.date)
        }
    }

    var timeline: [ProgressTimelineDay] = []
    var currentDate = startDate
    while currentDate <= endDate {
        let localDate = progressLocalDateString(date: currentDate, calendar: calendar)
        timeline.append(
            ProgressTimelineDay(
                date: currentDate,
                localDate: localDate,
                reviewCount: reviewCountsByLocalDate[localDate] ?? 0
            )
        )

        guard let nextDate = calendar.date(byAdding: .day, value: 1, to: currentDate) else {
            throw ProgressPresentationError.invalidRange(series.from, series.to)
        }
        currentDate = nextDate
    }

    return timeline
}

func makeProgressSummary(
    reviewDates: Set<String>,
    timeZone: String,
    generatedAt: Date
) throws -> ProgressSummary {
    let sortedReviewDates = reviewDates.sorted()
    let today = try progressTimeZoneLocalDateString(
        date: generatedAt,
        timeZoneIdentifier: timeZone
    )
    let lastReviewedOn = sortedReviewDates.last
    return ProgressSummary(
        currentStreakDays: calculateProgressCurrentStreakDays(
            reviewDates: reviewDates,
            todayLocalDate: today
        ),
        hasReviewedToday: reviewDates.contains(today),
        lastReviewedOn: lastReviewedOn,
        activeReviewDays: sortedReviewDates.count
    )
}

func makeProgressSeries(
    timeZone: String,
    from: String,
    to: String,
    dailyReviews: [ProgressDay],
    summary: ProgressSummary?,
    generatedAt: String?
) -> UserProgressSeries {
    UserProgressSeries(
        timeZone: timeZone,
        from: from,
        to: to,
        dailyReviews: dailyReviews,
        summary: summary,
        generatedAt: generatedAt
    )
}

func validateProgressSummaryMetadata(
    summary: UserProgressSummary,
    scopeKey: ProgressSummaryScopeKey
) throws {
    guard let actualTimeZone = summary.timeZone else {
        return
    }

    guard actualTimeZone == scopeKey.timeZone else {
        throw ProgressPresentationError.summaryMetadataMismatch(
            expectedTimeZone: scopeKey.timeZone,
            actualTimeZone: actualTimeZone
        )
    }
}

func makeProgressPresentationCalendar(
    timeZoneIdentifier: String,
    userCalendar: Calendar
) throws -> Calendar {
    guard let timeZone = TimeZone(identifier: timeZoneIdentifier) else {
        throw ProgressPresentationError.invalidTimeZone(timeZoneIdentifier)
    }

    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale.autoupdatingCurrent
    calendar.timeZone = timeZone
    calendar.firstWeekday = userCalendar.firstWeekday
    calendar.minimumDaysInFirstWeek = userCalendar.minimumDaysInFirstWeek
    return calendar
}

private func validateProgressSeriesMetadata(
    series: UserProgressSeries,
    scopeKey: ProgressScopeKey
) throws {
    guard
        series.timeZone == scopeKey.timeZone,
        series.from == scopeKey.from,
        series.to == scopeKey.to
    else {
        throw ProgressPresentationError.seriesMetadataMismatch(
            expected: scopeKey,
            actualTimeZone: series.timeZone,
            actualFrom: series.from,
            actualTo: series.to
        )
    }
}

private func calculateProgressCurrentStreakDays(
    reviewDates: Set<String>,
    todayLocalDate: String
) -> Int {
    var currentDate = reviewDates.contains(todayLocalDate)
        ? todayLocalDate
        : progressShiftLocalDate(value: todayLocalDate, offsetDays: -1)
    var streakDayCount = 0

    while reviewDates.contains(currentDate) {
        streakDayCount += 1
        currentDate = progressShiftLocalDate(value: currentDate, offsetDays: -1)
    }

    return streakDayCount
}

private func progressShiftLocalDate(value: String, offsetDays: Int) -> String {
    var components = DateComponents()
    components.year = Int(value.prefix(4))
    components.month = Int(value.dropFirst(5).prefix(2))
    components.day = Int(value.dropFirst(8).prefix(2))
    let calendar = Calendar(identifier: .gregorian)
    let baseDate = calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
    let nextDate = calendar.date(byAdding: .day, value: offsetDays, to: baseDate) ?? baseDate
    let nextComponents = calendar.dateComponents([.year, .month, .day], from: nextDate)
    return String(
        format: "%04d-%02d-%02d",
        nextComponents.year ?? 0,
        nextComponents.month ?? 0,
        nextComponents.day ?? 0
    )
}

private func progressTimeZoneLocalDateString(
    date: Date,
    timeZoneIdentifier: String
) throws -> String {
    guard let timeZone = TimeZone(identifier: timeZoneIdentifier) else {
        throw ProgressPresentationError.invalidLocalDate(timeZoneIdentifier)
    }

    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

func makeProgressStreakWeeks(
    chartDays: [ProgressChartDay],
    rangeStartLocalDate: String,
    todayLocalDate: String,
    calendar: Calendar
) throws -> [ProgressCalendarWeek] {
    let today = try progressDate(localDate: todayLocalDate, calendar: calendar)

    guard let currentWeekInterval = calendar.dateInterval(of: .weekOfYear, for: today) else {
        throw ProgressPresentationError.invalidRange(rangeStartLocalDate, todayLocalDate)
    }

    let currentWeekStart = calendar.startOfDay(for: currentWeekInterval.start)
    let streakDayCount = progressDaysPerWeek * progressStreakWeekCount

    guard let streakStart = calendar.date(byAdding: .day, value: -(streakDayCount - progressDaysPerWeek), to: currentWeekStart) else {
        throw ProgressPresentationError.invalidRange(rangeStartLocalDate, todayLocalDate)
    }

    let chartDaysByLocalDate = Dictionary(uniqueKeysWithValues: chartDays.map { ($0.localDate, $0) })
    let streakDays = try (0 ..< streakDayCount).map { offset in
        guard let rawDate = calendar.date(byAdding: .day, value: offset, to: streakStart) else {
            throw ProgressPresentationError.invalidRange(rangeStartLocalDate, todayLocalDate)
        }

        let date = calendar.startOfDay(for: rawDate)
        let localDate = progressLocalDateString(date: date, calendar: calendar)
        let isFuturePlaceholder = date > today
        let reviewCount: Int

        if isFuturePlaceholder == false {
            guard let chartDay = chartDaysByLocalDate[localDate] else {
                throw ProgressPresentationError.invalidRange(rangeStartLocalDate, todayLocalDate)
            }

            reviewCount = chartDay.reviewCount
        } else {
            reviewCount = 0
        }

        return ProgressCalendarDay(
            date: date,
            localDate: localDate,
            reviewCount: reviewCount,
            isToday: localDate == todayLocalDate,
            isFuturePlaceholder: isFuturePlaceholder,
            dayNumber: calendar.component(.day, from: date)
        )
    }

    return stride(from: 0, to: streakDays.count, by: progressDaysPerWeek).map { startIndex in
        ProgressCalendarWeek(days: Array(streakDays[startIndex ..< startIndex + progressDaysPerWeek]))
    }
}

private func progressChartUpperBound(maximumReviewCount: Int) -> Int {
    guard maximumReviewCount > 0 else {
        return 1
    }

    return Int(ceil(Double(maximumReviewCount) * 1.15))
}

private func progressDate(localDate: String, calendar: Calendar) throws -> Date {
    let components = localDate.split(separator: "-", omittingEmptySubsequences: false)

    guard
        components.count == 3,
        let year = Int(components[0]),
        let month = Int(components[1]),
        let day = Int(components[2]),
        let date = calendar.date(from: DateComponents(year: year, month: month, day: day))
    else {
        throw ProgressPresentationError.invalidLocalDate(localDate)
    }

    return calendar.startOfDay(for: date)
}

private func progressLocalDateString(date: Date, calendar: Calendar) -> String {
    let components = calendar.dateComponents([.year, .month, .day], from: date)

    guard let year = components.year, let month = components.month, let day = components.day else {
        preconditionFailure("Progress local date components are unavailable")
    }

    return String(format: "%04d-%02d-%02d", year, month, day)
}
