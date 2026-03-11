import Foundation
import XCTest
@testable import Flashcards

final class AIChatServiceStreamingTests: AIChatTestCaseBase {
    func testAIChatServiceFormatsApiErrorsWithRequestId() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/chat/local-turn")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 403,
                httpVersion: nil,
                headerFields: [
                    "Content-Type": "application/json",
                    "X-Request-Id": "request-123"
                ]
            )!
            let data = """
            {"error":"Authentication failed. Sign in again.","requestId":"request-123","code":"AUTH_UNAUTHORIZED"}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = AIChatService(
            session: self.makeSession(),
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        do {
            _ = try await service.streamTurn(
                session: CloudLinkedSession(
                    userId: "user-1",
                    workspaceId: "workspace-1",
                    email: "user@example.com",
                    apiBaseUrl: "https://api.example.com",
                    bearerToken: "test-token"
                ),
                request: AILocalChatRequestBody(
                    messages: [AILocalChatWireMessage(
                        role: "user",
                        content: "hello",
                        toolCalls: nil,
                        toolCallId: nil,
                        name: nil,
                        output: nil
                    )],
                    model: aiChatDefaultModelId,
                    timezone: "Europe/Madrid"
                ),
                onDelta: { _ in },
                onToolCall: { _ in },
                onToolCallRequest: { _ in },
                onRepairAttempt: { _ in }
            )
            XCTFail("Expected invalid response error")
        } catch let error as AIChatServiceError {
            XCTAssertEqual(
                error.errorDescription,
                """
                AI chat request failed with status 403: Authentication failed. Sign in again. Reference: request-123
                Request: request-123
                Stage: response_not_ok
                """
            )
        }
    }

    func testAIChatServiceReadsSequentialSSEEventsWithoutFramingFailure() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/chat/local-turn")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: [
                    "Content-Type": "text/event-stream",
                    "X-Chat-Request-Id": "request-stream-1"
                ]
            )!
            let data = """
            data: {"type":"delta","text":"Hi"}

            data: {"type":"delta","text":"!"}

            data: {"type":"done"}

            """.data(using: .utf8)!
            return (response, data)
        }

        let service = AIChatService(
            session: self.makeSession(),
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )
        let recorder = DeltaRecorder()

        let outcome = try await service.streamTurn(
            session: CloudLinkedSession(
                userId: "user-1",
                workspaceId: "workspace-1",
                email: "user@example.com",
                apiBaseUrl: "https://api.example.com",
                bearerToken: "test-token"
            ),
            request: AILocalChatRequestBody(
                messages: [AILocalChatWireMessage(
                    role: "user",
                    content: "say hi",
                    toolCalls: nil,
                    toolCallId: nil,
                    name: nil,
                    output: nil
                )],
                model: aiChatDefaultModelId,
                timezone: "Europe/Madrid"
            ),
            onDelta: { text in
                await recorder.append(text)
            },
            onToolCall: { _ in },
            onToolCallRequest: { _ in },
            onRepairAttempt: { _ in }
        )

        let deltas = await recorder.snapshot()
        XCTAssertEqual(deltas, ["Hi", "!"])
        XCTAssertEqual(outcome.requestId, "request-stream-1")
        XCTAssertFalse(outcome.awaitsToolResults)
        XCTAssertTrue(outcome.requestedToolCalls.isEmpty)
    }
}
