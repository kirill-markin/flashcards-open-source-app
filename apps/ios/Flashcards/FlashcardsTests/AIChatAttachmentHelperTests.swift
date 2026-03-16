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
            XCTAssertEqual(Flashcards.errorMessage(error: error), "File is too large. Maximum allowed size is 20 MB.")
        }
    }

    func testAIChatCameraPresentationResultShowsSettingsAlertWhenAlreadyBlocked() {
        XCTAssertEqual(
            aiChatCameraPresentationResult(initialStatus: .blocked, requestedStatus: nil),
            .showAlert(.attachmentSettings(source: .camera))
        )
    }

    func testAIChatCameraPresentationResultStopsSilentlyAfterPromptDenial() {
        XCTAssertEqual(
            aiChatCameraPresentationResult(initialStatus: .askEveryTime, requestedStatus: .blocked),
            .stopSilently
        )
    }

    func testAIChatCameraPresentationResultShowsGeneralAlertWhenUnavailable() {
        XCTAssertEqual(
            aiChatCameraPresentationResult(initialStatus: .unavailable, requestedStatus: nil),
            .showAlert(.generalError(message: "Camera is not available on this device."))
        )
    }

    func testAIChatPhotoPresentationResultShowsSettingsAlertWhenAlreadyBlocked() {
        XCTAssertEqual(
            aiChatPhotoPresentationResult(initialStatus: .blocked, requestedStatus: nil),
            .showAlert(.attachmentSettings(source: .photos))
        )
    }

    func testAIChatPhotoPresentationResultStopsSilentlyAfterPromptDenial() {
        XCTAssertEqual(
            aiChatPhotoPresentationResult(initialStatus: .askEveryTime, requestedStatus: .blocked),
            .stopSilently
        )
    }

    func testAIChatFileImportAlertShowsSettingsAlertForPermissionFailure() {
        let error = NSError(
            domain: NSCocoaErrorDomain,
            code: CocoaError.Code.fileReadNoPermission.rawValue
        )

        XCTAssertEqual(
            aiChatFileImportAlert(error: error),
            .attachmentSettings(source: .files)
        )
    }

    func testAIChatFileImportAlertShowsGeneralAlertForUnsupportedFileType() {
        let error = NSError(
            domain: "AIChatAttachment",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Unsupported file type: .exe"]
        )

        XCTAssertEqual(
            aiChatFileImportAlert(error: error),
            .generalError(message: "Unsupported file type: .exe")
        )
    }
}
