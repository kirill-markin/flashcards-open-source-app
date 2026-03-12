import Foundation
import XCTest
@testable import Flashcards

final class AIChatServiceStreamingTests: AIChatTestCaseBase {
    func testAIChatServiceFormatsApiErrorsWithRequestId() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/chat/local-turn")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            XCTAssertEqual(try self.readTotalCards(from: request), 3)

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
        let latencyRecorder = LatencyRecorder()

        do {
            _ = try await service.streamTurn(
                session: CloudLinkedSession(
                    userId: "user-1",
                    workspaceId: "workspace-1",
                    email: "user@example.com",
                    apiBaseUrl: "https://api.example.com",
                    bearerToken: "test-token"
                ),
                request: self.makeRequestBody(text: "hello"),
                tapStartedAt: Date(timeIntervalSince1970: 0),
                onDelta: { _ in },
                onToolCall: { _ in },
                onToolCallRequest: { _ in },
                onRepairAttempt: { _ in },
                onLatencyReported: { body in
                    await latencyRecorder.record(body)
                }
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

        let latencyBody = await latencyRecorder.latest()
        XCTAssertEqual(latencyBody?.kind, "latency")
        XCTAssertEqual(latencyBody?.result, AIChatLatencyResult.responseNotOk.rawValue)
        XCTAssertEqual(latencyBody?.statusCode, 403)
        XCTAssertEqual(latencyBody?.didReceiveFirstSseLine, false)
        XCTAssertEqual(latencyBody?.didReceiveFirstDelta, false)
    }

    func testAIChatServiceReadsSequentialSSEEventsWithoutFramingFailure() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/chat/local-turn")
            XCTAssertEqual(try self.readTotalCards(from: request), 3)

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
        let latencyRecorder = LatencyRecorder()

        let outcome = try await service.streamTurn(
            session: CloudLinkedSession(
                userId: "user-1",
                workspaceId: "workspace-1",
                email: "user@example.com",
                apiBaseUrl: "https://api.example.com",
                bearerToken: "test-token"
            ),
            request: self.makeRequestBody(text: "say hi"),
            tapStartedAt: Date(timeIntervalSince1970: 0),
            onDelta: { text in
                await recorder.append(text)
            },
            onToolCall: { _ in },
            onToolCallRequest: { _ in },
            onRepairAttempt: { _ in },
            onLatencyReported: { body in
                await latencyRecorder.record(body)
            }
        )

        let deltas = await recorder.snapshot()
        let latencyBody = await latencyRecorder.latest()
        XCTAssertEqual(deltas, ["Hi", "!"])
        XCTAssertEqual(outcome.requestId, "request-stream-1")
        XCTAssertFalse(outcome.awaitsToolResults)
        XCTAssertTrue(outcome.requestedToolCalls.isEmpty)
        XCTAssertEqual(latencyBody?.kind, "latency")
        XCTAssertEqual(latencyBody?.result, AIChatLatencyResult.success.rawValue)
        XCTAssertEqual(latencyBody?.firstEventType, "delta")
        XCTAssertEqual(latencyBody?.didReceiveFirstSseLine, true)
        XCTAssertEqual(latencyBody?.didReceiveFirstDelta, true)
        XCTAssertNil(latencyBody?.backendRequestId?.range(of: "user@example.com"))
    }

    private func makeRequestBody(text: String) -> AILocalChatRequestBody {
        AILocalChatRequestBody(
            messages: [AILocalChatWireMessage(
                role: "user",
                content: [.text(text)],
                toolCallId: nil,
                name: nil,
                output: nil
            )],
            model: aiChatDefaultModelId,
            timezone: "Europe/Madrid",
            devicePlatform: "ios",
            userContext: AILocalChatUserContext(totalCards: 3)
        )
    }

    private func readTotalCards(from request: URLRequest) throws -> Int {
        let bodyData = try XCTUnwrap(request.httpBody)
        let jsonObject = try JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        let userContext = try XCTUnwrap(jsonObject?["userContext"] as? [String: Any])
        return try XCTUnwrap(userContext["totalCards"] as? Int)
    }
}

private actor LatencyRecorder {
    private var bodies: [AIChatLatencyReportBody] = []

    func record(_ body: AIChatLatencyReportBody) {
        self.bodies.append(body)
    }

    func latest() -> AIChatLatencyReportBody? {
        self.bodies.last
    }
}
