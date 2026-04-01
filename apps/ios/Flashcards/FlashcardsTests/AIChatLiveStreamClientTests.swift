import XCTest
@testable import Flashcards

final class AIChatLiveStreamClientTests: XCTestCase {
    func testDecodeAIChatLiveEventAcceptsValidPayloadWithUnknownFields() throws {
        let event = try decodeAIChatLiveEvent(
            eventType: "assistant_message_done",
            payload: """
            {
              "cursor": "15",
              "itemId": "item-1",
              "isError": false,
              "isStopped": true,
              "futureField": "ignored"
            }
            """
        )

        guard case .assistantMessageDone(let cursor, let itemId, let isError, let isStopped) = event else {
            return XCTFail("Expected assistant_message_done event.")
        }
        XCTAssertEqual(cursor, "15")
        XCTAssertEqual(itemId, "item-1")
        XCTAssertFalse(isError)
        XCTAssertTrue(isStopped)
    }

    func testDecodeAIChatLiveEventRejectsMissingRequiredField() {
        XCTAssertThrowsError(
            try decodeAIChatLiveEvent(
                eventType: "assistant_delta",
                payload: """
                {
                  "cursor": "15",
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
                  "cursor": "15",
                  "itemId": "item-1",
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
                  "toolCallId": "tool-1",
                  "name": "sql",
                  "status": "pending",
                  "cursor": "15",
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
}
