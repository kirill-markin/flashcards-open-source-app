import Foundation
import XCTest
@testable import Flashcards

final class ReviewContentPresentationTests: XCTestCase {
    func testManagedMediaReferencesCreateNativeMediaBlocks() throws {
        let renderedContent = makeReviewRenderedContent(
            text: """
            Intro
            ![Ready diagram](fcasset://00000000-0000-4000-8000-000000000001?download=1)
            ![Pending diagram](fcasset:00000000-0000-4000-8000-000000000002?state=pending)
            ![Failed diagram](fcasset:00000000-0000-4000-8000-000000000003?download=1&state=failed)
            ![Unknown state](fcasset:00000000-0000-4000-8000-000000000004?state=processing)
            [External](https://example.com/file.png)
            """
        )

        guard case .managedMarkdown(let managedContent) = renderedContent else {
            XCTFail("Expected managed markdown content")
            return
        }

        XCTAssertEqual(managedContent.blocks.count, 6)
        guard case .managedMedia(let readyReference) = managedContent.blocks[1],
              case .managedMedia(let pendingReference) = managedContent.blocks[2],
              case .managedMedia(let failedReference) = managedContent.blocks[3],
              case .managedMedia(let unknownStateReference) = managedContent.blocks[4] else {
            XCTFail("Expected ready, pending, failed, and forward-compatible managed media blocks")
            return
        }

        XCTAssertEqual(readyReference.mediaAssetId, "00000000-0000-4000-8000-000000000001")
        XCTAssertEqual(readyReference.state, .ready)
        XCTAssertEqual(readyReference.label, "Ready diagram")
        XCTAssertTrue(readyReference.isImageSyntax)
        XCTAssertEqual(pendingReference.mediaAssetId, "00000000-0000-4000-8000-000000000002")
        XCTAssertEqual(pendingReference.state, .pending)
        XCTAssertEqual(failedReference.mediaAssetId, "00000000-0000-4000-8000-000000000003")
        XCTAssertEqual(failedReference.state, .failed)
        XCTAssertEqual(unknownStateReference.mediaAssetId, "00000000-0000-4000-8000-000000000004")
        XCTAssertEqual(unknownStateReference.state, .ready)
    }

    func testManagedMediaSpeakableTextUsesLabel() {
        XCTAssertEqual(
            makeReviewSpeakableText(text: "![Diagram](fcasset:00000000-0000-4000-8000-000000000001)"),
            "Diagram"
        )
    }
}
