import Foundation
import OSLog
import XCTest

private enum LiveSmokeIdentifier {
    static let settingsScreen: String = "settings.screen"
    static let settingsCurrentWorkspaceRow: String = "settings.currentWorkspaceRow"
    static let settingsWorkspaceSettingsRow: String = "settings.workspaceSettingsRow"
    static let settingsAccountSettingsRow: String = "settings.accountSettingsRow"
    static let currentWorkspaceScreen: String = "currentWorkspace.screen"
    static let accountSettingsAccountStatusRow: String = "accountSettings.accountStatusRow"
    static let workspaceSettingsScreen: String = "workspaceSettings.screen"
    static let workspaceOverviewScreen: String = "workspaceOverview.screen"
    static let accountSettingsScreen: String = "accountSettings.screen"
    static let accountStatusScreen: String = "accountStatus.screen"
    static let accountStatusSignInButton: String = "accountStatus.signInButton"
    static let accountStatusSyncNowButton: String = "accountStatus.syncNowButton"
    static let cloudSignInEmailField: String = "cloudSignIn.emailField"
    static let cloudSignInSendCodeButton: String = "cloudSignIn.sendCodeButton"
    static let cloudSignInCreateWorkspaceButton: String = "cloudSignIn.createWorkspaceButton"
    static let currentWorkspaceRowButton: String = "currentWorkspace.rowButton"
    static let currentWorkspacePickerScreen: String = "currentWorkspace.pickerScreen"
    static let currentWorkspaceCreateButton: String = "currentWorkspace.createButton"
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

private enum LiveSmokeScreen: CaseIterable {
    case settings
    case currentWorkspace
    case workspaceSettings
    case workspaceOverview
    case accountSettings
    case accountStatus

    var identifier: String {
        switch self {
        case .settings:
            return LiveSmokeIdentifier.settingsScreen
        case .currentWorkspace:
            return LiveSmokeIdentifier.currentWorkspaceScreen
        case .workspaceSettings:
            return LiveSmokeIdentifier.workspaceSettingsScreen
        case .workspaceOverview:
            return LiveSmokeIdentifier.workspaceOverviewScreen
        case .accountSettings:
            return LiveSmokeIdentifier.accountSettingsScreen
        case .accountStatus:
            return LiveSmokeIdentifier.accountStatusScreen
        }
    }

    var title: String {
        switch self {
        case .settings:
            return "Settings"
        case .currentWorkspace:
            return "Current Workspace"
        case .workspaceSettings:
            return "Workspace Settings"
        case .workspaceOverview:
            return "Workspace Overview"
        case .accountSettings:
            return "Account Settings"
        case .accountStatus:
            return "Account Status"
        }
    }
}

private enum LiveSmokeFailure: LocalizedError {
    case stepFailed(title: String, durationSeconds: TimeInterval, underlyingMessage: String)
    case missingElement(identifier: String, timeoutSeconds: TimeInterval, screen: String, step: String)
    case missingText(text: String, timeoutSeconds: TimeInterval, screen: String, step: String)
    case missingScreen(screen: String, identifier: String, timeoutSeconds: TimeInterval, currentScreen: String, step: String)
    case missingBackButton(screen: String, step: String)
    case currentWorkspacePickerNotVisible(screen: String, step: String)

    var errorDescription: String? {
        switch self {
        case .stepFailed(let title, let durationSeconds, let underlyingMessage):
            return "iOS live smoke step failed: \(title). Duration: \(formatDuration(seconds: durationSeconds)). \(underlyingMessage)"
        case .missingElement(let identifier, let timeoutSeconds, let screen, let step):
            return "Element '\(identifier)' did not appear within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen)"
        case .missingText(let text, let timeoutSeconds, let screen, let step):
            return "Text '\(text)' did not appear within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen)"
        case .missingScreen(let screen, let identifier, let timeoutSeconds, let currentScreen, let step):
            return "Screen '\(screen)' with root identifier '\(identifier)' did not appear within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)'. Current screen: \(currentScreen)"
        case .missingBackButton(let screen, let step):
            return "Back button did not appear during step '\(step)' on screen: \(screen)"
        case .currentWorkspacePickerNotVisible(let screen, let step):
            return "Current Workspace picker did not appear during step '\(step)'. Current screen: \(screen)"
        }
    }
}

private let smokeLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "flashcards-open-source-app",
    category: "ui-smoke"
)

