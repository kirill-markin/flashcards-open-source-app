import XCTest

private enum LiveSmokeIdentifier {
    static let settingsCurrentWorkspaceRow: String = "settings.currentWorkspaceRow"
    static let settingsWorkspaceSettingsRow: String = "settings.workspaceSettingsRow"
    static let settingsAccountSettingsRow: String = "settings.accountSettingsRow"
    static let accountSettingsAccountStatusRow: String = "accountSettings.accountStatusRow"
    static let accountStatusSignInButton: String = "accountStatus.signInButton"
    static let accountStatusSyncNowButton: String = "accountStatus.syncNowButton"
    static let cloudSignInEmailField: String = "cloudSignIn.emailField"
    static let cloudSignInSendCodeButton: String = "cloudSignIn.sendCodeButton"
    static let cloudSignInCreateWorkspaceButton: String = "cloudSignIn.createWorkspaceButton"
    static let currentWorkspaceRowButton: String = "currentWorkspace.rowButton"
    static let workspaceSettingsOverviewRow: String = "workspaceSettings.overviewRow"
    static let workspaceOverviewNameField: String = "workspaceOverview.nameField"
    static let workspaceOverviewSaveNameButton: String = "workspaceOverview.saveNameButton"
    static let workspaceOverviewDeleteWorkspaceButton: String = "workspaceOverview.deleteWorkspaceButton"
    static let deleteWorkspaceConfirmationPhrase: String = "deleteWorkspace.confirmationPhrase"
    static let deleteWorkspaceConfirmationField: String = "deleteWorkspace.confirmationField"
    static let deleteWorkspaceConfirmationButton: String = "deleteWorkspace.confirmationButton"
    static let cardsAddButton: String = "cards.addButton"
    static let cardEditorFrontRow: String = "cardEditor.frontRow"
    static let cardEditorBackRow: String = "cardEditor.backRow"
    static let cardEditorSaveButton: String = "cardEditor.saveButton"
    static let cardEditorFrontTextEditor: String = "cardEditor.frontTextEditor"
    static let cardEditorBackTextEditor: String = "cardEditor.backTextEditor"
    static let reviewShowAnswerButton: String = "review.showAnswerButton"
    static let reviewRateGoodButton: String = "review.rateGoodButton"
    static let aiConsentAcceptButton: String = "ai.consentAcceptButton"
    static let aiComposerTextField: String = "ai.composerTextField"
    static let aiComposerSendButton: String = "ai.composerSendButton"
}

final class LiveSmokeUITests: XCTestCase {
    private let liveUiTimeoutSeconds: TimeInterval = 120
    private let reviewEmailEnvironmentKey: String = "FLASHCARDS_LIVE_REVIEW_EMAIL"

