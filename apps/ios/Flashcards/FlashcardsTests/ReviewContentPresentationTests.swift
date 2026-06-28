import Foundation
import XCTest
@testable import Flashcards

final class ReviewContentPresentationTests: XCTestCase {
    func testManagedMediaReferencesCreateNativeMediaBlocks() throws {
        let renderedContent = makeReviewRenderedContent(
            text: """
            Intro
            ![Diagram](fcasset://00000000-0000-4000-8000-000000000001?download=1)
            [External](https://example.com/file.png)
            """
        )

        guard case .managedMarkdown(let managedContent) = renderedContent else {
            XCTFail("Expected managed markdown content")
            return
        }

        XCTAssertEqual(managedContent.blocks.count, 3)
        guard case .managedMedia(let reference) = managedContent.blocks[1] else {
            XCTFail("Expected managed media block")
            return
        }

        XCTAssertEqual(reference.mediaAssetId, "00000000-0000-4000-8000-000000000001")
        XCTAssertEqual(reference.label, "Diagram")
        XCTAssertTrue(reference.isImageSyntax)
    }

    func testManagedMediaSpeakableTextUsesLabel() {
        XCTAssertEqual(
            makeReviewSpeakableText(text: "![Diagram](fcasset:00000000-0000-4000-8000-000000000001)"),
            "Diagram"
        )
    }
}
