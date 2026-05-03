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
            let queryItems = try aiChatQueryItems(request: request)
            XCTAssertEqual(queryItems.first(where: { $0.name == "limit" })?.value, "20")
            XCTAssertEqual(queryItems.first(where: { $0.name == "sessionId" })?.value, "session-1")
            XCTAssertEqual(queryItems.first(where: { $0.name == "workspaceId" })?.value, "workspace-1")
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

    func testLoadSnapshotIncludesWorkspaceIdQueryItem() async throws {
        let expectation = XCTestExpectation(description: "Snapshot request captured")
        let service = AIChatService(
            session: self.makeURLSession(),
            encoder: JSONEncoder(),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        AIChatTestURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/chat")
            let queryItems = try aiChatQueryItems(request: request)
            XCTAssertEqual(queryItems.first(where: { $0.name == "sessionId" })?.value, "session-1")
            XCTAssertEqual(queryItems.first(where: { $0.name == "workspaceId" })?.value, "workspace-1")
            expectation.fulfill()
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(Self.bootstrapResponseJSON.utf8)
            )
        }

        let response = try await service.loadSnapshot(
            session: self.makeLinkedSession(),
            sessionId: "session-1"
        )

        XCTAssertEqual(response.sessionId, "session-1")
        await self.fulfillment(of: [expectation], timeout: 1.0)
    }

    func testLoadOlderMessagesIncludesWorkspaceIdQueryItem() async throws {
        let expectation = XCTestExpectation(description: "Older messages request captured")
        let service = AIChatService(
            session: self.makeURLSession(),
            encoder: JSONEncoder(),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        AIChatTestURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/chat")
            let queryItems = try aiChatQueryItems(request: request)
            XCTAssertEqual(queryItems.first(where: { $0.name == "sessionId" })?.value, "session-1")
            XCTAssertEqual(queryItems.first(where: { $0.name == "limit" })?.value, "10")
            XCTAssertEqual(queryItems.first(where: { $0.name == "before" })?.value, "cursor-1")
            XCTAssertEqual(queryItems.first(where: { $0.name == "workspaceId" })?.value, "workspace-1")
            expectation.fulfill()
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(Self.bootstrapResponseJSON.utf8)
            )
        }

        let response = try await service.loadOlderMessages(
            session: self.makeLinkedSession(),
            sessionId: "session-1",
            beforeCursor: "cursor-1",
            limit: 10
        )

        XCTAssertTrue(response.messages.isEmpty)
        XCTAssertFalse(response.hasOlder)
        XCTAssertNil(response.oldestCursor)
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
            XCTAssertEqual(payload.workspaceId, "workspace-1")
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
                uiLocale: currentAIChatUILocaleIdentifier(),
                workspaceId: nil
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
            XCTAssertEqual(payload.workspaceId, "workspace-1")
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
                uiLocale: currentAIChatUILocaleIdentifier(),
                workspaceId: nil
            )
        )

        XCTAssertEqual(response.sessionId, "session-1")
        await self.fulfillment(of: [expectation], timeout: 1.0)
    }

    func testStopRunEncodesWorkspaceAndRunIdInRequestBody() async throws {
        let expectation = XCTestExpectation(description: "Stop run request captured")
        let service = AIChatService(
            session: self.makeURLSession(),
            encoder: JSONEncoder(),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        AIChatTestURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/chat/stop")
            let body = try XCTUnwrap(aiChatRequestBodyData(request: request))
            let payload = try JSONDecoder().decode(AIChatEncodedStopRunRequest.self, from: body)
            XCTAssertEqual(payload.sessionId, "session-1")
            XCTAssertEqual(payload.runId, "run-1")
            XCTAssertEqual(payload.workspaceId, "workspace-1")
            expectation.fulfill()
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(Self.stopRunResponseJSON.utf8)
            )
        }

        let response = try await service.stopRun(
            session: self.makeLinkedSession(),
            sessionId: "session-1",
            runId: "run-1"
        )

        XCTAssertEqual(response.sessionId, "session-1")
        XCTAssertTrue(response.stopped)
        XCTAssertFalse(response.stillRunning)
        await self.fulfillment(of: [expectation], timeout: 1.0)
    }

    func testDictationUploadEncodesWorkspaceIdInMultipartBody() async throws {
        let expectation = XCTestExpectation(description: "Dictation request captured")
        let temporaryDirectory = FileManager.default.temporaryDirectory
        let recordedAudioUrl = temporaryDirectory.appendingPathComponent(UUID().uuidString.lowercased()).appendingPathExtension("m4a")
        try Data("audio-test".utf8).write(to: recordedAudioUrl)
        defer {
            try? FileManager.default.removeItem(at: recordedAudioUrl)
        }

        let transcriptionService = AIChatTranscriptionService(
            session: self.makeURLSession(),
            decoder: makeFlashcardsRemoteJSONDecoder()
        )
        AIChatTestURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/chat/transcriptions")
            let body = try XCTUnwrap(aiChatRequestBodyData(request: request))
            let multipartBody = String(decoding: body, as: UTF8.self)
            XCTAssertTrue(multipartBody.contains("name=\"sessionId\"\r\n\r\nsession-1\r\n"))
            XCTAssertTrue(multipartBody.contains("name=\"workspaceId\"\r\n\r\nworkspace-1\r\n"))
            XCTAssertTrue(multipartBody.contains("name=\"source\"\r\n\r\nios\r\n"))
            expectation.fulfill()
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(Self.transcriptionResponseJSON.utf8)
            )
        }

        let response = try await transcriptionService.transcribe(
            session: self.makeLinkedSession(),
            sessionId: "session-1",
            recordedAudio: AIChatRecordedAudio(
                fileUrl: recordedAudioUrl,
                fileName: "chat-dictation.m4a",
                mediaType: "audio/mp4"
            )
        )

        XCTAssertEqual(response.text, "Transcribed text")
        XCTAssertEqual(response.sessionId, "session-1")
        await self.fulfillment(of: [expectation], timeout: 1.0)
    }

    func testRequestBodiesOmitOptionalWireFieldsWhenUnavailable() throws {
        let encoder = JSONEncoder()
        let startRunData = try encoder.encode(
            AIChatStartRunRequestBody(
                sessionId: "session-1",
                clientRequestId: "request-1",
                content: [.text("Help me review this.")],
                timezone: "Europe/Madrid",
                uiLocale: nil,
                workspaceId: nil
            )
        )
        let startRunPayload = String(
            decoding: startRunData,
            as: UTF8.self
        )
        let newSessionData = try encoder.encode(
            AIChatNewSessionRequestBody(
                sessionId: "session-1",
                uiLocale: nil,
                workspaceId: nil
            )
        )
        let newSessionPayload = String(
            decoding: newSessionData,
            as: UTF8.self
        )
        let stopRunData = try encoder.encode(
            AIChatStopRunRequestBody(
                sessionId: "session-1",
                runId: nil,
                workspaceId: nil
            )
        )
        let stopRunPayload = String(
            decoding: stopRunData,
            as: UTF8.self
        )

        XCTAssertFalse(startRunPayload.contains("\"uiLocale\""))
        XCTAssertFalse(startRunPayload.contains("\"workspaceId\""))
        XCTAssertFalse(newSessionPayload.contains("\"uiLocale\""))
        XCTAssertFalse(newSessionPayload.contains("\"workspaceId\""))
        XCTAssertFalse(stopRunPayload.contains("\"runId\""))
        XCTAssertFalse(stopRunPayload.contains("\"workspaceId\""))
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
                code: "CHAT_LIVE_RUN_ID_REQUIRED",
                syncConflict: nil
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

    private static let stopRunResponseJSON: String = """
    {
      "sessionId": "session-1",
      "stopped": true,
      "stillRunning": false
    }
    """

    private static let transcriptionResponseJSON: String = """
    {
      "text": "Transcribed text",
      "sessionId": "session-1"
    }
    """
}

private struct AIChatEncodedStartRunRequest: Decodable {
    let sessionId: String?
    let clientRequestId: String
    let content: [AIChatContentPart]
    let timezone: String
    let uiLocale: String?
    let workspaceId: String?
}

private struct AIChatEncodedNewSessionRequest: Decodable {
    let sessionId: String?
    let uiLocale: String?
    let workspaceId: String?
}

private struct AIChatEncodedStopRunRequest: Decodable {
    let sessionId: String
    let runId: String?
    let workspaceId: String?
}

private func aiChatQueryItems(request: URLRequest) throws -> [URLQueryItem] {
    let url = try XCTUnwrap(request.url)
    return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
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
