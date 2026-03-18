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

    func testMakeReviewRenderedContentReturnsMarkdownContentForHeading() {
        switch makeReviewRenderedContent(text: "# Heading") {
        case .markdown(let markdownContent):
            XCTAssertEqual(markdownContent.renderMarkdown(), "# Heading")
        default:
            XCTFail("Expected markdown rendered content")
        }
    }

    func testMakeReviewRenderedContentKeepsInlineCodeAsMarkdownContent() {
        switch makeReviewRenderedContent(text: "Use `map` here") {
        case .markdown(let markdownContent):
            XCTAssertEqual(markdownContent.renderMarkdown(), "Use `map` here")
        default:
            XCTFail("Expected markdown rendered content")
        }
    }

    func testMakeReviewRenderedContentKeepsListAsMultilineMarkdownContent() {
        switch makeReviewRenderedContent(text: "- item\n- item two") {
        case .markdown(let markdownContent):
            let renderedMarkdown = markdownContent.renderMarkdown()

            XCTAssertEqual(
                renderedMarkdown
                    .split(separator: "\n")
                    .map { line in line.trimmingCharacters(in: .whitespaces) },
                ["- item", "- item two"]
            )
        default:
            XCTFail("Expected markdown rendered content")
        }
    }

    func testMakeReviewRenderedContentKeepsFencedCodeBlockLineBreaks() {
        let fencedCodeBlock = "```swift\nlet value = 1\nprint(value)\n```"

        switch makeReviewRenderedContent(text: fencedCodeBlock) {
        case .markdown(let markdownContent):
            let renderedMarkdown = markdownContent.renderMarkdown()

            XCTAssertTrue(renderedMarkdown.hasPrefix("```"))
            XCTAssertTrue(renderedMarkdown.contains("swift"))
            XCTAssertTrue(renderedMarkdown.contains("let value = 1"))
            XCTAssertTrue(renderedMarkdown.contains("print(value)"))
            XCTAssertTrue(renderedMarkdown.hasSuffix("```"))
        default:
            XCTFail("Expected markdown rendered content")
        }
    }
}