    private var app: XCUIApplication!

    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
        self.app = XCUIApplication()
        self.app.launch()
    }

    /**
     This smoke test stays stateful on purpose: one connected story verifies
     that the app can sign in, create content, review it, call AI, and still
     keep the linked cloud state coherent after a relaunch. Each step fails at
     the exact screen boundary where the integration regressed.
     */
    func testLiveSmokeFlowUsesRealDemoAccountAcrossTabs() throws {
        let runId = String(Int(Date().timeIntervalSince1970))
        let reviewEmail = ProcessInfo.processInfo.environment[self.reviewEmailEnvironmentKey] ?? "apple-review@example.com"
        let workspaceName = "E2E ios \(runId)"
        let manualFrontText = "Manual e2e ios \(runId)"
        let manualBackText = "Manual answer e2e ios \(runId)"
        let aiFrontText = "AI e2e ios \(runId)"
        let aiBackText = "AI answer e2e ios \(runId)"
        let markerTag = "e2e-ios-\(runId)"

        var primaryFailure: Error?

        do {
            try self.step("sign in with the configured review account") {
                try self.signInWithReviewAccount(reviewEmail: reviewEmail)
            }

            try self.step("create an isolated linked workspace for this run") {
                try self.createEphemeralWorkspace(workspaceName: workspaceName)
            }

            try self.step("create one manual card") {
                try self.createManualCard(frontText: manualFrontText, backText: manualBackText)
            }

            try self.step("verify the manual card in cards and review it") {
                try self.assertTextExists(manualFrontText)
                try self.reviewCurrentCard(expectedFrontText: manualFrontText)
            }

            try self.step("relaunch the app and keep the linked session") {
                self.app.terminate()
                self.app.launch()
                try self.openSettingsTab()
                try self.openAccountStatus()
                try self.assertTextExists(reviewEmail)
                try self.tapFirstNavigationBackButton()
                try self.tapFirstNavigationBackButton()
            }

            try self.step("create one AI card with explicit confirmation") {
                try self.createAiCardWithConfirmation(
                    aiFrontText: aiFrontText,
                    aiBackText: aiBackText,
                    markerTag: markerTag
                )
            }

            try self.step("verify the AI-created card is visible in cards and review") {
                try self.openCardsTab()
                try self.assertTextExists(aiFrontText)
                try self.openReviewTab()
                try self.assertTextExists(aiFrontText)
            }

            try self.step("verify linked account status and workspace state") {
                try self.openSettingsTab()
                try self.assertTextExists(workspaceName)
                try self.openAccountStatus()
                try self.assertTextExists(reviewEmail)
                try self.assertElementExists(identifier: LiveSmokeIdentifier.accountStatusSyncNowButton)
                try self.tapFirstNavigationBackButton()
                try self.tapFirstNavigationBackButton()
            }
        } catch {
            primaryFailure = error
        }

        do {
            try self.step("delete the isolated workspace") {
                try self.deleteEphemeralWorkspace()
            }
        } catch {
            if primaryFailure == nil {
                throw error
            }

            XCTFail("iOS live smoke cleanup failed after a primary failure: \(error.localizedDescription)")
        }

        if let primaryFailure {
            throw primaryFailure
        }
    }

    private func step(_ title: String, action: () throws -> Void) throws {
        do {
            try action()
        } catch {
            throw NSError(
                domain: "LiveSmokeUITests",
                code: 1,
                userInfo: [
                    NSLocalizedDescriptionKey: "iOS live smoke step failed: \(title). \(error.localizedDescription)",
                ]
            )
        }
    }

    private func signInWithReviewAccount(reviewEmail: String) throws {
        try self.openSettingsTab()
        try self.tapElement(identifier: LiveSmokeIdentifier.settingsAccountSettingsRow)
        try self.tapElement(identifier: LiveSmokeIdentifier.accountSettingsAccountStatusRow)

        let signInButton = self.app.buttons[LiveSmokeIdentifier.accountStatusSignInButton]
        if signInButton.waitForExistence(timeout: 5) {
            signInButton.tap()
            try self.typeText(reviewEmail, intoElementWithIdentifier: LiveSmokeIdentifier.cloudSignInEmailField)
            try self.tapElement(identifier: LiveSmokeIdentifier.cloudSignInSendCodeButton)

            let createWorkspaceButton = self.app.buttons[LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton]
            if createWorkspaceButton.waitForExistence(timeout: self.liveUiTimeoutSeconds) {
                createWorkspaceButton.tap()
            }
        }

        try self.assertElementExists(identifier: LiveSmokeIdentifier.accountStatusSyncNowButton)
        try self.tapFirstNavigationBackButton()
        try self.tapFirstNavigationBackButton()
    }

    private func createEphemeralWorkspace(workspaceName: String) throws {
        try self.openSettingsTab()
        try self.tapElement(identifier: LiveSmokeIdentifier.settingsCurrentWorkspaceRow)
        try self.tapElement(identifier: LiveSmokeIdentifier.currentWorkspaceRowButton)
        try self.tapElement(identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton)
        try self.tapFirstNavigationBackButton()

        try self.tapElement(identifier: LiveSmokeIdentifier.settingsWorkspaceSettingsRow)
        try self.tapElement(identifier: LiveSmokeIdentifier.workspaceSettingsOverviewRow)
        try self.replaceText(workspaceName, inElementWithIdentifier: LiveSmokeIdentifier.workspaceOverviewNameField)
        try self.tapElement(identifier: LiveSmokeIdentifier.workspaceOverviewSaveNameButton)
        try self.tapFirstNavigationBackButton()
        try self.tapFirstNavigationBackButton()
        try self.assertTextExists(workspaceName)
    }

    private func createManualCard(frontText: String, backText: String) throws {
        try self.openCardsTab()
        try self.tapElement(identifier: LiveSmokeIdentifier.cardsAddButton)
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorFrontRow)
        try self.typeText(frontText, intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor)
        try self.tapFirstNavigationBackButton()
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorBackRow)
        try self.typeText(backText, intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorBackTextEditor)
        try self.tapFirstNavigationBackButton()
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorSaveButton)
    }

    private func reviewCurrentCard(expectedFrontText: String) throws {
        try self.openReviewTab()
        try self.assertTextExists(expectedFrontText)
        try self.tapElement(identifier: LiveSmokeIdentifier.reviewShowAnswerButton)
        try self.tapElement(identifier: LiveSmokeIdentifier.reviewRateGoodButton)
    }

    private func createAiCardWithConfirmation(
        aiFrontText: String,
        aiBackText: String,
        markerTag: String
    ) throws {
        try self.openAITab()

        let aiConsentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if aiConsentButton.waitForExistence(timeout: 5) {
            aiConsentButton.tap()
        }

        try self.replaceText(
            "Prepare exactly one flashcard proposal. Use front text \"\(aiFrontText)\", back text \"\(aiBackText)\", and include tag \"\(markerTag)\". Wait for my confirmation before creating it.",
            inElementWithIdentifier: LiveSmokeIdentifier.aiComposerTextField
        )
        try self.tapElement(identifier: LiveSmokeIdentifier.aiComposerSendButton)
        try self.assertTextExists(aiFrontText)

        try self.replaceText(
            "Confirmed. Create the card exactly as proposed.",
            inElementWithIdentifier: LiveSmokeIdentifier.aiComposerTextField
        )
        try self.tapElement(identifier: LiveSmokeIdentifier.aiComposerSendButton)
        try self.assertTextExists("Done")
    }

    private func deleteEphemeralWorkspace() throws {
        try self.openSettingsTab()
        try self.tapElement(identifier: LiveSmokeIdentifier.settingsWorkspaceSettingsRow)
        try self.tapElement(identifier: LiveSmokeIdentifier.workspaceSettingsOverviewRow)
        try self.tapElement(identifier: LiveSmokeIdentifier.workspaceOverviewDeleteWorkspaceButton)

        let continueButton = self.app.alerts.buttons["Continue"]
        XCTAssertTrue(
            continueButton.waitForExistence(timeout: self.liveUiTimeoutSeconds),
            "Workspace delete confirmation alert did not appear"
        )
        continueButton.tap()

        let confirmationPhrase = self.app.staticTexts[LiveSmokeIdentifier.deleteWorkspaceConfirmationPhrase]
        XCTAssertTrue(
            confirmationPhrase.waitForExistence(timeout: self.liveUiTimeoutSeconds),
            "Delete workspace confirmation phrase did not appear"
        )

        try self.replaceText(
            confirmationPhrase.label,
            inElementWithIdentifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationField
        )
        try self.tapElement(identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationButton)
    }

    private func openReviewTab() throws {
        try self.tapTabButton(named: "Review")
    }

    private func openCardsTab() throws {
        try self.tapTabButton(named: "Cards")
    }

    private func openAITab() throws {
        try self.tapTabButton(named: "AI")
    }

    private func openSettingsTab() throws {
        try self.tapTabButton(named: "Settings")
    }

    private func openAccountStatus() throws {
        try self.tapElement(identifier: LiveSmokeIdentifier.settingsAccountSettingsRow)
        try self.tapElement(identifier: LiveSmokeIdentifier.accountSettingsAccountStatusRow)
    }

    private func tapTabButton(named name: String) throws {
        let tabButton = self.app.tabBars.buttons[name]
        XCTAssertTrue(tabButton.waitForExistence(timeout: self.liveUiTimeoutSeconds), "Tab bar button '\(name)' did not appear")
        tabButton.tap()
    }

    private func tapElement(identifier: String) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: self.liveUiTimeoutSeconds), "Element '\(identifier)' did not appear")
        element.tap()
    }

    private func assertElementExists(identifier: String) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: self.liveUiTimeoutSeconds), "Element '\(identifier)' did not appear")
    }

    private func assertTextExists(_ text: String) throws {
        let textElement = self.app.staticTexts[text]
        XCTAssertTrue(textElement.waitForExistence(timeout: self.liveUiTimeoutSeconds), "Text '\(text)' did not appear")
    }

    private func typeText(_ text: String, intoElementWithIdentifier identifier: String) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: self.liveUiTimeoutSeconds), "Element '\(identifier)' did not appear")
        element.tap()
        element.typeText(text)
    }

    private func replaceText(_ text: String, inElementWithIdentifier identifier: String) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: self.liveUiTimeoutSeconds), "Element '\(identifier)' did not appear")
        element.tap()

        if let existingValue = element.value as? String, existingValue.isEmpty == false {
            let deleteSequence = String(repeating: XCUIKeyboardKey.delete.rawValue, count: existingValue.count)
            element.typeText(deleteSequence)
        }

        element.typeText(text)
    }

    private func tapFirstNavigationBackButton() throws {
        let backButton = self.app.navigationBars.buttons.firstMatch
        XCTAssertTrue(backButton.waitForExistence(timeout: self.liveUiTimeoutSeconds), "Back button did not appear")
        backButton.tap()
    }
}
