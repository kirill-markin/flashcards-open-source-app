import UIKit
import XCTest

#if !targetEnvironment(macCatalyst)
final class LiveSmokeNativeEditorTests: LiveSmokeTestCase {
    @MainActor
    func testCardEditorAutofocusSwitchingAndPhotoPickerDismissal() throws {
        try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .cards)
        try self.tapButton(identifier: LiveSmokeIdentifier.cardsAddButton, timeout: 15)
        if self.app.buttons[LiveSmokeIdentifier.cardEditorFrontRow].waitForExistence(timeout: 3) == false {
            try self.tapButton(identifier: LiveSmokeIdentifier.cardsAddButton, timeout: 15)
        }
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: 15)
        XCTAssertTrue(self.app.keyboards.firstMatch.waitForExistence(timeout: 10))
        self.app.typeText("Front draft")
        self.assertEditorText("Front draft", editor: self.app.textViews[LiveSmokeIdentifier.cardEditorFrontTextEditor])
        try self.tapFirstNavigationBackButton()
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorBackRow, timeout: 15)
        XCTAssertTrue(self.app.keyboards.firstMatch.waitForExistence(timeout: 10))
        self.app.typeText("Back draft")
        self.assertEditorText("Back draft", editor: self.app.textViews[LiveSmokeIdentifier.cardEditorBackTextEditor])
        self.app.buttons["Add image"].tap()
        XCTAssertTrue(self.app.buttons["Cancel"].waitForExistence(timeout: 15))
        self.app.buttons["Cancel"].tap()
        let back = self.app.textViews[LiveSmokeIdentifier.cardEditorBackTextEditor]
        XCTAssertTrue(back.waitForExistence(timeout: 10))
        back.tap()
        self.app.typeText(" returned")
        self.assertEditorText("Back draft returned", editor: back)
        try self.tapFirstNavigationBackButton()
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorCancelButton, timeout: 15)
        XCTAssertTrue(self.app.keyboards.firstMatch.waitForNonExistence(timeout: 10))
    }

    @MainActor
    func testSpreadsheetPreviewEditorsStayVisibleWhileGrowing() throws {
        try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .library)
        let sidebar = self.app.buttons["ToggleSidebar"].firstMatch
        if sidebar.exists && sidebar.label == "Hide Sidebar" { sidebar.tap() }
        try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.libraryImportRow, timeout: 20)
        try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.librarySpreadsheetImportRow, timeout: 20)
        let source = self.app.textViews[LiveSmokeIdentifier.workspaceSpreadsheetImportSource]
        XCTAssertTrue(source.waitForExistence(timeout: 15))
        source.tap()
        source.typeText("Question?\tAnswer")
        for label in ["Front", "Back"] {
            let field = self.app.textViews.matching(NSPredicate(format: "label == %@", label)).firstMatch
            self.scrollPreviewIntoView(field)
            XCTAssertTrue(field.waitForExistence(timeout: 10))
            let originalHeight = field.frame.height
            field.tap()
            self.assertEditorVisible(field, minimumHeight: originalHeight)
            self.app.typeText("\nSecond line\nThird line")
            let value = field.value as? String ?? ""
            XCTAssertTrue(value.contains("Second line\nThird line"))
            XCTAssertTrue(value.contains(label == "Front" ? "Question?" : "Answer"))
            self.assertEditorVisible(field, minimumHeight: originalHeight * 3 - 1)
        }
    }

    @MainActor
    func testCardEditorPreservesUnicodeSelectionAndUndoAcrossNavigation() throws {
        try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .cards)
        try self.tapButton(identifier: LiveSmokeIdentifier.cardsAddButton, timeout: 15)
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: 15)
        let editor = self.app.textViews[LiveSmokeIdentifier.cardEditorFrontTextEditor]
        XCTAssertTrue(editor.waitForExistence(timeout: 15))
        try self.typeTextSafely("A😀B", intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, timeout: 20)
        self.app.typeKey(XCUIKeyboardKey.leftArrow.rawValue, modifierFlags: [])
        editor.typeText("X")
        self.assertEditorText("A😀XB", editor: editor)

        try self.tapFirstNavigationBackButton()
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: 15)
        XCTAssertTrue(editor.waitForExistence(timeout: 15))
        editor.typeText("Y")
        self.assertEditorText("A😀XYB", editor: editor)
        self.app.typeKey("z", modifierFlags: .command)
        self.assertEditorText("A😀XB", editor: editor)
        self.app.typeKey("z", modifierFlags: [.command, .shift])
        self.assertEditorText("A😀XYB", editor: editor)
    }

    @MainActor
    private func scrollPreviewIntoView(_ editor: XCUIElement) {
        for _ in 0..<8 {
            let top = self.app.navigationBars.firstMatch.frame.maxY
            let keyboard = self.app.keyboards.firstMatch
            let bottom = keyboard.exists ? keyboard.frame.minY - 20 : self.app.windows.firstMatch.frame.maxY - 90
            if editor.exists && editor.isHittable && editor.frame.minY >= top && editor.frame.maxY < bottom { return }
            // Keep the drag on the list's visible edge, clear of the editor and software keyboard.
            let origin = self.app.coordinate(withNormalizedOffset: .zero)
            let x = self.app.windows.firstMatch.frame.maxX - 8
            let start = origin.withOffset(CGVector(dx: x, dy: bottom - 16))
            let end = origin.withOffset(CGVector(dx: x, dy: max(top + 24, bottom - 190)))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
    }

    @MainActor
    private func assertEditorVisible(_ editor: XCUIElement, minimumHeight: CGFloat) {
        let keyboard = self.app.keyboards.firstMatch
        let deadline = Date().addingTimeInterval(10)
        // Injected typing can temporarily hide/restore the keyboard; wait for the actual final viewport.
        while Date() < deadline {
            if keyboard.exists {
                let frame = editor.frame
                if frame.height >= minimumHeight,
                   frame.minY >= self.app.navigationBars.firstMatch.frame.maxY,
                   frame.maxY < keyboard.frame.minY - 20 { return }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTFail("Editor did not become fully visible: editor=\(editor.frame), keyboard=\(keyboard.frame)")
    }

    @MainActor
    private func assertEditorText(_ expected: String, editor: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", expected), object: editor)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed)
    }
}
#endif
