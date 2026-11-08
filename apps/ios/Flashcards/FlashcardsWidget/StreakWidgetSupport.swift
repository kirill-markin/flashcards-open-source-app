import OSLog
import SwiftUI

/// Drawing and date pieces shared by the Streaks and Month calendar widgets.

/// The Progress tab's frozen-day blue.
let streakWidgetFrozenColor: Color = Color(red: 0x2A / 255, green: 0x7F / 255, blue: 0xC2 / 255)

/// Snapshot local dates are Gregorian `yyyy-MM-dd` days (`makeProgressStoreCalendar`).
/// Day arithmetic runs in GMT, clear of DST shifts.
private func makeStreakWidgetDayCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = .gmt
    return calendar
}

/// Display only: the Progress presentation calendar, Gregorian in the user's locale, over the GMT days.
private func makeStreakWidgetDisplayCalendar(firstWeekday: Int) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale.autoupdatingCurrent
    calendar.timeZone = .gmt
    calendar.firstWeekday = firstWeekday
    return calendar
}

/// Progress the Streaks and Month calendar widgets may draw: written on the entry's local day, well formed.
struct StreakWidgetProgress {
    let progress: WidgetSnapshotProgress
    /// Gregorian POSIX GMT calendar of `today` and `dayDates`.
    let dayCalendar: Calendar
    /// Gregorian calendar in the user's locale starting at `progress.firstWeekday`, for names and symbols.
    let displayCalendar: Calendar
    let today: Date
    /// `progress.days` dates, strictly ascending and ending at `today`.
    let dayDates: [Date]

    var dateFormatStyle: Date.FormatStyle {
        Date.FormatStyle(
            date: nil,
            time: nil,
            locale: Locale.autoupdatingCurrent,
            calendar: self.displayCalendar,
            timeZone: self.displayCalendar.timeZone,
            capitalizationContext: .standalone
        )
    }
}

/// Nil, the open-the-app state, without progress, for progress written on an earlier day, or for malformed progress.
func makeStreakWidgetProgress(progress: WidgetSnapshotProgress?, entryDate: Date) -> StreakWidgetProgress? {
    guard let progress, isWidgetProgressForDay(progress: progress, date: entryDate) else {
        return nil
    }
    let dayCalendar = makeStreakWidgetDayCalendar()
    let formatter = DateFormatter()
    formatter.calendar = dayCalendar
    formatter.locale = dayCalendar.locale
    formatter.timeZone = dayCalendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false

    func parse(localDate: String) -> Date? {
        guard let date = formatter.date(from: localDate), formatter.string(from: date) == localDate else {
            return nil
        }
        return date
    }

    let parsedDayDates = progress.days.compactMap { day in parse(localDate: day.localDate) }
    guard
        (1...7).contains(progress.firstWeekday),
        progress.currentStreakDays >= 0,
        let today = parse(localDate: progress.todayLocalDate),
        parsedDayDates.count == progress.days.count,
        parsedDayDates.last == today,
        zip(parsedDayDates, parsedDayDates.dropFirst()).allSatisfy({ earlier, later in earlier < later })
    else {
        reviewWidgetLogger.error(
            "event=streak_widget_progress_invalid todayLocalDate=\(progress.todayLocalDate, privacy: .public) firstWeekday=\(progress.firstWeekday, privacy: .public) currentStreakDays=\(progress.currentStreakDays, privacy: .public) dayCount=\(progress.days.count, privacy: .public) firstLocalDate=\(String(describing: progress.days.first?.localDate), privacy: .public) lastLocalDate=\(String(describing: progress.days.last?.localDate), privacy: .public)"
        )
        return nil
    }
    return StreakWidgetProgress(
        progress: progress,
        dayCalendar: dayCalendar,
        displayCalendar: makeStreakWidgetDisplayCalendar(firstWeekday: progress.firstWeekday),
        today: today,
        dayDates: parsedDayDates
    )
}

/// A streak is a run of consecutive reviewed or frozen days.
func isStreakWidgetStreakDay(state: WidgetSnapshotStreakDayState) -> Bool {
    switch state {
    case .reviewed, .frozen:
        return true
    case .missed, .pending:
        return false
    }
}
