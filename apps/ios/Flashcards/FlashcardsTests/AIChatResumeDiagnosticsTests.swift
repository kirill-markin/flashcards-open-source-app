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
            let body = """
            event: run_terminal
            data: {"type":"run_terminal","sessionId":"session-1","conversationScopeId":"session-1","runId":"run-1","cursor":"5","sequenceNumber":1,"streamEpoch":"epoch-1","outcome":"completed"}

            """
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "text/event-stream"]
                )!,
                Data(body.utf8)
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
        var iterator = stream.makeAsyncIterator()
        let firstEvent = try await iterator.next()
        XCTAssertNotNil(firstEvent)
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
}
