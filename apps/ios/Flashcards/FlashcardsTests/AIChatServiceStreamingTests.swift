import Foundation
import XCTest
@testable import Flashcards

final class AIChatServiceStreamingTests: AIChatTestCaseBase {
    func testAIChatServiceFormatsApiErrorsWithRequestId() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/chat")
            XCTAssertEqual(request.httpMethod, "POST")
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
            _ = try await service.startRun(
                session: self.makeLinkedSession(),
                request: AIChatStartRunRequestBody(
                    sessionId: "session-1",
                    content: [.text("hello")],
                    timezone: "Europe/Madrid"
                )
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

    func testAIChatServiceStartsRunsWithCompactBackendOwnedRequestShape() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/chat")
            XCTAssertEqual(request.httpMethod, "POST")

            let bodyData = try XCTUnwrap(request.httpBody)
            let jsonObject = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
            XCTAssertEqual(Set(jsonObject.keys), ["content", "sessionId", "timezone"])
            XCTAssertEqual(jsonObject["sessionId"] as? String, "session-1")
            XCTAssertEqual(jsonObject["timezone"] as? String, "Europe/Madrid")

            let content = try XCTUnwrap(jsonObject["content"] as? [[String: Any]])
            XCTAssertEqual(content.count, 1)
            XCTAssertEqual(content[0]["type"] as? String, "text")
            XCTAssertEqual(content[0]["text"] as? String, "hello")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {
              "ok": true,
              "sessionId": "session-1",
              "runId": "run-1",
              "runState": "running",
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": { "modelPickerEnabled": false, "dictationEnabled": true, "attachmentsEnabled": true }
              }
            }
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = AIChatService(
            session: self.makeSession(),
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let response = try await service.startRun(
            session: self.makeLinkedSession(),
            request: AIChatStartRunRequestBody(
                sessionId: "session-1",
                content: [.text("hello")],
                timezone: "Europe/Madrid"
            )
        )

        XCTAssertEqual(response.sessionId, "session-1")
        XCTAssertEqual(response.runId, "run-1")
        XCTAssertEqual(response.chatConfig.model.id, aiChatDefaultModelId)
    }

