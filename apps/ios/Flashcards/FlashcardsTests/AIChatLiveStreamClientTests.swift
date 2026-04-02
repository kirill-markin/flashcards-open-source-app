import XCTest
@testable import Flashcards

final class AIChatLiveStreamClientTests: XCTestCase {
    func testDecodeAIChatLiveEventAcceptsValidPayloadWithUnknownFields() throws {
        let event = try decodeAIChatLiveEvent(
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
        )

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
        let event = try decodeAIChatLiveEvent(
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
        )

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
}
