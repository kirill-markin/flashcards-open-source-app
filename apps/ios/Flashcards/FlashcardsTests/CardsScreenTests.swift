import XCTest
@testable import Flashcards

final class CardsScreenTests: XCTestCase {
    func testCreatePresentationUsesNewCardMode() {
        let presentation = CardEditorPresentation.create

        XCTAssertEqual(presentation.title, "New card")
        XCTAssertFalse(presentation.isEditing)
        XCTAssertNil(presentation.editingCardId)
        XCTAssertEqual(presentation.id, "create")
    }

    func testEditPresentationUsesEditCardMode() {
        let presentation = CardEditorPresentation.edit(cardId: "card-123")

        XCTAssertEqual(presentation.title, "Edit card")
        XCTAssertTrue(presentation.isEditing)
        XCTAssertEqual(presentation.editingCardId, "card-123")
        XCTAssertEqual(presentation.id, "edit-card-123")
    }
}