private func formatDuration(seconds: TimeInterval) -> String {
    String(format: "%.2fs", seconds)
}

final class LiveSmokeUITests: XCTestCase {
    private let shortUiTimeoutSeconds: TimeInterval = 10
    private let longUiTimeoutSeconds: TimeInterval = 30
    private let reviewEmailEnvironmentKey: String = "FLASHCARDS_LIVE_REVIEW_EMAIL"

    private var app: XCUIApplication!
    private var currentStepTitle: String = "test bootstrap"
    private var interruptionMonitor: NSObjectProtocol?

    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
        self.interruptionMonitor = self.registerInterruptionMonitor()
    }

    override func tearDownWithError() throws {
        if let interruptionMonitor {
            removeUIInterruptionMonitor(interruptionMonitor)
        }
        self.interruptionMonitor = nil
        try super.tearDownWithError()
    }

    /**
     This smoke test stays stateful on purpose: one connected story verifies
     that the app can sign in, create content, review it, call AI, and still
     keep the linked cloud state coherent after a relaunch. Each step fails at
     the exact screen boundary where the integration regressed.
     */
    @MainActor
    func testLiveSmokeFlowUsesRealDemoAccountAcrossTabs() throws {
        try self.launchApplication()
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
                try self.assertTextExists(manualFrontText, timeout: self.longUiTimeoutSeconds)
                try self.reviewCurrentCard(expectedFrontText: manualFrontText)
            }

            try self.step("relaunch the app and keep the linked session") {
                self.app.terminate()
                self.app.launch()
                try self.openSettingsTab()
                try self.openAccountStatus()
                try self.assertTextExists(reviewEmail, timeout: self.longUiTimeoutSeconds)
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
                try self.assertTextExists(aiFrontText, timeout: self.longUiTimeoutSeconds)
                try self.openReviewTab()
                try self.assertTextExists(aiFrontText, timeout: self.longUiTimeoutSeconds)
            }

            try self.step("verify linked account status and workspace state") {
                try self.openSettingsTab()
                try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
                try self.assertTextExists(workspaceName, timeout: self.longUiTimeoutSeconds)
                try self.openAccountStatus()
                try self.assertTextExists(reviewEmail, timeout: self.longUiTimeoutSeconds)
                try self.assertElementExists(
                    identifier: LiveSmokeIdentifier.accountStatusSyncNowButton,
                    timeout: self.longUiTimeoutSeconds
                )
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

            let cleanupDiagnostics = self.makeTextAttachment(
                name: "Cleanup Failure After Primary Failure",
                text: """
                Cleanup failed after primary failure.
                Cleanup error: \(error.localizedDescription)
                Current screen: \(self.currentScreenSummary())
                Visible text snapshot: \(self.visibleTextSnapshot())
                """
            )
            self.add(cleanupDiagnostics)
            smokeLogger.error(
                "event=cleanup_failure_after_primary step=\(self.currentStepTitle, privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public) error=\(error.localizedDescription, privacy: .public)"
            )
        }

        if let primaryFailure {
            throw primaryFailure
        }
    }

    @MainActor
    private func step(_ title: String, action: () throws -> Void) throws {
        let previousStepTitle = self.currentStepTitle
        self.currentStepTitle = title
        defer {
            self.currentStepTitle = previousStepTitle
        }

        try XCTContext.runActivity(named: title) { activity in
            let startedAt = Date()
            smokeLogger.log(
                "event=step_start step=\(title, privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
            )

            do {
                try action()

                let durationSeconds = Date().timeIntervalSince(startedAt)
                activity.add(
                    self.makeTextAttachment(
                        name: "Step Summary - \(title)",
                        text: """
                        Result: success
                        Step: \(title)
                        Duration: \(formatDuration(seconds: durationSeconds))
                        Current screen: \(self.currentScreenSummary())
                        """
                    )
                )
                smokeLogger.log(
                    "event=step_success step=\(title, privacy: .public) duration=\(formatDuration(seconds: durationSeconds), privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
                )
            } catch {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                activity.add(
                    self.makeTextAttachment(
                        name: "Step Failure Summary - \(title)",
                        text: """
                        Result: failure
                        Step: \(title)
                        Duration: \(formatDuration(seconds: durationSeconds))
                        Error: \(error.localizedDescription)
                        Current screen: \(self.currentScreenSummary())
                        Visible text snapshot: \(self.visibleTextSnapshot())
                        """
                    )
                )
                self.attachFailureDiagnostics(stepTitle: title, error: error, activity: activity)
                smokeLogger.error(
                    "event=step_failure step=\(title, privacy: .public) duration=\(formatDuration(seconds: durationSeconds), privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public) error=\(error.localizedDescription, privacy: .public)"
                )
                throw LiveSmokeFailure.stepFailed(
                    title: title,
                    durationSeconds: durationSeconds,
                    underlyingMessage: error.localizedDescription
                )
            }
        }
    }

    @MainActor
    private func launchApplication() throws {
        self.app = XCUIApplication()
        self.app.launch()
        smokeLogger.log(
            "event=app_launch step=\(self.currentStepTitle, privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
        )
    }

    @MainActor
    private func signInWithReviewAccount(reviewEmail: String) throws {
        try self.openSettingsTab()
        try self.openAccountStatus()

        let signInButton = self.app.buttons[LiveSmokeIdentifier.accountStatusSignInButton]
        if self.waitForOptionalElement(
            signInButton,
            identifier: LiveSmokeIdentifier.accountStatusSignInButton,
            timeout: self.shortUiTimeoutSeconds
        ) {
            signInButton.tap()
            try self.typeText(
                reviewEmail,
                intoElementWithIdentifier: LiveSmokeIdentifier.cloudSignInEmailField,
                timeout: self.shortUiTimeoutSeconds
            )
            try self.tapElement(
                identifier: LiveSmokeIdentifier.cloudSignInSendCodeButton,
                timeout: self.shortUiTimeoutSeconds
            )

            let createWorkspaceButton = self.app.buttons[LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton]
            if self.waitForOptionalElement(
                createWorkspaceButton,
                identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton,
                timeout: self.longUiTimeoutSeconds
            ) {
                createWorkspaceButton.tap()
            }
        }

        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.accountStatusSyncNowButton,
            timeout: self.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapFirstNavigationBackButton()
    }

    @MainActor
    private func createEphemeralWorkspace(workspaceName: String) throws {
        try self.openSettingsTab()
        try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.settingsCurrentWorkspaceRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .currentWorkspace, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.currentWorkspaceRowButton,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertCurrentWorkspacePickerIsVisible()
        try self.tapElement(
            identifier: LiveSmokeIdentifier.currentWorkspaceCreateButton,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()

        try self.tapElement(
            identifier: LiveSmokeIdentifier.settingsWorkspaceSettingsRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceSettings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.workspaceSettingsOverviewRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceOverview, timeout: self.shortUiTimeoutSeconds)
        try self.replaceText(
            workspaceName,
            inElementWithIdentifier: LiveSmokeIdentifier.workspaceOverviewNameField,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapElement(
            identifier: LiveSmokeIdentifier.workspaceOverviewSaveNameButton,
            timeout: self.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapFirstNavigationBackButton()
        try self.assertTextExists(workspaceName, timeout: self.longUiTimeoutSeconds)
    }

    @MainActor
    private func createManualCard(frontText: String, backText: String) throws {
        try self.openCardsTab()
        try self.tapElement(identifier: LiveSmokeIdentifier.cardsAddButton, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: self.shortUiTimeoutSeconds)
        try self.typeText(
            frontText,
            intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorBackRow, timeout: self.shortUiTimeoutSeconds)
        try self.typeText(
            backText,
            intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorBackTextEditor,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: self.shortUiTimeoutSeconds)
    }

    @MainActor
    private func reviewCurrentCard(expectedFrontText: String) throws {
        try self.openReviewTab()
        try self.assertTextExists(expectedFrontText, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: self.shortUiTimeoutSeconds)
    }

    @MainActor
    private func createAiCardWithConfirmation(
        aiFrontText: String,
        aiBackText: String,
        markerTag: String
    ) throws {
        try self.openAITab()

        let aiConsentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            aiConsentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: self.shortUiTimeoutSeconds
        ) {
            aiConsentButton.tap()
        }

        try self.replaceText(
            "Prepare exactly one flashcard proposal. Use front text \"\(aiFrontText)\", back text \"\(aiBackText)\", and include tag \"\(markerTag)\". Wait for my confirmation before creating it.",
            inElementWithIdentifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapElement(identifier: LiveSmokeIdentifier.aiComposerSendButton, timeout: self.shortUiTimeoutSeconds)
        try self.assertTextExists(aiFrontText, timeout: self.longUiTimeoutSeconds)

        try self.replaceText(
            "Confirmed. Create the card exactly as proposed.",
            inElementWithIdentifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapElement(identifier: LiveSmokeIdentifier.aiComposerSendButton, timeout: self.shortUiTimeoutSeconds)
        try self.assertTextExists("Done", timeout: self.longUiTimeoutSeconds)
    }

    @MainActor
    private func deleteEphemeralWorkspace() throws {
        smokeLogger.log(
            "event=cleanup_start step=\(self.currentStepTitle, privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
        )
        try self.openWorkspaceOverviewFromSettings()
        try self.tapElement(
            identifier: LiveSmokeIdentifier.workspaceOverviewDeleteWorkspaceButton,
            timeout: self.shortUiTimeoutSeconds
        )

        let continueButton = self.app.alerts.buttons["Continue"]
        if self.waitForOptionalElement(
            continueButton,
            identifier: "alert.continueButton",
            timeout: self.longUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: "alert.continueButton",
                timeoutSeconds: self.longUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        continueButton.tap()

        let confirmationPhrase = self.app.staticTexts[LiveSmokeIdentifier.deleteWorkspaceConfirmationPhrase]
        if self.waitForOptionalElement(
            confirmationPhrase,
            identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationPhrase,
            timeout: self.longUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationPhrase,
                timeoutSeconds: self.longUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        try self.replaceText(
            confirmationPhrase.label,
            inElementWithIdentifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationField,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapElement(identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationButton, timeout: self.longUiTimeoutSeconds)
        smokeLogger.log(
            "event=cleanup_success step=\(self.currentStepTitle, privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
        )
    }

    @MainActor
    private func openReviewTab() throws {
        try self.tapTabButton(named: "Review")
    }

    @MainActor
    private func openCardsTab() throws {
        try self.tapTabButton(named: "Cards")
    }

    @MainActor
    private func openAITab() throws {
        try self.tapTabButton(named: "AI")
    }

    @MainActor
    private func openSettingsTab() throws {
        try self.tapTabButton(named: "Settings")
    }

    @MainActor
    private func openAccountStatus() throws {
        try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.settingsAccountSettingsRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .accountSettings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.accountSettingsAccountStatusRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .accountStatus, timeout: self.shortUiTimeoutSeconds)
    }

    @MainActor
    private func openWorkspaceOverviewFromSettings() throws {
        try self.openSettingsTab()
        try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.settingsWorkspaceSettingsRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceSettings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.workspaceSettingsOverviewRow,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .workspaceOverview, timeout: self.shortUiTimeoutSeconds)
    }

    @MainActor
    private func tapTabButton(named name: String) throws {
        let tabButton = self.app.tabBars.buttons[name]
        if self.waitForOptionalElement(
            tabButton,
            identifier: "tab.\(name)",
            timeout: self.shortUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: "tab.\(name)",
                timeoutSeconds: self.shortUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        tabButton.tap()
    }

    @MainActor
    private func tapElement(identifier: String, timeout: TimeInterval) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        if self.waitForOptionalElement(
            element,
            identifier: identifier,
            timeout: timeout
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: identifier,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        element.tap()
    }

    @MainActor
    private func assertElementExists(identifier: String, timeout: TimeInterval) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        if self.waitForOptionalElement(
            element,
            identifier: identifier,
            timeout: timeout
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: identifier,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func assertTextExists(_ text: String, timeout: TimeInterval) throws {
        let textElement = self.app.staticTexts[text]
        if self.waitForOptionalElement(
            textElement,
            identifier: "text.\(text)",
            timeout: timeout
        ) == false {
            throw LiveSmokeFailure.missingText(
                text: text,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func typeText(_ text: String, intoElementWithIdentifier identifier: String, timeout: TimeInterval) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        if self.waitForOptionalElement(
            element,
            identifier: identifier,
            timeout: timeout
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: identifier,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        element.tap()
        element.typeText(text)
    }

    @MainActor
    private func replaceText(_ text: String, inElementWithIdentifier identifier: String, timeout: TimeInterval) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        if self.waitForOptionalElement(
            element,
            identifier: identifier,
            timeout: timeout
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: identifier,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        element.tap()

        if let existingValue = element.value as? String, existingValue.isEmpty == false {
            let deleteSequence = String(repeating: XCUIKeyboardKey.delete.rawValue, count: existingValue.count)
            element.typeText(deleteSequence)
        }

        element.typeText(text)
    }

    @MainActor
    private func tapFirstNavigationBackButton() throws {
        let backButton = self.app.navigationBars.buttons.firstMatch
        if self.waitForOptionalElement(
            backButton,
            identifier: "navigation.backButton",
            timeout: self.shortUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.missingBackButton(
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        backButton.tap()
    }

    @MainActor
    private func assertCurrentWorkspacePickerIsVisible() throws {
        let pickerScreen = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.currentWorkspacePickerScreen)
            .firstMatch
        if self.waitForOptionalElement(
            pickerScreen,
            identifier: LiveSmokeIdentifier.currentWorkspacePickerScreen,
            timeout: self.shortUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.currentWorkspacePickerNotVisible(
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func assertScreenVisible(screen: LiveSmokeScreen, timeout: TimeInterval) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: screen.identifier).firstMatch
        smokeLogger.log(
            "event=screen_assert_start step=\(self.currentStepTitle, privacy: .public) screen=\(screen.title, privacy: .public) identifier=\(screen.identifier, privacy: .public) timeout=\(formatDuration(seconds: timeout), privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
        )
        let startedAt = Date()
        let found = element.waitForExistence(timeout: timeout)
        let durationSeconds = Date().timeIntervalSince(startedAt)
        smokeLogger.log(
            "event=screen_assert_end step=\(self.currentStepTitle, privacy: .public) screen=\(screen.title, privacy: .public) identifier=\(screen.identifier, privacy: .public) found=\(found, privacy: .public) duration=\(formatDuration(seconds: durationSeconds), privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
        )

        if found == false {
            throw LiveSmokeFailure.missingScreen(
                screen: screen.title,
                identifier: screen.identifier,
                timeoutSeconds: timeout,
                currentScreen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func waitForOptionalElement(
        _ element: XCUIElement,
        identifier: String,
        timeout: TimeInterval
    ) -> Bool {
        smokeLogger.log(
            "event=wait_start step=\(self.currentStepTitle, privacy: .public) identifier=\(identifier, privacy: .public) timeout=\(formatDuration(seconds: timeout), privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
        )
        let startedAt = Date()
        let found = element.waitForExistence(timeout: timeout)
        let durationSeconds = Date().timeIntervalSince(startedAt)
        smokeLogger.log(
            "event=wait_end step=\(self.currentStepTitle, privacy: .public) identifier=\(identifier, privacy: .public) found=\(found, privacy: .public) duration=\(formatDuration(seconds: durationSeconds), privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
        )
        return found
    }

    private func registerInterruptionMonitor() -> NSObjectProtocol {
        addUIInterruptionMonitor(withDescription: "Unexpected UI interruption") { [weak self] alert in
            guard let self else {
                return false
            }

            smokeLogger.error(
                "event=ui_interruption step=\(self.currentStepTitle, privacy: .public)"
            )

            for label in ["OK", "Close", "Dismiss", "Cancel", "Not Now", "Allow"] {
                let button = alert.buttons[label]
                if button.exists {
                    button.tap()
                    smokeLogger.log(
                        "event=ui_interruption_handled step=\(self.currentStepTitle, privacy: .public) button=\(label, privacy: .public)"
                    )
                    return true
                }
            }

            return false
        }
    }

    @MainActor
    private func currentScreenSummary() -> String {
        guard self.app != nil else {
            return "screens=[-] nav=[-] alerts=[-] tabs=[-]"
        }

        let visibleScreenTitles = LiveSmokeScreen.allCases
            .filter { screen in
                self.app.descendants(matching: .any).matching(identifier: screen.identifier).firstMatch.exists
            }
            .map(\.title)
            .joined(separator: ", ")
        let navigationTitles = self.app.navigationBars.allElementsBoundByIndex
            .map { element in
                let identifier = element.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
                if identifier.isEmpty {
                    return element.label.trimmingCharacters(in: .whitespacesAndNewlines)
                }
                return identifier
            }
            .filter { $0.isEmpty == false }
            .joined(separator: ", ")
        let alertTitles = self.app.alerts.allElementsBoundByIndex
            .map { element in
                element.label
            }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }
            .joined(separator: ", ")
        let visibleTabs = self.app.tabBars.buttons.allElementsBoundByIndex
            .map { element in
                element.label
            }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }
            .joined(separator: ", ")

        return """
        screens=[\(visibleScreenTitles.isEmpty ? "-" : visibleScreenTitles)] \
        nav=[\(navigationTitles.isEmpty ? "-" : navigationTitles)] \
        alerts=[\(alertTitles.isEmpty ? "-" : alertTitles)] \
        tabs=[\(visibleTabs.isEmpty ? "-" : visibleTabs)]
        """
    }

    @MainActor
    private func attachFailureDiagnostics(stepTitle: String, error: Error, activity: XCTActivity) {
        let screenshotAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshotAttachment.name = "Failure Screenshot - \(stepTitle)"
        screenshotAttachment.lifetime = .keepAlways
        activity.add(screenshotAttachment)

        let hierarchyAttachment = XCTAttachment(string: self.app.debugDescription)
        hierarchyAttachment.name = "UI Hierarchy - \(stepTitle)"
        hierarchyAttachment.lifetime = .keepAlways
        activity.add(hierarchyAttachment)

        let diagnosticsAttachment = self.makeTextAttachment(
            name: "Failure Diagnostics - \(stepTitle)",
            text: """
            Step: \(stepTitle)
            Error: \(error.localizedDescription)
            Current screen: \(self.currentScreenSummary())
            Visible text snapshot: \(self.visibleTextSnapshot())
            """
        )
        activity.add(diagnosticsAttachment)
    }

    private func makeTextAttachment(name: String, text: String) -> XCTAttachment {
        let attachment = XCTAttachment(string: text)
        attachment.name = name
        attachment.lifetime = .keepAlways
        return attachment
    }

    @MainActor
    private func visibleTextSnapshot() -> String {
        let labels = self.app.staticTexts.allElementsBoundByIndex
            .map { element in
                element.label
            }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }

        if labels.isEmpty {
            return "<no visible static text>"
        }

        return labels.joined(separator: " | ")
    }
}
