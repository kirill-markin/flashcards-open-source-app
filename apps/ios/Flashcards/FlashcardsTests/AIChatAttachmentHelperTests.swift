import Foundation
import XCTest
@testable import Flashcards

final class AIChatAttachmentHelperTests: XCTestCase {
    func testAIChatAttachmentMenuActionsReturnsExpectedOrder() {
        let actions = aiChatAttachmentMenuActions()

        XCTAssertEqual(actions, [.takePhoto, .choosePhoto, .chooseFile])
    }

    func testAIChatMakeImageAttachmentCreatesImageAttachment() throws {
        let data = Data("image".utf8)

        let attachment = try aiChatMakeImageAttachment(
            data: data,
            fileName: "photo.jpg",
            mediaType: "image/jpeg"
        )

        XCTAssertEqual(attachment.fileName, "photo.jpg")
        XCTAssertEqual(attachment.mediaType, "image/jpeg")
        XCTAssertEqual(attachment.base64Data, data.base64EncodedString())
        XCTAssertTrue(attachment.isImage)
        XCTAssertFalse(attachment.id.isEmpty)
    }

    func testAIChatMakeImageAttachmentRejectsOversizedData() {
        let data = Data(count: aiChatMaximumAttachmentBytes + 1)

        XCTAssertThrowsError(
            try aiChatMakeImageAttachment(
                data: data,
                fileName: "photo.jpg",
                mediaType: "image/jpeg"
            )
        ) { error in
            XCTAssertEqual(localizedMessage(error: error), "File is too large. Maximum allowed size is 20 MB.")
        }
    }
}
