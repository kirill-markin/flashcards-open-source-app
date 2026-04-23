import Foundation

struct ProgressRequestRange: Hashable, Sendable {
    let timeZone: String
    let from: String
    let to: String
}

private struct ProgressLocalDateParts: Equatable, Sendable {
    let year: Int
    let month: Int
    let day: Int
}

private let progressAsciiZero: UInt8 = 48
private let progressAsciiNine: UInt8 = 57
private let progressAsciiHyphen: UInt8 = 45

let recentProgressHistoryDayCount: Int = 140

func makeProgressRequestRange(
    now: Date,
    timeZone: TimeZone,
    dayCount: Int
) throws -> ProgressRequestRange {
    guard dayCount > 0 else {
        throw LocalStoreError.validation("Progress date range must include at least one day")
    }

    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    let endDate = calendar.startOfDay(for: now)
    guard let startDate = calendar.date(byAdding: .day, value: -(dayCount - 1), to: endDate) else {
        throw LocalStoreError.validation("Progress date range could not be calculated")
    }

    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"

    let timeZoneIdentifier = timeZone.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    if timeZoneIdentifier.isEmpty {
        throw LocalStoreError.validation("Current timezone identifier is unavailable")
    }

    return ProgressRequestRange(
        timeZone: timeZoneIdentifier,
        from: formatter.string(from: startDate),
        to: formatter.string(from: endDate)
    )
}

func progressRequestRange(scopeKey: ProgressScopeKey) -> ProgressRequestRange {
    ProgressRequestRange(
        timeZone: scopeKey.timeZone,
        from: scopeKey.from,
        to: scopeKey.to
    )
}

func makeProgressStoreCalendar(timeZone: TimeZone) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = timeZone
    return calendar
}

func progressTimeZone(identifier: String) throws -> TimeZone {
    guard let timeZone = TimeZone(identifier: identifier) else {
        throw LocalStoreError.validation("Progress timezone identifier is invalid: \(identifier)")
    }

    return timeZone
}

func makeZeroFilledProgressDays(requestRange: ProgressRequestRange) throws -> [ProgressDay] {
    let timeZone = try progressTimeZone(identifier: requestRange.timeZone)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    let startDate = try progressDateForStore(localDate: requestRange.from, calendar: calendar)
    let endDate = try progressDateForStore(localDate: requestRange.to, calendar: calendar)

    var progressDays: [ProgressDay] = []
    var currentDate = startDate
    while currentDate <= endDate {
        progressDays.append(
            ProgressDay(
                date: progressLocalDateStringForStore(date: currentDate, calendar: calendar),
                reviewCount: 0
            )
        )

        guard let nextDate = calendar.date(byAdding: .day, value: 1, to: currentDate) else {
            throw LocalStoreError.validation("Progress date range could not be advanced")
        }

        currentDate = nextDate
    }

    return progressDays
}

func progressShiftLocalDateForStore(value: String, offsetDays: Int) throws -> String {
    guard let utcTimeZone = TimeZone(secondsFromGMT: 0) else {
        throw LocalStoreError.validation("Progress UTC timezone is unavailable")
    }

    let calendar = makeProgressStoreCalendar(timeZone: utcTimeZone)
    let parsedDate = try progressDateForStore(localDate: value, calendar: calendar)
    guard let shiftedDate = calendar.date(byAdding: .day, value: offsetDays, to: parsedDate) else {
        throw LocalStoreError.validation("Progress local date could not be shifted: \(value)")
    }

    return progressLocalDateStringForStore(date: shiftedDate, calendar: calendar)
}

func progressReferenceDate(
    localDate: String,
    timeZoneIdentifier: String
) throws -> Date {
    let timeZone = try progressTimeZone(identifier: timeZoneIdentifier)
    let calendar = makeProgressStoreCalendar(timeZone: timeZone)
    return try progressDateForStore(localDate: localDate, calendar: calendar)
}

func progressLocalDateStringForStore(date: Date, calendar: Calendar) -> String {
    let components = calendar.dateComponents([.year, .month, .day], from: date)
    guard
        let year = components.year,
        let month = components.month,
        let day = components.day
    else {
        preconditionFailure("Progress local date components are unavailable")
    }

    return String(format: "%04d-%02d-%02d", year, month, day)
}

func progressDateForStore(localDate: String, calendar: Calendar) throws -> Date {
    guard let date = progressStrictDate(localDate: localDate, calendar: calendar) else {
        throw LocalStoreError.validation("Progress local date is invalid: \(localDate)")
    }

    return date
}

func progressStrictDate(localDate: String, calendar: Calendar) -> Date? {
    guard let parts = progressLocalDateParts(localDate: localDate) else {
        return nil
    }

    return progressStrictDate(parts: parts, calendar: calendar)
}

private func progressLocalDateParts(localDate: String) -> ProgressLocalDateParts? {
    let utf8Bytes: [UInt8] = Array(localDate.utf8)

    guard
        progressLocalDateHasCanonicalShape(utf8Bytes: utf8Bytes),
        let year = progressLocalDateComponentValue(utf8Bytes: utf8Bytes[0 ..< 4]),
        let month = progressLocalDateComponentValue(utf8Bytes: utf8Bytes[5 ..< 7]),
        let day = progressLocalDateComponentValue(utf8Bytes: utf8Bytes[8 ..< 10])
    else {
        return nil
    }

    return ProgressLocalDateParts(year: year, month: month, day: day)
}

private func progressLocalDateHasCanonicalShape(utf8Bytes: [UInt8]) -> Bool {
    guard
        utf8Bytes.count == 10,
        utf8Bytes[4] == progressAsciiHyphen,
        utf8Bytes[7] == progressAsciiHyphen
    else {
        return false
    }

    return true
}

private func progressLocalDateComponentValue(utf8Bytes: ArraySlice<UInt8>) -> Int? {
    var value: Int = 0
    for byte in utf8Bytes {
        guard byte >= progressAsciiZero && byte <= progressAsciiNine else {
            return nil
        }

        value = (value * 10) + Int(byte - progressAsciiZero)
    }

    return value
}

private func progressStrictDate(parts: ProgressLocalDateParts, calendar: Calendar) -> Date? {
    guard let date = calendar.date(
        from: DateComponents(
            calendar: calendar,
            timeZone: calendar.timeZone,
            year: parts.year,
            month: parts.month,
            day: parts.day
        )
    ) else {
        return nil
    }

    let normalizedParts = calendar.dateComponents([.year, .month, .day], from: date)
    guard
        normalizedParts.year == parts.year,
        normalizedParts.month == parts.month,
        normalizedParts.day == parts.day
    else {
        return nil
    }

    return calendar.startOfDay(for: date)
}
