import Foundation

/// The calendar the app writes snapshot local dates in (`makeProgressStoreCalendar(timeZone: .current)`).
private func makeWidgetLocalCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = .current
    return calendar
}

/// The `yyyy-MM-dd` local date of `date`, in the format of `todayLocalDate` and `upcomingDueDays`.
func widgetLocalDateString(date: Date) -> String {
    let formatter = DateFormatter()
    formatter.calendar = makeWidgetLocalCalendar()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

/// False once the entry date has moved past the day the app wrote `progress` on.
func isWidgetProgressForDay(progress: WidgetSnapshotProgress, date: Date) -> Bool {
    progress.todayLocalDate == widgetLocalDateString(date: date)
}

/// The first moment of the local day after `date`, when day-based widget content changes.
func widgetNextLocalDayStart(after date: Date) -> Date {
    let calendar = makeWidgetLocalCalendar()
    guard let nextDayStart = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: date)) else {
        preconditionFailure("Widget next local day start could not be calculated for \(date).")
    }
    return nextDayStart
}
