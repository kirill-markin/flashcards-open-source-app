import XCTest
@testable import Flashcards

final class AIChatStoreContentMutationTests: XCTestCase {
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