    func testAIChatServiceLoadsServerSnapshotsFromChatEndpoint() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/chat?sessionId=session-1")
            XCTAssertEqual(request.httpMethod, "GET")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {
              "sessionId": "session-1",
              "runState": "idle",
              "updatedAt": 1742811200000,
              "mainContentInvalidationVersion": 0,
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": { "modelPickerEnabled": false, "dictationEnabled": true, "attachmentsEnabled": true }
              },
              "messages": [
                {
                  "role": "assistant",
                  "content": [{ "type": "text", "text": "Stored answer" }],
                  "timestamp": 1742811200000,
                  "isError": false,
                  "isStopped": false
                }
              ]
            }
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = AIChatService(
            session: self.makeSession(),
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let snapshot = try await service.loadSnapshot(
            session: self.makeLinkedSession(),
            sessionId: "session-1"
        )

        XCTAssertEqual(snapshot.sessionId, "session-1")
        XCTAssertEqual(snapshot.runState, "idle")
        XCTAssertEqual(snapshot.messages.count, 1)
        XCTAssertEqual(snapshot.messages[0].text, "Stored answer")
    }

    func testAIChatServiceLoadsServerSnapshotsWithBackendToolCallIdsAndReasoningSummaries() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/chat?sessionId=session-1")
            XCTAssertEqual(request.httpMethod, "GET")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {
              "sessionId": "session-1",
              "runState": "idle",
              "updatedAt": 1742811200000,
              "mainContentInvalidationVersion": 1,
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": { "modelPickerEnabled": false, "dictationEnabled": true, "attachmentsEnabled": true }
              },
              "messages": [
                {
                  "role": "assistant",
                  "content": [
                    { "type": "reasoning_summary", "summary": "Hidden reasoning" },
                    {
                      "type": "tool_call",
                      "id": "tool-1",
                      "name": "sql",
                      "status": "completed",
                      "input": "select 1",
                      "output": "[1]"
                    },
                    { "type": "text", "text": "Stored answer" }
                  ],
                  "timestamp": 1742811200000,
                  "isError": false,
                  "isStopped": false
                }
              ]
            }
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = AIChatService(
            session: self.makeSession(),
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let snapshot = try await service.loadSnapshot(
            session: self.makeLinkedSession(),
            sessionId: "session-1"
        )

        XCTAssertEqual(snapshot.messages.count, 1)
        XCTAssertEqual(snapshot.messages[0].text, "Stored answer")
        XCTAssertEqual(snapshot.messages[0].toolCalls.count, 1)
        XCTAssertEqual(snapshot.messages[0].toolCalls[0].id, "tool-1")
        XCTAssertEqual(snapshot.messages[0].toolCalls[0].name, "sql")
    }

    func testAIChatServiceAlwaysBuildsSyntheticSnapshotMessageIds() async throws {
        AIChatMockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.example.com/chat?sessionId=session-1")
            XCTAssertEqual(request.httpMethod, "GET")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {
              "sessionId": "session-1",
              "runState": "idle",
              "updatedAt": 1742811200000,
              "mainContentInvalidationVersion": 0,
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": { "modelPickerEnabled": false, "dictationEnabled": true, "attachmentsEnabled": true }
              },
              "messages": [
                {
                  "messageId": "server-message-1",
                  "role": "assistant",
                  "content": [{ "type": "text", "text": "Stored answer" }],
                  "timestamp": 1742811200000,
                  "isError": false,
                  "isStopped": false
                }
              ]
            }
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = AIChatService(
            session: self.makeSession(),
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let snapshot = try await service.loadSnapshot(
            session: self.makeLinkedSession(),
            sessionId: "session-1"
        )

        XCTAssertEqual(snapshot.messages.count, 1)
        XCTAssertNotEqual(snapshot.messages[0].id, "server-message-1")
        XCTAssertEqual(
            snapshot.messages[0].id,
            makeAIChatSnapshotMessageId(
                sessionId: "session-1",
                index: 0,
                role: .assistant,
                timestamp: "2025-03-24T10:13:20.000Z"
            )
        )
    }

    func testAIChatServiceUsesResetAndStopEndpoints() async throws {
        let recorder = RequestRecorder()
        AIChatMockUrlProtocol.requestHandler = { request in
            recorder.append(request)

            if request.url?.path == "/chat", request.httpMethod == "DELETE" {
                let response = HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!
                let data = """
                {
                  "ok": true,
                  "sessionId": "session-reset",
                  "chatConfig": {
                    "provider": { "id": "openai", "label": "OpenAI" },
                    "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                    "reasoning": { "effort": "medium", "label": "Medium" },
                    "features": { "modelPickerEnabled": false, "dictationEnabled": true, "attachmentsEnabled": true }
                  }
                }
                """.data(using: .utf8)!
                return (response, data)
            }

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {
              "ok": true,
              "sessionId": "session-1",
              "runId": "run-1",
              "stopped": true,
              "stillRunning": false
            }
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = AIChatService(
            session: self.makeSession(),
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )

        let resetResponse = try await service.resetSession(
            session: self.makeLinkedSession(),
            sessionId: "session-1"
        )
        let stopResponse = try await service.stopRun(
            session: self.makeLinkedSession(),
            sessionId: "session-1"
        )

        XCTAssertEqual(resetResponse.sessionId, "session-reset")
        XCTAssertTrue(stopResponse.stopped)
        let seenUrls = try recorder.snapshot().map { request in
            try XCTUnwrap(request.url?.absoluteString)
        }
        XCTAssertEqual(seenUrls, [
            "https://api.example.com/chat?sessionId=session-1",
            "https://api.example.com/chat/stop"
        ])
    }

    private func makeLinkedSession() -> CloudLinkedSession {
        CloudLinkedSession(
            userId: "user-1",
            workspaceId: "workspace-1",
            email: "user@example.com",
            configurationMode: .official,
            apiBaseUrl: "https://api.example.com",
            authorization: .bearer("test-token")
        )
    }
}
