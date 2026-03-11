import XCTest
@testable import Flashcards

final class ReviewContentPresentationTests: XCTestCase {
    func testClassifyReviewContentPresentationReturnsShortPlainForShortOneLineText() {
        XCTAssertEqual(classifyReviewContentPresentation(text: "Hola"), .shortPlain)
    }

    func testClassifyReviewContentPresentationReturnsShortPlainForFourWords() {
        XCTAssertEqual(classifyReviewContentPresentation(text: "one two three four"), .shortPlain)
    }

    func testClassifyReviewContentPresentationReturnsParagraphPlainForFiveWords() {
        XCTAssertEqual(classifyReviewContentPresentation(text: "one two three four five"), .paragraphPlain)
    }

    func testClassifyReviewContentPresentationReturnsParagraphPlainForMultiLinePlainText() {
        XCTAssertEqual(
            classifyReviewContentPresentation(text: "First line\nSecond line"),
            .paragraphPlain
        )
    }

    func testClassifyReviewContentPresentationReturnsMarkdownForHeading() {
        XCTAssertEqual(classifyReviewContentPresentation(text: "# Heading"), .markdown)
    }

    func testClassifyReviewContentPresentationReturnsMarkdownForList() {
        XCTAssertEqual(classifyReviewContentPresentation(text: "- item"), .markdown)
    }

    func testClassifyReviewContentPresentationReturnsMarkdownForFencedCodeBlock() {
        XCTAssertEqual(
            classifyReviewContentPresentation(text: "```swift\nlet value = 1\n```"),
            .markdown
        )
    }

    func testClassifyReviewContentPresentationReturnsMarkdownForInlineBacktick() {
        XCTAssertEqual(classifyReviewContentPresentation(text: "Use `map` here"), .markdown)
    }

    func testClassifyReviewContentPresentationKeepsMarkdownPrecedenceOverShortLength() {
        XCTAssertEqual(classifyReviewContentPresentation(text: "> short"), .markdown)
    }

    func testClassifyReviewContentPresentationReturnsParagraphPlainForPlaceholderText() {
        XCTAssertEqual(classifyReviewContentPresentation(text: "No back text"), .shortPlain)
    }

    func testMakeReviewRenderedContentReturnsShortPlainForShortText() {
        switch makeReviewRenderedContent(text: "Hola") {
        case .shortPlain(let text):
            XCTAssertEqual(text, "Hola")
        default:
            XCTFail("Expected short plain rendered content")
        }
    }

    func testMakeReviewRenderedContentReturnsMarkdownAttributedTextForHeading() {
        switch makeReviewRenderedContent(text: "# Heading") {
        case .markdown(let attributedText):
            XCTAssertTrue(String(attributedText.characters).contains("Heading"))
        default:
            XCTFail("Expected markdown rendered content")
        }
    }
}
