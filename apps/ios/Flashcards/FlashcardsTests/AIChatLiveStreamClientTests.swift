import Foundation
import XCTest
@testable import Flashcards

private final class AIChatLiveStreamTestURLProtocol: URLProtocol, @unchecked Sendable {
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

final class AIChatLiveStreamClientTests: XCTestCase {
    override func tearDown() {
        AIChatLiveStreamTestURLProtocol.requestHandler = nil
        super.tearDown()
    }

    func testDecodeAIChatLiveEventAcceptsValidPayloadWithUnknownFields() throws {
        let event = try XCTUnwrap(decodeAIChatLiveEvent(
            eventType: "assistant_message_done",
            payload: """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "runId": "run-1",
              "cursor": "15",
              "sequenceNumber": 7,
              "streamEpoch": "epoch-1",
              "itemId": "item-1",
              "content": [
                {
                  "type": "text",
                  "text": "done"
                }
              ],
              "isError": false,
              "isStopped": true,
              "futureField": "ignored"
            }
            """
        ))

        guard case .assistantMessageDone(
            metadata: let metadata,
            itemId: let itemId,
            content: let content,
            isError: let isError,
            isStopped: let isStopped
        ) = event else {
            return XCTFail("Expected assistant_message_done event.")
        }
        XCTAssertEqual(metadata.sessionId, "session-1")
        XCTAssertEqual(metadata.conversationScopeId, "session-1")
        XCTAssertEqual(metadata.runId, "run-1")
        XCTAssertEqual(metadata.cursor, "15")
        XCTAssertEqual(metadata.sequenceNumber, 7)
        XCTAssertEqual(metadata.streamEpoch, "epoch-1")
        XCTAssertEqual(itemId, "item-1")
        XCTAssertEqual(content, [.text("done")])
        XCTAssertFalse(isError)
        XCTAssertTrue(isStopped)
    }

    func testDecodeAIChatLiveEventIgnoresUnknownExplicitEventType() throws {
        let event = try decodeAIChatLiveEvent(
            eventType: "service_side_event_v2",
            payload: """
            {
              "ignored": true
            }
            """
        )

        XCTAssertNil(event)
    }

    func testDecodeAIChatLiveEventIgnoresUnknownPayloadTypeWhenEventHeaderIsMissing() throws {
        let event = try decodeAIChatLiveEvent(
            eventType: nil,
            payload: """
            {
              "type": "service_side_event_v3",
              "ignored": true
            }
            """
        )

        XCTAssertNil(event)
    }

    func testDecodeAIChatLiveEventRejectsMissingRequiredField() {
        XCTAssertThrowsError(
            try decodeAIChatLiveEvent(
                eventType: "assistant_delta",
                payload: """
                {
                  "sessionId": "session-1",
                  "conversationScopeId": "session-1",
                  "cursor": "15",
                  "sequenceNumber": 1,
                  "streamEpoch": "epoch-1",
                  "itemId": "item-1"
                }
                """
            )
        ) { error in
            XCTAssertTrue(error is AIChatLiveStreamContractError)
        }
    }

    func testDecodeAIChatLiveEventRejectsWrongScalarType() {
        XCTAssertThrowsError(
            try decodeAIChatLiveEvent(
                eventType: "assistant_message_done",
                payload: """
                {
                  "sessionId": "session-1",
                  "conversationScopeId": "session-1",
                  "runId": "run-1",
                  "cursor": "15",
                  "sequenceNumber": 1,
                  "streamEpoch": "epoch-1",
                  "itemId": "item-1",
                  "content": [],
                  "isError": "false",
                  "isStopped": true
                }
                """
            )
        ) { error in
            XCTAssertTrue(error is AIChatLiveStreamContractError)
        }
    }

    func testDecodeAIChatLiveEventRejectsUnknownEnumValue() {
        XCTAssertThrowsError(
            try decodeAIChatLiveEvent(
                eventType: "assistant_tool_call",
                payload: """
                {
                  "sessionId": "session-1",
                  "conversationScopeId": "session-1",
                  "runId": "run-1",
                  "toolCallId": "tool-1",
                  "name": "sql",
                  "status": "pending",
                  "cursor": "15",
                  "sequenceNumber": 1,
                  "streamEpoch": "epoch-1",
                  "itemId": "item-1"
                }
                """
            )
        ) { error in
            XCTAssertTrue(error is AIChatLiveStreamContractError)
        }
    }

