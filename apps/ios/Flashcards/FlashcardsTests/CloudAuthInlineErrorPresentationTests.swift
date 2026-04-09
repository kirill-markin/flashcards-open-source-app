import Foundation
import XCTest
@testable import Flashcards

final class CloudAuthInlineErrorPresentationTests: XCTestCase {
    func testTransportFailureDuringSendCodeShowsFriendlyMessageAndTechnicalDetails() {
        let error = URLError(.networkConnectionLost)

        let presentation = makeCloudAuthInlineErrorPresentation(
            error: error,
            context: .sendCode
        )

        XCTAssertEqual(
            presentation.message,
            "The connection was interrupted while sending the code. Check your email, then try again if needed."
        )
        XCTAssertEqual(presentation.technicalDetails, String(describing: error as Error))
    }

    func testWrappedTransportFailureDuringVerifyCodeStillUsesFriendlyMessage() {
        let transportError = URLError(.timedOut)
        let error = NSError(
            domain: "Flashcards.Tests",
            code: 42,
            userInfo: [NSUnderlyingErrorKey: transportError]
        )

        let presentation = makeCloudAuthInlineErrorPresentation(
            error: error,
            context: .verifyCode
        )

        XCTAssertEqual(
            presentation.message,
            "The connection was interrupted while verifying the code. Try again, or request a new code if needed."
        )
        XCTAssertEqual(presentation.technicalDetails, String(describing: error as Error))
    }

    func testServerAuthErrorsKeepExistingFriendlyMessageWithoutTechnicalDetails() {
        let error = CloudAuthError.invalidResponse(
            CloudApiErrorDetails(
                message: "upstream failure",
                requestId: "req-123",
                code: "OTP_SEND_FAILED"
            ),
            500
        )

        let presentation = makeCloudAuthInlineErrorPresentation(
            error: error,
            context: .sendCode
        )

        XCTAssertEqual(
            presentation.message,
            "Could not send a code. Try again. Reference: req-123"
        )
        XCTAssertNil(presentation.technicalDetails)
    }
}
