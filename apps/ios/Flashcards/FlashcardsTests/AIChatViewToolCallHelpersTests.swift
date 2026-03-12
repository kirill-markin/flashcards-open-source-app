import XCTest
@testable import Flashcards

final class AIChatViewToolCallHelpersTests: XCTestCase {
    func testAIChatToolSummaryTextUsesSqlPreview() {
        let summary = aiChatToolSummaryText(
            name: "sql",
            input: "{\"sql\":\"  SHOW TABLES  \"}"
        )

        XCTAssertEqual(summary, "SQL: SHOW TABLES")
    }

    func testAIChatToolSummaryTextFallsBackToToolLabelWithoutInput() {
        let summary = aiChatToolSummaryText(name: "web_search", input: nil)

        XCTAssertEqual(summary, "Web search")
    }

    func testAIChatToolSectionsSkipsEmptyRequestAndMissingResponse() {
        let sections = aiChatToolSections(input: "", output: nil)

        XCTAssertEqual(sections, [])
    }

    func testAIChatToolSectionsReturnsRequestAndResponseInOrder() {
        let sections = aiChatToolSections(
            input: "{\"sql\":\"SHOW TABLES\"}",
            output: "{\"rows\":[]}"
        )

        XCTAssertEqual(
            sections,
            [
                AIChatToolSection(
                    id: "request",
                    title: "Request",
                    text: "{\"sql\":\"SHOW TABLES\"}",
                    copyButtonTitle: "Copy",
                    copyAccessibilityLabel: "Copy request"
                ),
                AIChatToolSection(
                    id: "response",
                    title: "Response",
                    text: "{\"rows\":[]}",
                    copyButtonTitle: "Copy",
                    copyAccessibilityLabel: "Copy response"
                ),
            ]
        )
    }
}
