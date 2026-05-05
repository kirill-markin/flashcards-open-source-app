import Foundation

struct ProgressReviewChartPage: Identifiable {
    let days: [ProgressChartDay]
    let startLocalDate: String
    let startDate: Date
    let endDate: Date

    init(days: [ProgressChartDay]) {
        guard let firstDay = days.first, let lastDay = days.last else {
            preconditionFailure("Progress review chart page must contain at least one day")
        }

        self.days = days
        self.startLocalDate = firstDay.localDate
        self.startDate = firstDay.date
        self.endDate = lastDay.date
    }

    var id: String {
        self.startLocalDate
    }

    var xAxisValues: [String] {
        self.days.map(\.localDate)
    }

    func day(localDate: String) -> ProgressChartDay? {
        self.days.first(where: { day in
            day.localDate == localDate
        })
    }
}

struct ProgressReviewChartSelectionResetToken: Equatable {
    let selectionResetKey: String
    let chartDays: [ProgressChartDay]
}

func makeProgressReviewChartPages(
    chartDays: [ProgressChartDay],
    calendar: Calendar,
    today: Date?
) -> [ProgressReviewChartPage] {
    guard chartDays.isEmpty == false else {
        return []
    }

    var pages: [ProgressReviewChartPage] = []
    var currentPageDays: [ProgressChartDay] = []
    var currentWeekStart: Date? = nil

    for day in chartDays {
        guard let weekInterval = calendar.dateInterval(of: .weekOfYear, for: day.date) else {
            preconditionFailure("Expected a week interval for progress review chart day")
        }

        let weekStart = calendar.startOfDay(for: weekInterval.start)
        if let activeWeekStart = currentWeekStart, activeWeekStart != weekStart {
            pages.append(
                ProgressReviewChartPage(
                    days: padReviewChartPageToFullWeek(
                        currentPageDays: currentPageDays,
                        weekStart: activeWeekStart,
                        calendar: calendar,
                        today: today
                    )
                )
            )
            currentPageDays = [day]
            currentWeekStart = weekStart
            continue
        }

        currentPageDays.append(day)
        currentWeekStart = weekStart
    }

    if let weekStart = currentWeekStart, currentPageDays.isEmpty == false {
        pages.append(
            ProgressReviewChartPage(
                days: padReviewChartPageToFullWeek(
                    currentPageDays: currentPageDays,
                    weekStart: weekStart,
                    calendar: calendar,
                    today: today
                )
            )
        )
    }

    return pages
}

private func padReviewChartPageToFullWeek(
    currentPageDays: [ProgressChartDay],
    weekStart: Date,
    calendar: Calendar,
    today: Date?
) -> [ProgressChartDay] {
    let existingByLocalDate = Dictionary(uniqueKeysWithValues: currentPageDays.map { day in
        (day.localDate, day)
    })

    return (0 ..< progressDaysPerWeek).map { offset in
        guard let rawDate = calendar.date(byAdding: .day, value: offset, to: weekStart) else {
            preconditionFailure("Failed to advance week start by \(offset) days")
        }

        let date = calendar.startOfDay(for: rawDate)
        let localDate = progressLocalDateString(date: date, calendar: calendar)

        if let existing = existingByLocalDate[localDate] {
            return existing
        }

        let isToday: Bool
        if let today {
            isToday = calendar.isDate(date, inSameDayAs: today)
        } else {
            isToday = false
        }

        return ProgressChartDay(
            date: date,
            localDate: localDate,
            reviewCount: 0,
            isToday: isToday
        )
    }
}