    func testDecodeAIChatLiveEventRejectsMalformedJson() {
        XCTAssertThrowsError(
            try decodeAIChatLiveEvent(
                eventType: "assistant_delta",
                payload: "{\"text\":\"hi\""
            )
        ) { error in
            XCTAssertTrue(error is AIChatLiveStreamContractError)
        }
    }

    func testDecodeAIChatLiveEventDecodesRunTerminalWithMetadata() throws {
        let event = try XCTUnwrap(decodeAIChatLiveEvent(
            eventType: "run_terminal",
            payload: """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "runId": "run-1",
              "cursor": "16",
              "sequenceNumber": 9,
              "streamEpoch": "epoch-1",
              "outcome": "completed",
              "assistantItemId": "item-1"
            }
            """
        ))

        guard case .runTerminal(
            metadata: let metadata,
            outcome: let outcome,
            message: let message,
            assistantItemId: let assistantItemId,
            isError: let isError,
            isStopped: let isStopped
        ) = event else {
            return XCTFail("Expected run_terminal event.")
        }
        XCTAssertEqual(metadata.sessionId, "session-1")
        XCTAssertEqual(metadata.runId, "run-1")
        XCTAssertEqual(metadata.cursor, "16")
        XCTAssertEqual(metadata.sequenceNumber, 9)
        XCTAssertEqual(metadata.streamEpoch, "epoch-1")
        XCTAssertEqual(outcome, .completed)
        XCTAssertNil(message)
        XCTAssertEqual(assistantItemId, "item-1")
        XCTAssertNil(isError)
        XCTAssertNil(isStopped)
    }

    func testDecodeAIChatLiveEventRejectsMissingRequiredMetadataField() {
        XCTAssertThrowsError(
            try decodeAIChatLiveEvent(
                eventType: "run_terminal",
                payload: """
                {
                  "sessionId": "session-1",
                  "conversationScopeId": "session-1",
                  "cursor": "16",
                  "sequenceNumber": 9,
                  "streamEpoch": "epoch-1",
                  "outcome": "completed"
                }
                """
            )
        ) { error in
            XCTAssertTrue(error is AIChatLiveStreamContractError)
        }
    }

    func testLiveStreamSkipsUnknownEventTypesAndContinues() async throws {
        let client = AIChatLiveStreamClient(urlSession: self.makeURLSession())
        AIChatLiveStreamTestURLProtocol.requestHandler = { request in
            let body = """
            event: service_side_event_v2
            data: {"ignored":true}

            event: run_terminal
            data: {"sessionId":"session-1","conversationScopeId":"session-1","runId":"run-1","cursor":"16","sequenceNumber":9,"streamEpoch":"epoch-1","outcome":"completed"}

            """.data(using: .utf8) ?? Data()
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "text/event-stream"]
                )!,
                body
            )
        }

        let stream = await client.connect(
            liveUrl: "https://api.example.com/chat/live",
            authorization: "Live token",
            sessionId: "session-1",
            runId: "run-1",
            afterCursor: "5",
            configurationMode: .official,
            resumeAttemptDiagnostics: nil
        )

        var receivedEvents: [AIChatLiveEvent] = []
        for try await event in stream {
            receivedEvents.append(event)
        }

        XCTAssertEqual(receivedEvents.count, 1)
        guard case .runTerminal(
            metadata: let metadata,
            outcome: let outcome,
            message: let message,
            assistantItemId: let assistantItemId,
            isError: let isError,
            isStopped: let isStopped
        ) = try XCTUnwrap(receivedEvents.first) else {
            return XCTFail("Expected run_terminal event.")
        }
        XCTAssertEqual(metadata.sessionId, "session-1")
        XCTAssertEqual(metadata.runId, "run-1")
        XCTAssertEqual(metadata.cursor, "16")
        XCTAssertEqual(outcome, .completed)
        XCTAssertNil(message)
        XCTAssertNil(assistantItemId)
        XCTAssertNil(isError)
        XCTAssertNil(isStopped)
    }

    private func makeURLSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AIChatLiveStreamTestURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}
