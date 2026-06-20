import Foundation
import XCTest
@testable import Flashcards

final class CloudAuthInlineErrorPresentationTests: XCTestCase {
    func testRetryableTransportFailureDuringSendCodeShowsFriendlyMessageWithoutTechnicalDetails() {
        let error = URLError(.networkConnectionLost)

        let presentation = makeCloudAuthInlineErrorPresentation(
            error: error,
            context: .sendCode
        )

        XCTAssertEqual(
            presentation.message,
            "The connection was interrupted while sending the code. Check your email, then try again if needed."
        )
        XCTAssertNil(presentation.technicalError)
    }

    func testWrappedRetryableTransportFailureDuringVerifyCodeStillUsesFriendlyMessageWithoutTechnicalDetails() {
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
        XCTAssertNil(presentation.technicalError)
    }

    func testUserActionableServerAuthErrorsKeepExistingFriendlyMessageWithoutTechnicalError() {
        let error = CloudAuthError.invalidResponse(
            CloudApiErrorDetails(
                message: "invalid code",
                requestId: "req-123",
                code: "OTP_CODE_INVALID",
                syncConflict: nil
            ),
            400
        )

        let presentation = makeCloudAuthInlineErrorPresentation(
            error: error,
            context: .verifyCode
        )

        XCTAssertEqual(
            presentation.message,
            "Invalid code. Try again."
        )
        XCTAssertNil(presentation.technicalError)
    }

    func testTooManyOtpAttemptsStayInlineWithoutTechnicalError() {
        let error = CloudAuthError.invalidResponse(
            CloudApiErrorDetails(
                message: "too many attempts",
                requestId: "req-123",
                code: "OTP_TOO_MANY_ATTEMPTS",
                syncConflict: nil
            ),
            429
        )

        let presentation = makeCloudAuthInlineErrorPresentation(
            error: error,
            context: .verifyCode
        )

        XCTAssertEqual(
            presentation.message,
            "Too many attempts. Request a new code."
        )
        XCTAssertNil(presentation.technicalError)
    }

    func testTechnicalServerAuthErrorsUseSafeMessageAndTechnicalErrorAction() {
        let error = CloudAuthError.invalidResponse(
            CloudApiErrorDetails(
                message: "upstream failure",
                requestId: "req-123",
                code: "OTP_SEND_FAILED",
                syncConflict: nil
            ),
            500
        )

        let presentation = makeCloudAuthInlineErrorPresentation(
            error: error,
            context: .sendCode
        )

        XCTAssertEqual(
            presentation.message,
            "Could not send a code. Try again."
        )
        XCTAssertEqual(presentation.technicalError?.capturePolicy, .captureOnPresentation)
        XCTAssertNotNil(presentation.technicalError)
    }

    func testAuthSetupFailuresUseSafeMessageAndCaptureOnPresentation() {
        let error = LocalStoreError.validation("Cloud service configuration is unavailable")

        let presentation = makeCloudAuthInlineErrorPresentation(
            error: error,
            context: .sendCode
        )

        XCTAssertEqual(
            presentation.message,
            "Could not send a code. Try again."
        )
        XCTAssertEqual(presentation.technicalError?.capturePolicy, .captureOnPresentation)
        XCTAssertNotNil(presentation.technicalError)
    }

    @MainActor
    func testAlreadyObservedTechnicalActionCarriesActionLocalOwnership() {
        let store = FlashcardsStore()
        let error = LocalStoreError.validation("Cloud service configuration is unavailable")
        let captureContext = store.beginTechnicalErrorCaptureContext()

        store.markTechnicalErrorCaptured(captureContext: captureContext)
        let action = store.makeTechnicalErrorAction(
            error: error,
            captureContext: captureContext
        )

        XCTAssertEqual(action.capturePolicy, .alreadyCaptured)
        XCTAssertTrue(action.error is LocalStoreError)
        XCTAssertTrue(technicalErrorDetails(error: action.error).contains("Cloud service configuration is unavailable"))
    }

    @MainActor
    func testIndependentTechnicalErrorWithSameDetailsStillCapturesOnPresentation() {
        let store = FlashcardsStore()
        let error = LocalStoreError.validation("Cloud service configuration is unavailable")
        let captureContext = store.beginTechnicalErrorCaptureContext()
        let action = store.makeTechnicalErrorAction(
            error: error,
            captureContext: captureContext
        )

        XCTAssertEqual(action.capturePolicy, .captureOnPresentation)
        XCTAssertTrue(action.error is LocalStoreError)
    }

    func testTechnicalErrorDetailsIncludeCloudAuthDiagnostics() {
        let error = CloudAuthError.invalidResponse(
            CloudApiErrorDetails(
                message: "upstream failure",
                requestId: "req-123",
                code: "OTP_SEND_FAILED",
                syncConflict: nil
            ),
            500
        )

        let details = technicalErrorDetails(error: error)

        XCTAssertTrue(details.contains("Type: CloudAuthError.invalidResponse"))
        XCTAssertTrue(details.contains("Status: 500"))
        XCTAssertTrue(details.contains("Code: OTP_SEND_FAILED"))
        XCTAssertTrue(details.contains("Request ID: req-123"))
        XCTAssertTrue(details.contains("Message: upstream failure"))
    }

