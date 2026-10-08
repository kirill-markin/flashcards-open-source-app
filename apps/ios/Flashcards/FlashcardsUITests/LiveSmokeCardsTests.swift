import XCTest

final class LiveSmokeCardsTests: LiveSmokeTestCase {
    @MainActor
    func testLiveSmokeCardTagsPreserveFrontAndBackDraft() throws {
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)
        let front = "Keep this question while editing tags.\nReturn to the same draft."
        let back = "Keep this answer while editing tags.\nSave both sides together."
        let tag = "route-check"

        try self.step("keep both text destinations and the tag selection in one card draft") {
            try self.tapButton(identifier: LiveSmokeIdentifier.cardsAddButton, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            for (row, identifier, text) in [
                (LiveSmokeIdentifier.cardEditorFrontRow, LiveSmokeIdentifier.cardEditorFrontTextEditor, front),
                (LiveSmokeIdentifier.cardEditorBackRow, LiveSmokeIdentifier.cardEditorBackTextEditor, back)
            ] {
                try self.tapButton(identifier: row, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                try self.typeTextSafely(text, intoElementWithIdentifier: identifier, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                let editor = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
                XCTAssertEqual(editor.value as? String, text, "The native destination must stay open while its bound text changes.")
                try self.tapFirstNavigationBackButton()
            }

            let tags = self.app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Tags")).firstMatch
            XCTAssertTrue(tags.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
            XCTAssertTrue(tags.isHittable)
            tags.tap()
            let input = self.app.textFields["Add or filter tags"]
            XCTAssertTrue(input.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
            input.tap()
            input.typeText(tag)
            XCTAssertEqual(input.value as? String, tag, "Typing must retain the native Tags destination.")
            let create = self.app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Create", tag)).firstMatch
            XCTAssertTrue(create.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
            XCTAssertTrue(create.isHittable)
            create.tap()
            let done = self.app.navigationBars.buttons["Done"].firstMatch
            XCTAssertTrue(done.isHittable)
            done.tap()
            try self.assertTextExists(tag, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            for (row, identifier, text) in [
                (LiveSmokeIdentifier.cardEditorFrontRow, LiveSmokeIdentifier.cardEditorFrontTextEditor, front),
                (LiveSmokeIdentifier.cardEditorBackRow, LiveSmokeIdentifier.cardEditorBackTextEditor, back)
            ] {
                try self.tapButton(identifier: row, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                let editor = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
                XCTAssertEqual(editor.value as? String, text, "Returning from Tags must preserve the exact multiline text.")
                try self.tapFirstNavigationBackButton()
            }
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "Shared editor retains both multiline sides and selected tag before saving"
            screenshot.lifetime = .keepAlways
            self.add(screenshot)
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            try self.assertTextExists(front, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            try self.openFirstCardForEditing()
            try self.assertTextExists(tag, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorBackRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            let savedBack = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.cardEditorBackTextEditor).firstMatch
            XCTAssertEqual(savedBack.value as? String, back, "Saving and reopening the card must preserve the exact multiline answer.")
            try self.tapFirstNavigationBackButton()
        }
    }

    @MainActor
    func testLiveSmokeManualCardCreationFlow() throws {
        let context = self.makeRunContext()
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)

        try self.step("create one guest manual card without login") {
            try self.createManualCard(frontText: context.manualFrontText, backText: context.manualBackText)
        }
    }

    @MainActor
    func testLiveSmokeUnsavedCardDraftSurvivesInteractiveDismissal() throws {
        let frontText = "Unsaved card draft \(UUID().uuidString)"
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)

        try self.step("keep an unsaved card draft after interactive dismissal") {
            try self.assertUnsavedCardDraftSurvivesInteractiveDismissal(frontText: frontText)
        }
    }

    @MainActor
    func testLiveSmokeCardsEditorAiHandoffFlow() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)

        try self.step("open the guest manual card editor and hand off to AI") {
            try self.openFirstCardForEditing()
            try self.handoffEditedCardToAIAndAssertDraftAttachment()
        }
    }
}
