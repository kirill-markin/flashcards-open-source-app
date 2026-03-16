import XCTest
@testable import Flashcards

final class CloudApiErrorSupportTests: XCTestCase {
    func testDecodeCloudApiErrorDetailsUsesDecodedEnvelopeValues() {
        let data = Data(#"{"error":"Cloud failure","requestId":"req-123","code":"SYNC_FAILED"}"#.utf8)

        XCTAssertEqual(
            decodeCloudApiErrorDetails(data: data, requestId: "fallback-request"),
            CloudApiErrorDetails(
                message: "Cloud failure",
                requestId: "req-123",
                code: "SYNC_FAILED"
            )
        )
    }

    func testDecodeCloudApiErrorDetailsFallsBackToRawBodyWhenJsonIsUnknownShape() {
        let data = Data(#"plain text body"#.utf8)

        XCTAssertEqual(
            decodeCloudApiErrorDetails(data: data, requestId: "fallback-request"),
            CloudApiErrorDetails(
                message: "plain text body",
                requestId: "fallback-request",
                code: nil
            )
        )
    }

    func testAppendCloudRequestIdReferenceAddsReferenceWhenPresent() {
        XCTAssertEqual(
            appendCloudRequestIdReference(message: "Cloud sync failed. Try again.", requestId: "req-123"),
            "Cloud sync failed. Try again. Reference: req-123"
        )
    }

    func testAppendCloudRequestIdReferenceLeavesMessageWhenRequestIdMissing() {
        XCTAssertEqual(
            appendCloudRequestIdReference(message: "Cloud sync failed. Try again.", requestId: nil),
            "Cloud sync failed. Try again."
        )
    }
}
