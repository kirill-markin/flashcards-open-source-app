import Foundation

func formatIsoTimestamp(date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

func parseIsoTimestamp(value: String) -> Date? {
    let formatterWithFractionalSeconds = ISO8601DateFormatter()
    formatterWithFractionalSeconds.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatterWithFractionalSeconds.date(from: value) {
        return date
    }

    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

func nowIsoTimestamp() -> String {
    formatIsoTimestamp(date: Date())
}

func dateByAddingMinutes(date: Date, minutes: Int) -> Date {
    Date(timeInterval: TimeInterval(minutes * 60), since: date)
}

func dateByAddingDays(date: Date, days: Int) -> Date {
    Date(timeInterval: TimeInterval(days * 86_400), since: date)
}

func formatOptionalIsoTimestampForDisplay(value: String?) -> String {
    guard let value else {
        return "new"
    }

    guard let date = parseIsoTimestamp(value: value) else {
        return value
    }

    return date.formatted(date: .abbreviated, time: .shortened)
}
