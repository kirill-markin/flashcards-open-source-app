import Foundation

private let progressDaysPerWeek: Int = 7
private let progressStreakWeekCount: Int = 5

struct ProgressDay: Decodable, Hashable, Identifiable, Sendable {
    let date: String
    let reviewCount: Int

    var id: String {
        self.date
    }
}

struct UserProgressSeries: Decodable, Hashable, Sendable {
    let timeZone: String
    let from: String
    let to: String
    let dailyReviews: [ProgressDay]

    var totalReviews: Int {
        self.dailyReviews.reduce(0) { partialResult, day in
            partialResult + day.reviewCount
        }
    }

    var activeDayCount: Int {
        self.dailyReviews.filter { day in
            day.reviewCount > 0
        }.count
    }

    var averageReviewsPerDay: Double {
        guard self.dailyReviews.isEmpty == false else {
            return 0
        }

        return Double(self.totalReviews) / Double(self.dailyReviews.count)
    }

    var bestDay: ProgressDay? {
        let candidate = self.dailyReviews.max { left, right in
            if left.reviewCount == right.reviewCount {
                return left.date < right.date
            }

            return left.reviewCount < right.reviewCount
        }

        guard let candidate, candidate.reviewCount > 0 else {
            return nil
        }

        return candidate
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

struct ProgressPresentation: Hashable, Sendable {
    let streakWeeks: [ProgressCalendarWeek]
    let chartDays: [ProgressChartDay]
    let chartUpperBound: Int
    let hasReviewActivity: Bool
}

enum ProgressPresentationError: LocalizedError {
    case duplicateDay(String)
    case invalidLocalDate(String)
    case invalidRange(String, String)
    case negativeReviewCount(String, Int)

    var errorDescription: String? {
        switch self {
        case .duplicateDay(let localDate):
            return "Progress contained duplicate daily entries for \(localDate)."
        case .invalidLocalDate(let localDate):
            return "Progress contained an invalid local date: \(localDate)."
        case .invalidRange(let from, let to):
            return "Progress contained an invalid date range from \(from) to \(to)."
        case .negativeReviewCount(let localDate, let reviewCount):
            return "Progress contained a negative review count for \(localDate): \(reviewCount)."
        }
    }
}

func makeProgressPresentation(
    series: UserProgressSeries,
    calendar: Calendar
) throws -> ProgressPresentation {
    let timeline = try makeProgressTimeline(series: series, calendar: calendar)
    let todayLocalDate = series.to
    let today = try progressDate(localDate: todayLocalDate, calendar: calendar)

    let chartDays = timeline.map { timelineDay in
        ProgressChartDay(
            date: timelineDay.date,
            localDate: timelineDay.localDate,
            reviewCount: timelineDay.reviewCount,
            isToday: timelineDay.localDate == todayLocalDate
        )
    }
    let streakWeeks = try makeProgressStreakWeeks(
        timeline: timeline,
        today: today,
        todayLocalDate: todayLocalDate,
        series: series,
        calendar: calendar
    )
    let maximumReviewCount = chartDays.map(\.reviewCount).max() ?? 0

    return ProgressPresentation(
        streakWeeks: streakWeeks,
        chartDays: chartDays,
        chartUpperBound: progressChartUpperBound(maximumReviewCount: maximumReviewCount),
        hasReviewActivity: maximumReviewCount > 0
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

private func makeProgressStreakWeeks(
    timeline: [ProgressTimelineDay],
    today: Date,
    todayLocalDate: String,
    series: UserProgressSeries,
    calendar: Calendar
) throws -> [ProgressCalendarWeek] {
    guard let currentWeekInterval = calendar.dateInterval(of: .weekOfYear, for: today) else {
        throw ProgressPresentationError.invalidRange(series.from, series.to)
    }

    let currentWeekStart = calendar.startOfDay(for: currentWeekInterval.start)
    let streakDayCount = progressDaysPerWeek * progressStreakWeekCount

    guard let streakStart = calendar.date(byAdding: .day, value: -(streakDayCount - progressDaysPerWeek), to: currentWeekStart) else {
        throw ProgressPresentationError.invalidRange(series.from, series.to)
    }

    let timelineByLocalDate = Dictionary(uniqueKeysWithValues: timeline.map { ($0.localDate, $0) })
    let streakDays = try (0 ..< streakDayCount).map { offset in
        guard let rawDate = calendar.date(byAdding: .day, value: offset, to: streakStart) else {
            throw ProgressPresentationError.invalidRange(series.from, series.to)
        }

        let date = calendar.startOfDay(for: rawDate)
        let localDate = progressLocalDateString(date: date, calendar: calendar)
        let isFuturePlaceholder = date > today
        let reviewCount: Int

        if isFuturePlaceholder == false {
            guard let timelineDay = timelineByLocalDate[localDate] else {
                throw ProgressPresentationError.invalidRange(series.from, series.to)
            }

            reviewCount = timelineDay.reviewCount
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
