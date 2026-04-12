import XCTest
@testable import Flashcards

final class AIChatStoreContentMutationTests: XCTestCase {
    func testCurrentRunHasAssistantToolCallsReturnsTrueForStartedToolCall() {
        let messages = [
            AIChatMessage(
                id: "message-0",
                role: .user,
                content: [.text("Run a query.")],
                timestamp: "2026-04-08T09:59:00Z",
                isError: false,
                isStopped: false,
                cursor: "cursor-0",
                itemId: nil
            ),
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                content: [
                    .toolCall(
                        AIChatToolCall(
                            id: "tool-1",
                            name: "sql",
                            status: .started,
                            input: "{\"query\":\"select 1\"}",
                            output: nil
                        )
                    )
                ],
                timestamp: "2026-04-08T10:00:00Z",
                isError: false,
                isStopped: false,
                cursor: "cursor-1",
                itemId: "item-1"
            )
        ]

        XCTAssertTrue(aiChatCurrentRunHasAssistantToolCalls(messages: messages))
    }

    func testCurrentRunHasAssistantToolCallsIgnoresHistoricalToolCalls() {
        let messages = [
            AIChatMessage(
                id: "message-0",
                role: .user,
                content: [.text("Run a query.")],
                timestamp: "2026-04-08T09:59:00Z",
                isError: false,
                isStopped: false,
                cursor: "cursor-0",
                itemId: nil
            ),
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                content: [
                    .toolCall(
                        AIChatToolCall(
                            id: "tool-1",
                            name: "sql",
                            status: .completed,
                            input: "{\"query\":\"select 1\"}",
                            output: "[]"
                        )
                    )
                ],
                timestamp: "2026-04-08T10:00:00Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-1",
                itemId: "item-1"
            ),
            AIChatMessage(
                id: "message-2",
                role: .user,
                content: [.text("Summarize the result.")],
                timestamp: "2026-04-08T10:00:30Z",
                isError: false,
                isStopped: false,
                cursor: "cursor-2",
                itemId: nil
            ),
            AIChatMessage(
                id: "message-3",
                role: .assistant,
                content: [.text("No tool calls in the latest assistant reply.")],
                timestamp: "2026-04-08T10:01:00Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-3",
                itemId: "item-3"
            )
        ]

        XCTAssertFalse(aiChatCurrentRunHasAssistantToolCalls(messages: messages))
    }

    func testCurrentRunHasAssistantToolCallsReturnsFalseWithoutUserMessage() {
        let messages = [
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                content: [
                    .toolCall(
                        AIChatToolCall(
                            id: "tool-1",
                            name: "sql",
                            status: .completed,
                            input: "{\"query\":\"select 1\"}",
                            output: "[]"
                        )
                    )
                ],
                timestamp: "2026-04-08T10:00:00Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-1",
                itemId: "item-1"
            )
        ]

        XCTAssertFalse(aiChatCurrentRunHasAssistantToolCalls(messages: messages))
    }

    func testActiveRunTailHasToolCallsReturnsTrueForTrailingUnstoppedAssistantTail() {
        let messages = [
            AIChatMessage(
                id: "message-0",
                role: .user,
                content: [.text("Run a query.")],
                timestamp: "2026-04-08T09:59:00Z",
                isError: false,
                isStopped: false,
                cursor: "cursor-0",
                itemId: nil
            ),
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                content: [.text("Checking the workspace.")],
                timestamp: "2026-04-08T10:00:00Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-1",
                itemId: "item-1"
            ),
            AIChatMessage(
                id: "message-2",
                role: .assistant,
                content: [.text("Still running.")],
                timestamp: "2026-04-08T10:00:30Z",
                isError: false,
                isStopped: false,
                cursor: "cursor-2",
                itemId: "item-2"
            ),
            AIChatMessage(
                id: "message-3",
                role: .assistant,
                content: [
                    .toolCall(
                        AIChatToolCall(
                            id: "tool-1",
                            name: "sql",
                            status: .started,
                            input: "{\"query\":\"select 1\"}",
                            output: nil
                        )
                    )
                ],
                timestamp: "2026-04-08T10:01:00Z",
                isError: false,
                isStopped: false,
                cursor: "cursor-3",
                itemId: "item-3"
            )
        ]

        XCTAssertTrue(aiChatActiveRunTailHasToolCalls(messages: messages))
    }

    func testTerminalRunHasToolCallsReturnsTrueForAssistantOnlyTrailingToolCall() {
        let messages = [
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                content: [
                    .toolCall(
                        AIChatToolCall(
                            id: "tool-1",
                            name: "sql",
                            status: .completed,
                            input: "{\"query\":\"select 1\"}",
                            output: "[]"
                        )
                    )
                ],
                timestamp: "2026-04-08T10:00:00Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-1",
                itemId: "item-1"
            )
        ]

        XCTAssertTrue(aiChatTerminalRunHasToolCalls(messages: messages))
    }

    func testTerminalRunHasToolCallsReturnsTrueWhenTrailingAssistantItemIncludesEarlierToolCallMessage() {
        let messages = [
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                content: [
                    .toolCall(
                        AIChatToolCall(
                            id: "tool-1",
                            name: "sql",
                            status: .completed,
                            input: "{\"query\":\"select 1\"}",
                            output: "[]"
                        )
                    )
                ],
                timestamp: "2026-04-08T10:00:00Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-1",
                itemId: "item-1"
            ),
            AIChatMessage(
                id: "message-2",
                role: .assistant,
                content: [.text("Done.")],
                timestamp: "2026-04-08T10:00:05Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-2",
                itemId: "item-1"
            )
        ]

        XCTAssertTrue(aiChatTerminalRunHasToolCalls(messages: messages))
    }

    func testTerminalRunHasToolCallsIgnoresHistoricalToolCallWhenLatestTurnIsPlainText() {
        let messages = [
            AIChatMessage(
                id: "message-0",
                role: .user,
                content: [.text("Run a query.")],
                timestamp: "2026-04-08T09:59:00Z",
                isError: false,
                isStopped: false,
                cursor: "cursor-0",
                itemId: nil
            ),
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                content: [
                    .toolCall(
                        AIChatToolCall(
                            id: "tool-1",
                            name: "sql",
                            status: .completed,
                            input: "{\"query\":\"select 1\"}",
                            output: "[]"
                        )
                    )
                ],
                timestamp: "2026-04-08T10:00:00Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-1",
                itemId: "item-1"
            ),
            AIChatMessage(
                id: "message-2",
                role: .user,
                content: [.text("Summarize the result.")],
                timestamp: "2026-04-08T10:00:30Z",
                isError: false,
                isStopped: false,
                cursor: "cursor-2",
                itemId: nil
            ),
            AIChatMessage(
                id: "message-3",
                role: .assistant,
                content: [.text("Here is a plain-text summary.")],
                timestamp: "2026-04-08T10:01:00Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-3",
                itemId: "item-3"
            )
        ]

        XCTAssertFalse(aiChatTerminalRunHasToolCalls(messages: messages))
    }

    func testTerminalRunHasToolCallsReturnsFalseWhenToolCallBelongsToEarlierAssistantItem() {
        let messages = [
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                content: [
                    .toolCall(
                        AIChatToolCall(
                            id: "tool-1",
                            name: "sql",
                            status: .completed,
                            input: "{\"query\":\"select 1\"}",
                            output: "[]"
                        )
                    )
                ],
                timestamp: "2026-04-08T10:00:00Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-1",
                itemId: "item-1"
            ),
            AIChatMessage(
                id: "message-2",
                role: .assistant,
                content: [.text("Here is a plain-text summary.")],
                timestamp: "2026-04-08T10:00:05Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-2",
                itemId: "item-2"
            )
        ]

        XCTAssertFalse(aiChatTerminalRunHasToolCalls(messages: messages))
    }

    func testSnapshotRunHasToolCallsIgnoresToolCallsBehindStoppedAssistantBoundary() {
        let messages = [
            AIChatMessage(
                id: "message-0",
                role: .user,
                content: [.text("Run a query.")],
                timestamp: "2026-04-08T09:59:00Z",
                isError: false,
                isStopped: false,
                cursor: "cursor-0",
                itemId: nil
            ),
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                content: [
                    .toolCall(
                        AIChatToolCall(
                            id: "tool-1",
                            name: "sql",
                            status: .completed,
                            input: "{\"query\":\"select 1\"}",
                            output: "[]"
                        )
                    )
                ],
                timestamp: "2026-04-08T10:00:00Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-1",
                itemId: "item-1"
            ),
            AIChatMessage(
                id: "message-2",
                role: .assistant,
                content: [.text("Wrapping up.")],
                timestamp: "2026-04-08T10:01:00Z",
                isError: false,
                isStopped: false,
                cursor: "cursor-2",
                itemId: "item-2"
            )
        ]

        XCTAssertFalse(
            aiChatSnapshotRunHasToolCalls(
                activeRun: AIChatActiveRun(
                    runId: "run-1",
                    status: "running",
                    live: AIChatActiveRunLive(
                        cursor: "cursor-2",
                        stream: AIChatLiveStreamEnvelope(
                            url: "https://example.com/live",
                            authorization: "Bearer token",
                            expiresAt: 1
                        )
                    ),
                    lastHeartbeatAt: nil
                ),
                messages: messages
            )
        )
    }

    func testSnapshotRunHasToolCallsUsesTerminalFallbackWithoutActiveRun() {
        let messages = [
            AIChatMessage(
                id: "message-1",
                role: .assistant,
                content: [
                    .toolCall(
                        AIChatToolCall(
                            id: "tool-1",
                            name: "sql",
                            status: .completed,
                            input: "{\"query\":\"select 1\"}",
                            output: "[]"
                        )
                    )
                ],
                timestamp: "2026-04-08T10:00:00Z",
                isError: false,
                isStopped: true,
                cursor: "cursor-1",
                itemId: "item-1"
            )
        ]

        XCTAssertTrue(aiChatSnapshotRunHasToolCalls(activeRun: nil, messages: messages))
    }

    func testUpsertingAIChatReasoningSummaryAppendsNewBlockAfterExistingContent() {
        let reasoningSummary = AIChatReasoningSummary(
            id: "reasoning-1",
            summary: "Checked the workspace card count.",
            status: .started
        )

        // The visible transcript order matters here: a late-arriving reasoning
        // block must not move ahead of assistant text that already streamed.
        let updatedContent = upsertingAIChatReasoningSummary(
            content: [
                .text("I'm checking your due cards and deck structure."),
            ],
            reasoningSummary: reasoningSummary
        )

        XCTAssertEqual(updatedContent.count, 2)

        guard case .text(let firstText) = updatedContent[0] else {
            return XCTFail("Expected text to stay first.")
        }
        guard case .reasoningSummary(let insertedReasoningSummary) = updatedContent[1] else {
            return XCTFail("Expected reasoning summary to be appended.")
        }

        XCTAssertEqual(firstText, "I'm checking your due cards and deck structure.")
        XCTAssertEqual(insertedReasoningSummary, reasoningSummary)
    }

    func testUpsertingAIChatReasoningSummaryKeepsExistingReasoningInPlace() {
        let existingReasoningSummary = AIChatReasoningSummary(
            id: "reasoning-1",
            summary: "Checked the workspace card count.",
            status: .started
        )
        let updatedReasoningSummary = AIChatReasoningSummary(
            id: "reasoning-1",
            summary: "Checked the workspace card count.",
            status: .completed
        )

        // Updating the same reasoning item must preserve its current position
        // in the transcript instead of reordering the whole assistant message.
        let updatedContent = upsertingAIChatReasoningSummary(
            content: [
                .text("I'm checking your due cards and deck structure."),
                .reasoningSummary(existingReasoningSummary),
                .text("You have 1,822 cards."),
            ],
            reasoningSummary: updatedReasoningSummary
        )

        XCTAssertEqual(updatedContent.count, 3)

        guard case .text(let firstText) = updatedContent[0] else {
            return XCTFail("Expected text to stay first.")
        }
        guard case .reasoningSummary(let insertedReasoningSummary) = updatedContent[1] else {
            return XCTFail("Expected reasoning summary to stay in place.")
        }
        guard case .text(let lastText) = updatedContent[2] else {
            return XCTFail("Expected trailing text to stay last.")
        }

        XCTAssertEqual(firstText, "I'm checking your due cards and deck structure.")
        XCTAssertEqual(insertedReasoningSummary, updatedReasoningSummary)
        XCTAssertEqual(lastText, "You have 1,822 cards.")
    }
}
