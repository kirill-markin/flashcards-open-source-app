import Foundation
import XCTest
@testable import Flashcards

final class AIChatBootstrapErrorPresentationTests: XCTestCase {
    func testTransportFailureShowsFriendlyMessageAndTechnicalDetails() {
        let error = URLError(.networkConnectionLost)

        let presentation = makeAIChatBootstrapErrorPresentation(error: error)

        XCTAssertEqual(
            presentation.message,
            "The connection was interrupted while loading AI chat. Check your connection and try again."
        )
        XCTAssertEqual(
            presentation.technicalDetails,
            """
            Type: URLError
            Code: networkConnectionLost (-1005)
            """
        )
        XCTAssertTrue(aiChatBootstrapShouldRetry(error: error))
    }

    func testPermanentURLErrorUsesGenericMessageAndSafeTechnicalDetails() {
        let error = URLError(.unsupportedURL)

        let presentation = makeAIChatBootstrapErrorPresentation(error: error)

        XCTAssertEqual(presentation.message, "Failed to load AI chat.")
        XCTAssertEqual(
            presentation.technicalDetails,
            """
            Type: URLError
            Code: unsupportedURL (-1002)
            """
        )
        XCTAssertFalse(aiChatBootstrapShouldRetry(error: error))
    }

    func testNonRetryableTransportFailureCanStillShowNetworkMessageWithSafeDetails() {
        let error = URLError(.secureConnectionFailed)

        let presentation = makeAIChatBootstrapErrorPresentation(error: error)

        XCTAssertEqual(
            presentation.message,
            "The connection was interrupted while loading AI chat. Check your connection and try again."
        )
        XCTAssertEqual(
            presentation.technicalDetails,
            """
            Type: URLError
            Code: secureConnectionFailed (-1200)
            """
        )
        XCTAssertFalse(aiChatBootstrapShouldRetry(error: error))
    }

    func testTransportFailureDoesNotExposeNSErrorUserInfo() throws {
        let error = NSError(
            domain: NSURLErrorDomain,
            code: URLError.Code.networkConnectionLost.rawValue,
            userInfo: [
                NSLocalizedDescriptionKey: "raw provider auth token",
                NSURLErrorFailingURLErrorKey: try XCTUnwrap(
                    URL(string: "https://secret.example.test/chat?token=provider-token")
                )
            ]
        )

        let presentation = makeAIChatBootstrapErrorPresentation(error: error)
        let technicalDetails = try XCTUnwrap(presentation.technicalDetails)

        XCTAssertEqual(
            presentation.message,
            "The connection was interrupted while loading AI chat. Check your connection and try again."
        )
        XCTAssertTrue(technicalDetails.contains("Type: URLError"))
        XCTAssertTrue(technicalDetails.contains("Code: networkConnectionLost (-1005)"))
        XCTAssertFalse(technicalDetails.contains("raw provider auth token"))
        XCTAssertFalse(technicalDetails.contains("secret.example.test"))
        XCTAssertFalse(technicalDetails.contains("provider-token"))
    }

    func testBlockedLocalValidationUsesAccountStatusMessageAndReasonDetails() throws {
        let presentation = makeAIChatBootstrapErrorPresentation(
            error: LocalStoreError.validation("Sync is blocked until account status is resolved."),
            showsLocalValidationMessage: true
        )
        let technicalDetails = try XCTUnwrap(presentation.technicalDetails)

        XCTAssertEqual(
            presentation.message,
            "AI chat needs your cloud account status to be resolved before it can load."
        )
        XCTAssertFalse(presentation.message.contains("Sync is blocked"))
        XCTAssertTrue(technicalDetails.contains("Type: LocalStoreError"))
        XCTAssertTrue(technicalDetails.contains("Reason: Sync is blocked until account status is resolved."))
    }

    func testGenericUnknownErrorUsesTypeOnlyDetails() throws {
        let error = BootstrapSecretError()

        let presentation = makeAIChatBootstrapErrorPresentation(error: error)
        let technicalDetails = try XCTUnwrap(presentation.technicalDetails)

        XCTAssertEqual(presentation.message, "Failed to load AI chat.")
        XCTAssertTrue(technicalDetails.contains("Type: BootstrapSecretError"))
        XCTAssertFalse(technicalDetails.contains("raw backend body"))
        XCTAssertFalse(technicalDetails.contains("cloud-auth-secret"))
    }

    func testDiagnosticServiceErrorDoesNotExposeRawMultilineDetailsInMessage() throws {
        let error = AIChatServiceError.invalidPayload(
            "AI chat bootstrap payload is invalid.",
            makeDiagnostics(
                clientRequestId: "client-request-1",
                backendRequestId: "backend-request-1",
                stage: .decodingEventJSON,
                statusCode: 200,
                decoderSummary: "Expected key messages.",
                rawSnippet: "{\"unexpected\":true}"
            )
        )

        let presentation = makeAIChatBootstrapErrorPresentation(error: error)
        let technicalDetails = try XCTUnwrap(presentation.technicalDetails)

        XCTAssertEqual(presentation.message, "Failed to load AI chat.")
        XCTAssertFalse(presentation.message.contains("\n"))
        XCTAssertFalse(presentation.message.contains("Debug:"))
        XCTAssertFalse(presentation.message.contains("Stage:"))
        XCTAssertTrue(technicalDetails.contains("Reference: backend-request-1"))
        XCTAssertTrue(technicalDetails.contains("Status: 200"))
        XCTAssertTrue(technicalDetails.contains("Stage: decoding_event_json"))
        XCTAssertTrue(technicalDetails.contains("Details: Expected key messages."))
        XCTAssertFalse(technicalDetails.contains("Payload:"))
        XCTAssertFalse(technicalDetails.contains("{\"unexpected\":true}"))
    }

