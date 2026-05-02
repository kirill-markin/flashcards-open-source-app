import Foundation
import XCTest
@testable import Flashcards

final class ProgressDateValidationTests: XCTestCase {
    func testProgressDateForStoreRejectsNormalizedLocalDates() throws {
        let calendar = Calendar(identifier: .gregorian)

        XCTAssertThrowsError(try progressDateForStore(localDate: "2026-02-31", calendar: calendar)) { error in
            guard case LocalStoreError.validation(let message) = error else {
                XCTFail("Expected LocalStoreError.validation, received \(error)")
                return
            }

            XCTAssertTrue(message.contains("2026-02-31"))
        }

        XCTAssertThrowsError(try progressDateForStore(localDate: "2026-13-01", calendar: calendar)) { error in
            guard case LocalStoreError.validation(let message) = error else {
                XCTFail("Expected LocalStoreError.validation, received \(error)")
                return
            }

            XCTAssertTrue(message.contains("2026-13-01"))
        }

        XCTAssertThrowsError(try progressDateForStore(localDate: "2025-02-29", calendar: calendar)) { error in
            guard case LocalStoreError.validation(let message) = error else {
                XCTFail("Expected LocalStoreError.validation, received \(error)")
                return
            }

            XCTAssertTrue(message.contains("2025-02-29"))
        }
    }

    func testProgressDateForStoreRejectsMalformedLocalDates() throws {
        let calendar = Calendar(identifier: .gregorian)
        let invalidLocalDates: [String] = [
            "2026-2-03",
            "2026-02-3",
            "2026-+2-03",
            "2026--03",
            "2026-02-03T00:00:00Z",
            "2026-0a-03",
        ]

        for localDate in invalidLocalDates {
            XCTAssertThrowsError(try progressDateForStore(localDate: localDate, calendar: calendar)) { error in
                guard case LocalStoreError.validation(let message) = error else {
                    XCTFail("Expected LocalStoreError.validation, received \(error)")
                    return
                }

                XCTAssertTrue(message.contains(localDate))
            }
        }
    }

    func testProgressDateForStoreAcceptsCanonicalLocalDates() throws {
        let calendar = Calendar(identifier: .gregorian)

        XCTAssertNoThrow(try progressDateForStore(localDate: "2026-02-03", calendar: calendar))
        XCTAssertNoThrow(try progressDateForStore(localDate: "2024-02-29", calendar: calendar))
    }

    func testProgressPresentationRejectsNormalizedLocalDates() throws {
        let calendar = Calendar(identifier: .gregorian)

        XCTAssertThrowsError(
            try makeProgressStreakWeeks(
                chartDays: [],
                rangeStartLocalDate: "2026-02-31",
                todayLocalDate: "2026-02-31",
                calendar: calendar
            )
        ) { error in
            guard case ProgressPresentationError.invalidLocalDate(let localDate) = error else {
                XCTFail("Expected ProgressPresentationError.invalidLocalDate, received \(error)")
                return
            }

            XCTAssertEqual("2026-02-31", localDate)
        }
    }

    func testProgressPresentationRejectsMalformedLocalDates() throws {
        let calendar = Calendar(identifier: .gregorian)
        let invalidLocalDates: [String] = [
            "2026-2-03",
            "2026-02-3",
            "2026-+2-03",
            "2026--03",
            "2026-02-03T00:00:00Z",
            "2026-0a-03",
        ]

        for localDate in invalidLocalDates {
            XCTAssertThrowsError(
                try makeProgressStreakWeeks(
                    chartDays: [],
                    rangeStartLocalDate: localDate,
                    todayLocalDate: localDate,
                    calendar: calendar
                )
            ) { error in
                guard case ProgressPresentationError.invalidLocalDate(let invalidLocalDate) = error else {
                    XCTFail("Expected ProgressPresentationError.invalidLocalDate, received \(error)")
                    return
                }

                XCTAssertEqual(localDate, invalidLocalDate)
            }
        }
    }
}