    func testPostAuthBootstrapEligibilityFailureKeepsSafeVisibleMessage() {
        let message = makeCloudPostAuthVisibleFailureMessage(
            error: CloudBootstrapEligibilityError.remoteWorkspaceIsNotEmpty
        )

        XCTAssertEqual(
            message,
            "Choose a new or empty workspace on this server before uploading the current local data."
        )
        XCTAssertTrue(
            isSafeCloudPostAuthDomainFailure(
                error: CloudBootstrapEligibilityError.remoteWorkspaceIsNotEmpty
            )
        )
    }

    func testPostAuthCredentialRecoveryGuidanceFailureKeepsSafeVisibleMessage() {
        let expectedMessage = localizedCloudCredentialRecoveryWrongLinkedAccountMessage()
        let error = LocalStoreError.validation(expectedMessage)

        let message = makeCloudPostAuthVisibleFailureMessage(error: error)

        XCTAssertEqual(message, expectedMessage)
        XCTAssertTrue(isSafeCloudPostAuthDomainFailure(error: error))
    }

    func testPostAuthCredentialRecoveryWorkspaceGuidanceFailureKeepsSafeVisibleMessage() {
        let expectedMessage = localizedCloudCredentialRecoveryUpgradeWorkspaceMessage(
            workspaceName: "Recovered Workspace"
        )
        let error = LocalStoreError.validation(expectedMessage)

        let message = makeCloudPostAuthVisibleFailureMessage(error: error)

        XCTAssertEqual(message, expectedMessage)
        XCTAssertTrue(isSafeCloudPostAuthDomainFailure(error: error))
    }

    func testPostAuthTechnicalFailureUsesGenericVisibleMessage() {
        let error = CloudSyncError.invalidResponse(
            CloudApiErrorDetails(
                message: "backend raw message",
                requestId: "req-raw",
                code: "SYNC_FAILED",
                syncConflict: nil
            ),
            500
        )

        let message = makeCloudPostAuthVisibleFailureMessage(error: error)

        XCTAssertEqual(
            message,
            "Your sign-in succeeded, but the cloud workspace setup or initial sync did not finish."
        )
        XCTAssertFalse(message.contains("backend raw message"))
        XCTAssertFalse(message.contains("req-raw"))
        XCTAssertFalse(isSafeCloudPostAuthDomainFailure(error: error))
    }

    func testPostAuthGenericValidationFailureStaysTechnical() {
        let error = LocalStoreError.validation("Cloud service configuration is unavailable")

        let message = makeCloudPostAuthVisibleFailureMessage(error: error)

        XCTAssertEqual(
            message,
            "Your sign-in succeeded, but the cloud workspace setup or initial sync did not finish."
        )
        XCTAssertFalse(isSafeCloudPostAuthDomainFailure(error: error))
    }

    @MainActor
    func testPostAuthCloudSyncFailureStatusDoesNotExposeRawDiagnostics() {
        let store = FlashcardsStore()
        let error = CloudSyncError.invalidResponse(
            CloudApiErrorDetails(
                message: "backend raw message",
                requestId: "req-raw",
                code: "SYNC_FAILED",
                syncConflict: nil
            ),
            500
        )

        let status = store.transitionSyncStatusForCloudFailure(
            error: error,
            trigger: store.postAuthCloudSyncTrigger(now: Date(timeIntervalSince1970: 0))
        )

        XCTAssertEqual(status, .idle)
    }

    @MainActor
    func testPostAuthBlockedCloudSyncFailureStatusDoesNotExposeRawDiagnostics() {
        let store = FlashcardsStore()
        let error = CloudSyncError.invalidResponse(
            CloudApiErrorDetails(
                message: "backend raw conflict details",
                requestId: "req-conflict",
                code: "SYNC_WORKSPACE_FORK_REQUIRED",
                syncConflict: nil
            ),
            409
        )

        let status = store.transitionSyncStatusForCloudFailure(
            error: error,
            trigger: store.postAuthCloudSyncTrigger(now: Date(timeIntervalSince1970: 0))
        )

        XCTAssertEqual(status, .idle)
    }

    func testCloudApiErrorDetailsDecodePublicSyncConflictWithoutPrivateWorkspaceId() throws {
        let data = try XCTUnwrap(
            """
            {
              "error": "Sync detected content copied from another workspace. Retry after forking ids.",
              "requestId": "request-fork",
              "code": "SYNC_WORKSPACE_FORK_REQUIRED",
              "details": {
                "syncConflict": {
                  "phase": "push",
                  "entityType": "card",
                  "entityId": "card-conflict",
                  "entryIndex": 2,
                  "recoverable": true
                }
              }
            }
            """.data(using: .utf8)
        )

        let details = decodeCloudApiErrorDetails(data: data, requestId: nil)

        XCTAssertEqual("SYNC_WORKSPACE_FORK_REQUIRED", details.code)
        XCTAssertEqual("request-fork", details.requestId)
        XCTAssertEqual(.card, details.syncConflict?.entityType)
        XCTAssertEqual("card-conflict", details.syncConflict?.entityId)
        XCTAssertEqual(2, details.syncConflict?.entryIndex)
        XCTAssertEqual(true, details.syncConflict?.recoverable)
    }
}