    func testKnownBackendAvailabilityCodeKeepsMappedMessageAndRetriesByStatus() throws {
        let error = AIChatServiceError.invalidResponse(
            CloudApiErrorDetails(
                message: "provider auth failed",
                requestId: "request-available-1",
                code: "LOCAL_CHAT_UNAVAILABLE",
                syncConflict: nil
            ),
            "AI chat request failed with status 503: AI is temporarily unavailable on the official server. Try again later. Reference: request-available-1",
            makeDiagnostics(
                clientRequestId: "client-request-2",
                backendRequestId: "request-available-1",
                stage: .responseNotOk,
                statusCode: 503,
                decoderSummary: nil,
                rawSnippet: "{\"code\":\"LOCAL_CHAT_UNAVAILABLE\"}"
            )
        )

        let presentation = makeAIChatBootstrapErrorPresentation(error: error)
        let technicalDetails = try XCTUnwrap(presentation.technicalDetails)

        XCTAssertEqual(
            presentation.message,
            "AI is temporarily unavailable on the official server. Try again later."
        )
        XCTAssertFalse(presentation.message.contains("Status:"))
        XCTAssertFalse(presentation.message.contains("Reference:"))
        XCTAssertTrue(technicalDetails.contains("Reference: request-available-1"))
        XCTAssertTrue(technicalDetails.contains("Status: 503"))
        XCTAssertTrue(technicalDetails.contains("Code: LOCAL_CHAT_UNAVAILABLE"))
        XCTAssertTrue(technicalDetails.contains("Stage: response_not_ok"))
        XCTAssertFalse(technicalDetails.contains("provider auth failed"))
        XCTAssertFalse(technicalDetails.contains("Payload:"))
        XCTAssertFalse(technicalDetails.contains("{\"code\":\"LOCAL_CHAT_UNAVAILABLE\"}"))
        XCTAssertTrue(aiChatBootstrapShouldRetry(error: error))
    }

    func testUnknownServerBootstrapErrorCanRetry() {
        let error = AIChatServiceError.invalidResponse(
            CloudApiErrorDetails(
                message: "temporary backend failure",
                requestId: "request-unknown-1",
                code: "UNEXPECTED_BACKEND_FAILURE",
                syncConflict: nil
            ),
            "AI chat request failed with status 503: temporary backend failure Reference: request-unknown-1",
            makeDiagnostics(
                clientRequestId: "client-request-3",
                backendRequestId: "request-unknown-1",
                stage: .responseNotOk,
                statusCode: 503,
                decoderSummary: nil,
                rawSnippet: "{\"code\":\"UNEXPECTED_BACKEND_FAILURE\"}"
            )
        )

        XCTAssertTrue(aiChatBootstrapShouldRetry(error: error))
    }

    func testKnownBackendAvailabilityCodeWithPermanentHTTPStatusDoesNotRetry() {
        let error = AIChatServiceError.invalidResponse(
            CloudApiErrorDetails(
                message: "provider auth failed",
                requestId: "request-available-2",
                code: "LOCAL_CHAT_UNAVAILABLE",
                syncConflict: nil
            ),
            "AI chat request failed with status 400: AI is temporarily unavailable on the official server. Try again later. Reference: request-available-2",
            makeDiagnostics(
                clientRequestId: "client-request-4",
                backendRequestId: "request-available-2",
                stage: .responseNotOk,
                statusCode: 400,
                decoderSummary: nil,
                rawSnippet: "{\"code\":\"LOCAL_CHAT_UNAVAILABLE\"}"
            )
        )

        XCTAssertFalse(aiChatBootstrapShouldRetry(error: error))
    }
}

private struct BootstrapSecretError: Error, CustomStringConvertible {
    let description: String = "raw backend body with cloud-auth-secret"
}

private func makeDiagnostics(
    clientRequestId: String,
    backendRequestId: String?,
    stage: AIChatFailureStage,
    statusCode: Int?,
    decoderSummary: String?,
    rawSnippet: String?
) -> AIChatFailureDiagnostics {
    AIChatFailureDiagnostics(
        clientRequestId: clientRequestId,
        backendRequestId: backendRequestId,
        stage: stage,
        errorKind: .invalidHttpResponse,
        statusCode: statusCode,
        eventType: nil,
        toolName: nil,
        toolCallId: nil,
        lineNumber: nil,
        rawSnippet: rawSnippet,
        decoderSummary: decoderSummary,
        continuationAttempt: nil,
        continuationToolCallIds: []
    )
}
