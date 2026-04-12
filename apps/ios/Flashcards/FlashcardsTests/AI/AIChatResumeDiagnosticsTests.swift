import Foundation
import XCTest
@testable import Flashcards

private final class AIChatTestURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.requestHandler else {
            XCTFail("Expected request handler.")
            return
        }

        do {
            let (response, data) = try handler(self.request)
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            if data.isEmpty == false {
                self.client?.urlProtocol(self, didLoad: data)
            }
            self.client?.urlProtocolDidFinishLoading(self)
        } catch {
            self.client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

final class AIChatResumeDiagnosticsTests: XCTestCase {
    override func tearDown() {
        AIChatTestURLProtocol.requestHandler = nil
        super.tearDown()
    }

    func testLoadBootstrapIncludesResumeDiagnosticsHeaders() async throws {
        let expectation = XCTestExpectation(description: "Bootstrap request captured")
        let bootstrapResponseJSON = Self.bootstrapResponseJSON
        let service = AIChatService(
            session: self.makeURLSession(),
            encoder: JSONEncoder(),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        AIChatTestURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Chat-Resume-Attempt-Id"), "11")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Client-Platform"), aiChatClientPlatform)
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Client-Version"), aiChatAppVersion())
            expectation.fulfill()
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(bootstrapResponseJSON.utf8)
            )
        }

        let response = try await service.loadBootstrap(
            session: self.makeLinkedSession(),
            sessionId: "session-1",
            limit: 20,
            resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics(sequence: 11)
        )

        XCTAssertEqual(response.sessionId, "session-1")
        await self.fulfillment(of: [expectation], timeout: 1.0)
    }

    func testStartRunEncodesUILocaleInRequestBody() async throws {
        let expectation = XCTestExpectation(description: "Start run request captured")
        let service = AIChatService(
            session: self.makeURLSession(),
            encoder: JSONEncoder(),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        AIChatTestURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/chat")
            let body = try XCTUnwrap(aiChatRequestBodyData(request: request))
            let payload = try JSONDecoder().decode(AIChatEncodedStartRunRequest.self, from: body)
            XCTAssertEqual(payload.sessionId, "session-1")
            XCTAssertEqual(payload.timezone, TimeZone.current.identifier)
            XCTAssertEqual(payload.uiLocale, currentAIChatUILocaleIdentifier())
            expectation.fulfill()
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(Self.startRunResponseJSON.utf8)
            )
        }

        let response = try await service.startRun(
            session: self.makeLinkedSession(),
            request: AIChatStartRunRequestBody(
                sessionId: "session-1",
                clientRequestId: "request-1",
                content: [.text("Help me review this.")],
                timezone: TimeZone.current.identifier,
                uiLocale: currentAIChatUILocaleIdentifier()
            )
        )

        XCTAssertEqual(response.sessionId, "session-1")
        await self.fulfillment(of: [expectation], timeout: 1.0)
    }

    func testCreateNewSessionEncodesUILocaleInRequestBody() async throws {
        let expectation = XCTestExpectation(description: "New session request captured")
        let service = AIChatService(
            session: self.makeURLSession(),
            encoder: JSONEncoder(),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        AIChatTestURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/chat/new")
            let body = try XCTUnwrap(aiChatRequestBodyData(request: request))
            let payload = try JSONDecoder().decode(AIChatEncodedNewSessionRequest.self, from: body)
            XCTAssertEqual(payload.sessionId, "session-1")
            XCTAssertEqual(payload.uiLocale, currentAIChatUILocaleIdentifier())
            expectation.fulfill()
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(Self.newSessionResponseJSON.utf8)
            )
        }

        let response = try await service.createNewSession(
            session: self.makeLinkedSession(),
            request: AIChatNewSessionRequestBody(
                sessionId: "session-1",
                uiLocale: currentAIChatUILocaleIdentifier()
            )
        )

        XCTAssertEqual(response.sessionId, "session-1")
        await self.fulfillment(of: [expectation], timeout: 1.0)
    }

    func testRequestBodiesOmitUILocaleWhenUnavailable() throws {
        let encoder = JSONEncoder()
        let startRunData = try encoder.encode(
            AIChatStartRunRequestBody(
                sessionId: "session-1",
                clientRequestId: "request-1",
                content: [.text("Help me review this.")],
                timezone: "Europe/Madrid",
                uiLocale: nil
            )
        )
        let startRunPayload = String(
            decoding: startRunData,
            as: UTF8.self
        )
        let newSessionData = try encoder.encode(
            AIChatNewSessionRequestBody(
                sessionId: "session-1",
                uiLocale: nil
            )
        )
        let newSessionPayload = String(
            decoding: newSessionData,
            as: UTF8.self
        )

        XCTAssertFalse(startRunPayload.contains("\"uiLocale\""))
        XCTAssertFalse(newSessionPayload.contains("\"uiLocale\""))
    }

    func testLiveStreamConnectIncludesResumeDiagnosticsHeaders() async throws {
        let expectation = XCTestExpectation(description: "Live request captured")
        let client = AIChatLiveStreamClient(urlSession: self.makeURLSession())
        AIChatTestURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Chat-Resume-Attempt-Id"), "12")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Client-Platform"), aiChatClientPlatform)
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Client-Version"), aiChatAppVersion())
            let components = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)
            let queryItems = components?.queryItems ?? []
            XCTAssertEqual(queryItems.first(where: { $0.name == "sessionId" })?.value, "session-1")
            XCTAssertEqual(queryItems.first(where: { $0.name == "runId" })?.value, "run-1")
            XCTAssertEqual(queryItems.first(where: { $0.name == "afterCursor" })?.value, "5")
            expectation.fulfill()
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "text/event-stream"]
                )!,
                // Request composition is the contract under test here.
                // Payload decoding is covered separately in AIChatLiveStreamClientTests.
                Data()
            )
        }

        let stream = await client.connect(
            liveUrl: "https://api.example.com/chat/live",
            authorization: "Live token",
            sessionId: "session-1",
            runId: "run-1",
            afterCursor: "5",
            configurationMode: .official,
            resumeAttemptDiagnostics: AIChatResumeAttemptDiagnostics(sequence: 12)
        )
        await self.fulfillment(of: [expectation], timeout: 1.0)
        withExtendedLifetime(stream) {}
    }

    func testLiveStreamErrorAlertUsesReadableSummaryAndDetails() {
        let error = AIChatLiveStreamError.invalidStatusCode(
            httpStatusCode: 400,
            errorDetails: CloudApiErrorDetails(
                message: "AI live stream request is missing runId.",
                requestId: "request-400",
                code: "CHAT_LIVE_RUN_ID_REQUIRED"
            ),
            configurationMode: .official
        )

        let alert = aiChatGeneralErrorAlert(error: error, resumeAttemptSequence: 4)

        XCTAssertEqual(alert.title, "Couldn't Continue the AI Response")
        XCTAssertEqual(
            alert.message,
            [
                "AI live stream request is missing runId.",
                "Reference: request-400",
                "Status: 400",
                "Code: CHAT_LIVE_RUN_ID_REQUIRED",
                "Resume Attempt: 4",
            ].joined(separator: "\n")
        )
    }

    private func makeURLSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AIChatTestURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    private func makeLinkedSession() -> CloudLinkedSession {
        CloudLinkedSession(
            userId: "user-1",
            workspaceId: "workspace-1",
            email: "user@example.com",
            configurationMode: .official,
            apiBaseUrl: "https://api.example.com",
            authorization: .bearer("token-1")
        )
    }

    private static let bootstrapResponseJSON: String = """
    {
      "sessionId": "session-1",
      "conversationScopeId": "session-1",
      "conversation": {
        "messages": [],
        "updatedAt": 123,
        "mainContentInvalidationVersion": 1,
        "hasOlder": false,
        "oldestCursor": null
      },
      "chatConfig": {
        "provider": { "id": "openai", "label": "OpenAI" },
        "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
        "reasoning": { "effort": "medium", "label": "Medium" },
        "features": {
          "modelPickerEnabled": false,
          "dictationEnabled": true,
          "attachmentsEnabled": true
        },
        "liveUrl": "https://api.example.com/chat/live"
      },
      "activeRun": {
        "runId": "run-1",
        "status": "running",
        "live": {
          "cursor": "5",
          "stream": {
            "url": "https://api.example.com/chat/live",
            "authorization": "Live token",
            "expiresAt": 123
          }
        },
        "lastHeartbeatAt": 123
      }
    }
    """

    private static let startRunResponseJSON: String = """
    {
      "accepted": true,
      "sessionId": "session-1",
      "conversationScopeId": "session-1",
      "conversation": {
        "messages": [],
        "updatedAt": 123,
        "mainContentInvalidationVersion": 1,
        "hasOlder": false,
        "oldestCursor": null
      },
      "composerSuggestions": [],
      "chatConfig": {
        "provider": { "id": "openai", "label": "OpenAI" },
        "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
        "reasoning": { "effort": "medium", "label": "Medium" },
        "features": {
          "modelPickerEnabled": false,
          "dictationEnabled": true,
          "attachmentsEnabled": true
        },
        "liveUrl": "https://api.example.com/chat/live"
      },
      "activeRun": null
    }
    """

    private static let newSessionResponseJSON: String = """
    {
      "ok": true,
      "sessionId": "session-1",
      "composerSuggestions": [],
      "chatConfig": {
        "provider": { "id": "openai", "label": "OpenAI" },
        "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
        "reasoning": { "effort": "medium", "label": "Medium" },
        "features": {
          "modelPickerEnabled": false,
          "dictationEnabled": true,
          "attachmentsEnabled": true
        },
        "liveUrl": "https://api.example.com/chat/live"
      }
    }
    """
}

private struct AIChatEncodedStartRunRequest: Decodable {
    let sessionId: String?
    let clientRequestId: String
    let content: [AIChatContentPart]
    let timezone: String
    let uiLocale: String?
}

private struct AIChatEncodedNewSessionRequest: Decodable {
    let sessionId: String?
    let uiLocale: String?
}

private func aiChatRequestBodyData(request: URLRequest) -> Data? {
    if let httpBody = request.httpBody {
        return httpBody
    }

    guard let bodyStream = request.httpBodyStream else {
        return nil
    }

    bodyStream.open()
    defer {
        bodyStream.close()
    }

    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 1024)

    while bodyStream.hasBytesAvailable {
        let readCount = bodyStream.read(&buffer, maxLength: buffer.count)
        if readCount < 0 {
            return nil
        }
        if readCount == 0 {
            break
        }
        data.append(buffer, count: readCount)
    }

    return data
}
