import Foundation
import XCTest
@testable import Flashcards

class ReviewNotificationsTestCase: XCTestCase {
    func makeCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        calendar.locale = Locale(identifier: "en_US_POSIX")
        return calendar
    }

    func makeDate(
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
        minute: Int,
        calendar: Calendar
    ) -> Date? {
        calendar.date(
            from: DateComponents(
                calendar: calendar,
                timeZone: calendar.timeZone,
                year: year,
                month: month,
                day: day,
                hour: hour,
                minute: minute
            )
        )
    }

    func formatDate(date: Date, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.string(from: date)
    }

    func makeTemporaryLocalDatabase() throws -> (database: LocalDatabase, databaseURL: URL) {
        let databaseDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(
            at: databaseDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
        let databaseURL = databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
        return (try LocalDatabase(databaseURL: databaseURL), databaseURL)
    }

    func removeTemporaryDatabase(at databaseURL: URL) throws {
        try FileManager.default.removeItem(at: databaseURL.deletingLastPathComponent())
    }
}

extension PersistedReviewFilter {
    static let allCards = PersistedReviewFilter(
        kind: .allCards,
        deckId: nil,
        effortLevel: nil,
        tag: nil,
        tags: nil
    )
}
