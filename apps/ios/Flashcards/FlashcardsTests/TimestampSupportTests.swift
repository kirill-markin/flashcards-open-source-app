import XCTest
@testable import Flashcards

final class TimestampSupportTests: XCTestCase {
    func testParseIsoTimestampSupportsFractionalSeconds() {
        XCTAssertNotNil(parseIsoTimestamp(value: "2026-03-09T10:11:12.345Z"))
    }

    func testParseIsoTimestampSupportsWholeSeconds() {
        XCTAssertNotNil(parseIsoTimestamp(value: "2026-03-09T10:11:12Z"))
    }

    func testFormatIsoTimestampRoundTripsThroughParser() throws {
        let date = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-09T10:11:12.345Z"))

        XCTAssertEqual(formatIsoTimestamp(date: date), "2026-03-09T10:11:12.345Z")
        XCTAssertEqual(parseIsoTimestamp(value: formatIsoTimestamp(date: date)), date)
    }

    func testFormatOptionalIsoTimestampForDisplayHandlesNil() {
        XCTAssertEqual(formatOptionalIsoTimestampForDisplay(value: nil), "new")
    }

    func testFormatOptionalIsoTimestampForDisplayFormatsValidIsoTimestamp() {
        XCTAssertNotEqual(
            formatOptionalIsoTimestampForDisplay(value: "2026-03-09T10:11:12.345Z"),
            "2026-03-09T10:11:12.345Z"
        )
    }

    func testFormatOptionalIsoTimestampForDisplayReturnsRawInvalidValue() {
        XCTAssertEqual(formatOptionalIsoTimestampForDisplay(value: "not-an-iso-date"), "not-an-iso-date")
    }
}
