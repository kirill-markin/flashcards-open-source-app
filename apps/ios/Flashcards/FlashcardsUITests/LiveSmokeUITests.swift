import Foundation
import OSLog
import XCTest

private enum LiveSmokeIdentifier {
    static let cloudWorkspaceChooserScreen: String = "cloudSignIn.workspaceChooserScreen"
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
    static let accountStatusSwitchAccountButton: String = "accountStatus.switchAccountButton"
    static let accountStatusLogoutButton: String = "accountStatus.logoutButton"
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
    static let aiToolCallCompletedStatus: String = "ai.toolCallCompletedStatus"
    static let aiAssistantErrorMessage: String = "ai.assistantErrorMessage"
}

private enum LiveSmokeLaunchResetState: String {
    case localGuest = "local_guest"
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
    case disabledElement(identifier: String, screen: String, step: String)
    case unexpectedElementLabel(identifier: String, expectedLabel: String, actualLabel: String, timeoutSeconds: TimeInterval, screen: String, step: String)
    case missingScreen(screen: String, identifier: String, timeoutSeconds: TimeInterval, currentScreen: String, step: String)
    case missingBackButton(screen: String, step: String)
    case currentWorkspacePickerNotVisible(screen: String, step: String)
    case aiRunDidNotFinish(timeoutSeconds: TimeInterval, screen: String, step: String)
    case aiRunReportedError(message: String, screen: String, step: String)
    case appDidNotReachForeground(timeoutSeconds: TimeInterval, appState: String, step: String)

    var errorDescription: String? {
        switch self {
        case .stepFailed(let title, let durationSeconds, let underlyingMessage):
            return "iOS live smoke step failed: \(title). Duration: \(formatDuration(seconds: durationSeconds)). \(underlyingMessage)"
        case .missingElement(let identifier, let timeoutSeconds, let screen, let step):
            return "Element '\(identifier)' did not appear within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen)"
        case .missingText(let text, let timeoutSeconds, let screen, let step):
            return "Text '\(text)' did not appear within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen)"
        case .disabledElement(let identifier, let screen, let step):
            return "Element '\(identifier)' appeared but was disabled during step '\(step)' on screen: \(screen)"
        case .unexpectedElementLabel(let identifier, let expectedLabel, let actualLabel, let timeoutSeconds, let screen, let step):
            return "Element '\(identifier)' did not reach expected label '\(expectedLabel)' within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen). Actual label: '\(actualLabel)'"
        case .missingScreen(let screen, let identifier, let timeoutSeconds, let currentScreen, let step):
            return "Screen '\(screen)' with root identifier '\(identifier)' did not appear within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)'. Current screen: \(currentScreen)"
        case .missingBackButton(let screen, let step):
            return "Back button did not appear during step '\(step)' on screen: \(screen)"
        case .currentWorkspacePickerNotVisible(let screen, let step):
            return "Current Workspace picker did not appear during step '\(step)'. Current screen: \(screen)"
        case .aiRunDidNotFinish(let timeoutSeconds, let screen, let step):
            return "AI run did not finish within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)'. Current screen: \(screen)"
        case .aiRunReportedError(let message, let screen, let step):
            return "AI run reported an assistant error during step '\(step)'. Current screen: \(screen). Message: \(message)"
        case .appDidNotReachForeground(let timeoutSeconds, let appState, let step):
            return "Application did not reach runningForeground within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)'. App state: \(appState)"
        }
    }
}

private let smokeLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "flashcards-open-source-app",
    category: "ui-smoke"
)

private struct LiveSmokeBreadcrumb {
    let line: String
}

private struct LiveSmokeRunContext {
    let workspaceName: String
    let manualFrontText: String
    let manualBackText: String
    let aiFrontText: String
    let aiBackText: String
    let markerTag: String
}

private func makeLiveSmokeBreadcrumbLine(
    event: String,
    step: String,
    action: String,
    identifier: String,
    timeoutSeconds: String,
    durationSeconds: String,
    screen: String,
    result: String,
    note: String
) -> String {
    let payload: [String: String] = [
        "domain": "ios_ui_smoke",
        "event": event,
        "step": step,
        "action": action,
        "identifier": identifier,
        "timeoutSeconds": timeoutSeconds,
        "durationSeconds": durationSeconds,
        "screen": screen,
        "result": result,
        "note": note
    ]

    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
          let line = String(data: data, encoding: .utf8) else {
        return "{\"domain\":\"ios_ui_smoke\",\"event\":\"serialization_failed\"}"
    }

    return line
}

private func formatDuration(seconds: TimeInterval) -> String {
    String(format: "%.2fs", seconds)
}

final class LiveSmokeUITests: XCTestCase {
    private let shortUiTimeoutSeconds: TimeInterval = 10
    private let longUiTimeoutSeconds: TimeInterval = 30
    private let optionalProbeTimeoutSeconds: TimeInterval = 3
    private let reviewEmailEnvironmentKey: String = "FLASHCARDS_LIVE_REVIEW_EMAIL"
    private let resetStateEnvironmentKey: String = "FLASHCARDS_UI_TEST_RESET_STATE"
    private let maximumStoredBreadcrumbCount: Int = 30

    private var app: XCUIApplication!
    private var currentStepTitle: String = "test bootstrap"
    private var recentBreadcrumbs: [LiveSmokeBreadcrumb] = []

    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        try super.tearDownWithError()
    }

    @MainActor
    func testLiveSmokeManualCardFlow() throws {
        let context = self.makeRunContext(runLabel: "manual-card")
        try self.runLocalScenario {
            try self.step("create one local manual card without login") {
                try self.createManualCard(frontText: context.manualFrontText, backText: context.manualBackText)
            }

            try self.step("verify the local manual card in cards and review it") {
                try self.assertTextExists(context.manualFrontText, timeout: self.longUiTimeoutSeconds)
                try self.reviewCurrentCard(expectedFrontText: context.manualFrontText, maximumSkips: 12)
            }
        }
    }

    @MainActor
    func testLiveSmokeGuestAiCardFlow() throws {
        let context = self.makeRunContext(runLabel: "ai-card")
        try self.runGuestAIScenario {
            try self.step("create one guest AI card with explicit confirmation") {
                try self.createAiCardWithConfirmation(
                    aiFrontText: context.aiFrontText,
                    aiBackText: context.aiBackText,
                    markerTag: context.markerTag
                )
            }

            try self.step("relaunch after guest AI card creation and keep local guest state") {
                try self.relaunchApplication(resetState: nil)
            }

            try self.step("verify the guest AI card is visible in cards and review it after relaunch") {
                try self.openCardsTab()
                try self.assertTextExists(context.aiFrontText, timeout: self.longUiTimeoutSeconds)
                try self.reviewCurrentCard(expectedFrontText: context.aiFrontText, maximumSkips: 12)
            }
        }
    }

    @MainActor
    func testLiveSmokeLocalNavigationFlow() throws {
        try self.runLocalScenario {
            try self.step("verify local navigation surfaces without login") {
                try self.openCardsTab()
                try self.assertElementExists(
                    identifier: LiveSmokeIdentifier.cardsAddButton,
                    timeout: self.shortUiTimeoutSeconds
                )
                try self.openReviewTab()
                try self.openAITab()
                try self.assertAiEntrySurfaceVisible()
                try self.openSettingsTab()
                try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
                try self.openAccountStatus()
                try self.assertElementExists(
                    identifier: LiveSmokeIdentifier.accountStatusSignInButton,
                    timeout: self.longUiTimeoutSeconds
                )
                try self.tapFirstNavigationBackButton()
                try self.tapFirstNavigationBackButton()
            }
        }
    }

    @MainActor
    func testLiveSmokeLoginAndLinkedWorkspaceFlow() throws {
        let context = self.makeRunContext(runLabel: "login-linked-workspace")
        let reviewEmail = ProcessInfo.processInfo.environment[self.reviewEmailEnvironmentKey] ?? "apple-review@example.com"
        try self.runSignedInLinkedWorkspaceScenario(context: context, reviewEmail: reviewEmail) {
            try self.step("verify linked account status and workspace state") {
                try self.openSettingsTab()
                try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
                try self.assertTextExists(context.workspaceName, timeout: self.longUiTimeoutSeconds)
                try self.openAccountStatus()
                try self.assertTextExists(reviewEmail, timeout: self.longUiTimeoutSeconds)
                try self.assertElementExists(
                    identifier: LiveSmokeIdentifier.accountStatusSyncNowButton,
                    timeout: self.longUiTimeoutSeconds
                )
                try self.tapFirstNavigationBackButton()
                try self.tapFirstNavigationBackButton()
            }

            try self.step("relaunch the app and keep the linked session") {
                try self.relaunchApplication(resetState: nil)
                try self.openSettingsTab()
                try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
                try self.assertTextExists(context.workspaceName, timeout: self.longUiTimeoutSeconds)
                try self.openAccountStatus()
                try self.assertTextExists(reviewEmail, timeout: self.longUiTimeoutSeconds)
                try self.assertElementExists(
                    identifier: LiveSmokeIdentifier.accountStatusSyncNowButton,
                    timeout: self.longUiTimeoutSeconds
                )
                try self.tapFirstNavigationBackButton()
                try self.tapFirstNavigationBackButton()
            }
        }
    }

    @MainActor
    private func makeRunContext(runLabel: String) -> LiveSmokeRunContext {
        let runId = "\(runLabel)-\(String(Int(Date().timeIntervalSince1970)))-\(UUID().uuidString.lowercased())"

        return LiveSmokeRunContext(
            workspaceName: "E2E ios \(runId)",
            manualFrontText: "Manual e2e ios \(runId)",
            manualBackText: "Manual answer e2e ios \(runId)",
            aiFrontText: "AI e2e ios \(runId)",
            aiBackText: "AI answer e2e ios \(runId)",
            markerTag: "e2e-ios-\(runId)"
        )
    }

    @MainActor
    private func runLocalScenario(
        scenario: () throws -> Void
    ) throws {
        try self.launchApplication(resetState: .localGuest)
        try scenario()
    }

    @MainActor
    private func runGuestAIScenario(
        scenario: () throws -> Void
    ) throws {
        try self.launchApplication(resetState: .localGuest)
        try scenario()
    }

    @MainActor
    private func runSignedInLinkedWorkspaceScenario(
        context: LiveSmokeRunContext,
        reviewEmail: String,
        scenario: () throws -> Void
    ) throws {
        try self.launchApplication(resetState: nil)

        var primaryFailure: Error?
        var shouldDeleteWorkspace = false

        do {
            try self.step("sign in with the configured review account") {
                try self.signInWithReviewAccount(reviewEmail: reviewEmail)
            }

            try self.step("create an isolated linked workspace for this run") {
                try self.createEphemeralWorkspace(workspaceName: context.workspaceName)
                shouldDeleteWorkspace = true
            }

            try scenario()
        } catch {
            primaryFailure = error
        }

        if shouldDeleteWorkspace {
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
                    Breadcrumbs:
                    \(self.recentBreadcrumbLines())
                    """
                )
                self.add(cleanupDiagnostics)
                smokeLogger.error(
                    "event=cleanup_failure_after_primary step=\(self.currentStepTitle, privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public) error=\(error.localizedDescription, privacy: .public)"
                )
            }
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
            self.logSmokeBreadcrumb(
                event: "step_start",
                action: "step",
                identifier: "-",
                timeoutSeconds: "-",
                durationSeconds: "-",
                result: "start",
                note: title
            )
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
                self.logSmokeBreadcrumb(
                    event: "step_end",
                    action: "step",
                    identifier: "-",
                    timeoutSeconds: "-",
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: title
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
                        Breadcrumbs:
                        \(self.recentBreadcrumbLines())
                        """
                    )
                )
                self.attachFailureDiagnostics(stepTitle: title, error: error, activity: activity)
                self.logSmokeBreadcrumb(
                    event: "step_end",
                    action: "step",
                    identifier: "-",
                    timeoutSeconds: "-",
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "failure",
                    note: error.localizedDescription
                )
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
    private func launchApplication(resetState: LiveSmokeLaunchResetState?) throws {
        self.app = XCUIApplication()
        self.configureLaunchEnvironment(resetState: resetState)
        self.logActionStart(action: "launch_app", identifier: "application")
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: self.shortUiTimeoutSeconds)
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "launch_app", identifier: "application", result: "success", note: "application launched")
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
            timeout: self.optionalProbeTimeoutSeconds
        ) {
            self.logActionStart(action: "tap_element", identifier: LiveSmokeIdentifier.accountStatusSignInButton)
            signInButton.tap()
            _ = self.dismissKnownBlockingAlertIfVisible()
            self.logActionEnd(action: "tap_element", identifier: LiveSmokeIdentifier.accountStatusSignInButton, result: "success", note: "sign in tapped")
            try self.typeText(
                reviewEmail,
                intoElementWithIdentifier: LiveSmokeIdentifier.cloudSignInEmailField,
                timeout: self.shortUiTimeoutSeconds
            )
            try self.tapElement(
                identifier: LiveSmokeIdentifier.cloudSignInSendCodeButton,
                timeout: self.shortUiTimeoutSeconds
            )
            try self.completeCloudWorkspaceSelectionIfNeeded()
        } else if self.isAccountStatusLinked() {
            let visibleEmail = self.visibleLinkedEmailLabel()
            if visibleEmail != reviewEmail {
                try self.logoutFromAccountStatus()
                try self.assertElementExists(
                    identifier: LiveSmokeIdentifier.accountStatusSignInButton,
                    timeout: self.shortUiTimeoutSeconds
                )
                try self.signInWithReviewAccount(reviewEmail: reviewEmail)
                return
            }
        }

        try self.assertTextExists(reviewEmail, timeout: self.longUiTimeoutSeconds)
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
    private func reviewCurrentCard(expectedFrontText: String, maximumSkips: Int) throws {
        try self.openReviewTab()

        for _ in 0...maximumSkips {
            if self.app.staticTexts[expectedFrontText].exists {
                try self.tapElement(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: self.shortUiTimeoutSeconds)
                try self.tapElement(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: self.shortUiTimeoutSeconds)
                return
            }

            try self.tapElement(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: self.shortUiTimeoutSeconds)
            try self.tapElement(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: self.shortUiTimeoutSeconds)
        }

        throw LiveSmokeFailure.missingText(
            text: expectedFrontText,
            timeoutSeconds: self.shortUiTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
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
            timeout: self.optionalProbeTimeoutSeconds
        ) {
            self.logActionStart(action: "tap_element", identifier: LiveSmokeIdentifier.aiConsentAcceptButton)
            aiConsentButton.tap()
            _ = self.dismissKnownBlockingAlertIfVisible()
            self.logActionEnd(action: "tap_element", identifier: LiveSmokeIdentifier.aiConsentAcceptButton, result: "success", note: "AI consent accepted")
        }

        let proposalErrorMarkerCountBeforeWait = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiAssistantErrorMessage)
            .allElementsBoundByIndex.count
        let proposalPrompt = "Prepare exactly one flashcard proposal. Use front text \"\(aiFrontText)\", back text \"\(aiBackText)\", and include tag \"\(markerTag)\". Wait for my confirmation before creating it."
        try self.replaceText(
            proposalPrompt,
            inElementWithIdentifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertElementEnabled(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: self.shortUiTimeoutSeconds
        )
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionStart(action: "ai_send_1", identifier: LiveSmokeIdentifier.aiComposerSendButton)
        try self.tapElement(identifier: LiveSmokeIdentifier.aiComposerSendButton, timeout: self.shortUiTimeoutSeconds)
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "ai_send_1", identifier: LiveSmokeIdentifier.aiComposerSendButton, result: "success", note: "proposal request sent")
        try self.assertVisibleTextContains(
            aiFrontText,
            timeout: self.longUiTimeoutSeconds,
            aiErrorMarkerCountBeforeWait: proposalErrorMarkerCountBeforeWait,
            ignoredExactLabels: [proposalPrompt]
        )
        try self.assertVisibleTextContains(
            aiBackText,
            timeout: self.longUiTimeoutSeconds,
            aiErrorMarkerCountBeforeWait: proposalErrorMarkerCountBeforeWait,
            ignoredExactLabels: [proposalPrompt]
        )
        try self.assertVisibleTextContains(
            markerTag,
            timeout: self.longUiTimeoutSeconds,
            aiErrorMarkerCountBeforeWait: proposalErrorMarkerCountBeforeWait,
            ignoredExactLabels: [proposalPrompt]
        )

        try self.replaceText(
            "Confirmed. Create the card exactly as proposed.",
            inElementWithIdentifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: self.shortUiTimeoutSeconds
        )
        let completedMarkerCountBeforeConfirmation = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus)
            .allElementsBoundByIndex.count
        let errorMarkerCountBeforeConfirmation = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiAssistantErrorMessage)
            .allElementsBoundByIndex.count
        try self.assertElementEnabled(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: self.shortUiTimeoutSeconds
        )
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionStart(action: "ai_send_2", identifier: LiveSmokeIdentifier.aiComposerSendButton)
        try self.tapElement(identifier: LiveSmokeIdentifier.aiComposerSendButton, timeout: self.shortUiTimeoutSeconds)
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "ai_send_2", identifier: LiveSmokeIdentifier.aiComposerSendButton, result: "success", note: "confirmation request sent")
        try self.assertElementLabel(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            expectedLabel: "Stop response",
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertAiRunFinished(
            timeout: self.longUiTimeoutSeconds,
            completedMarkerCountBeforeWait: completedMarkerCountBeforeConfirmation,
            errorMarkerCountBeforeWait: errorMarkerCountBeforeConfirmation
        )
        try self.assertElementLabel(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            expectedLabel: "Send message",
            timeout: self.longUiTimeoutSeconds
        )
    }

    @MainActor
    private func deleteEphemeralWorkspace() throws {
        self.logSmokeBreadcrumb(
            event: "cleanup_start",
            action: "delete_workspace",
            identifier: "-",
            timeoutSeconds: "-",
            durationSeconds: "-",
            result: "start",
            note: "cleanup begins"
        )
        smokeLogger.log(
            "event=cleanup_start step=\(self.currentStepTitle, privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
        )
        _ = self.dismissKnownBlockingAlertIfVisible()
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
        self.logActionStart(action: "tap_element", identifier: "alert.continueButton")
        continueButton.tap()
        self.logActionEnd(action: "tap_element", identifier: "alert.continueButton", result: "success", note: "continue alert tapped")

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
        self.logSmokeBreadcrumb(
            event: "cleanup_end",
            action: "delete_workspace",
            identifier: LiveSmokeIdentifier.deleteWorkspaceConfirmationButton,
            timeoutSeconds: formatDuration(seconds: self.longUiTimeoutSeconds),
            durationSeconds: "-",
            result: "success",
            note: "cleanup finished"
        )
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
    private func ensureAccountIsNotLinked() throws {
        try self.openSettingsTab()
        try self.openAccountStatus()

        if self.isAccountStatusLinked() {
            try self.logoutFromAccountStatus()
        }

        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.accountStatusSignInButton,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapFirstNavigationBackButton()
    }

    @MainActor
    private func assertAiEntrySurfaceVisible() throws {
        let consentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            consentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: self.optionalProbeTimeoutSeconds
        ) {
            return
        }

        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: self.longUiTimeoutSeconds
        )
    }

    @MainActor
    private func tapTabButton(named name: String) throws {
        let tabButton = self.app.tabBars.buttons[name]
        if self.waitForOptionalHittableElement(
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
        self.logActionStart(action: "tap_tab", identifier: "tab.\(name)")
        tabButton.tap()
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "tap_tab", identifier: "tab.\(name)", result: "success", note: "tab tapped")
    }

    @MainActor
    private func tapButton(named name: String, timeout: TimeInterval) throws {
        let button = self.app.buttons[name].firstMatch
        if self.waitForOptionalHittableElement(
            button,
            identifier: "button.\(name)",
            timeout: timeout
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: "button.\(name)",
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        self.logActionStart(action: "tap_button", identifier: "button.\(name)")
        button.tap()
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "tap_button", identifier: "button.\(name)", result: "success", note: "button tapped")
    }

    @MainActor
    private func tapElement(identifier: String, timeout: TimeInterval) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        if self.waitForOptionalHittableElement(
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
        self.logActionStart(action: "tap_element", identifier: identifier)
        element.tap()
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "tap_element", identifier: identifier, result: "success", note: "element tapped")
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
    private func assertVisibleTextContains(
        _ text: String,
        timeout: TimeInterval,
        aiErrorMarkerCountBeforeWait: Int,
        ignoredExactLabels: Set<String>
    ) throws {
        let errorElements = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiAssistantErrorMessage)
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_visible_text_contains",
            identifier: "text.contains.\(text)",
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "waiting for visible text substring"
        )

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            let visibleLabels = self.app.staticTexts.allElementsBoundByIndex
                .map(\.label)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { $0.isEmpty == false }
                .filter { ignoredExactLabels.contains($0) == false }
            if visibleLabels.contains(where: { $0.contains(text) }) {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_visible_text_contains",
                    identifier: "text.contains.\(text)",
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "visible text substring appeared"
                )
                return
            }

            let errorMarkerCount = errorElements.allElementsBoundByIndex.count
            if errorMarkerCount > aiErrorMarkerCountBeforeWait {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                let errorMessage = errorElements.allElementsBoundByIndex.last?.label.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_visible_text_contains",
                    identifier: LiveSmokeIdentifier.aiAssistantErrorMessage,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "failure",
                    note: errorMessage
                )
                throw LiveSmokeFailure.aiRunReportedError(
                    message: errorMessage.isEmpty ? "Assistant error message is empty." : errorMessage,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_visible_text_contains",
            identifier: "text.contains.\(text)",
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: "failure",
            note: "visible text substring did not appear"
        )
        throw LiveSmokeFailure.missingText(
            text: text,
            timeoutSeconds: timeout,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func assertElementEnabled(identifier: String, timeout: TimeInterval) throws {
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

        if element.isEnabled == false {
            throw LiveSmokeFailure.disabledElement(
                identifier: identifier,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func assertElementLabel(
        identifier: String,
        expectedLabel: String,
        timeout: TimeInterval
    ) throws {
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

        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)
        var lastObservedLabel = element.label
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_element_label",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: expectedLabel
        )

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()
            lastObservedLabel = element.label
            if lastObservedLabel == expectedLabel {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_element_label",
                    identifier: identifier,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: expectedLabel
                )
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_element_label",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: "failure",
            note: "expected=\(expectedLabel) actual=\(lastObservedLabel)"
        )
        throw LiveSmokeFailure.unexpectedElementLabel(
            identifier: identifier,
            expectedLabel: expectedLabel,
            actualLabel: lastObservedLabel,
            timeoutSeconds: timeout,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
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
        self.logActionStart(action: "type_text", identifier: identifier)
        element.tap()
        element.typeText(text)
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "type_text", identifier: identifier, result: "success", note: "text typed")
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
        self.logActionStart(action: "replace_text", identifier: identifier)
        element.tap()

        if let existingValue = element.value as? String, existingValue.isEmpty == false {
            let deleteSequence = String(repeating: XCUIKeyboardKey.delete.rawValue, count: existingValue.count)
            element.typeText(deleteSequence)
        }

        element.typeText(text)
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "replace_text", identifier: identifier, result: "success", note: "text replaced")
    }

    @MainActor
    private func tapFirstNavigationBackButton() throws {
        let backButton = self.app.navigationBars.buttons.firstMatch
        if self.waitForOptionalHittableElement(
            backButton,
            identifier: "navigation.backButton",
            timeout: self.shortUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.missingBackButton(
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        self.logActionStart(action: "tap_back_button", identifier: "navigation.backButton")
        backButton.tap()
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "tap_back_button", identifier: "navigation.backButton", result: "success", note: "back tapped")
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
        if timeout >= self.longUiTimeoutSeconds {
            _ = self.dismissKnownBlockingAlertIfVisible()
        }
        self.logSmokeBreadcrumb(
            event: "screen_assert_start",
            action: "assert_screen",
            identifier: screen.identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: screen.title
        )
        smokeLogger.log(
            "event=screen_assert_start step=\(self.currentStepTitle, privacy: .public) screen=\(screen.title, privacy: .public) identifier=\(screen.identifier, privacy: .public) timeout=\(formatDuration(seconds: timeout), privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
        )
        let startedAt = Date()
        let found = element.waitForExistence(timeout: timeout)
        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "screen_assert_end",
            action: "assert_screen",
            identifier: screen.identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: found ? "success" : "failure",
            note: screen.title
        )
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
        if timeout >= self.longUiTimeoutSeconds {
            _ = self.dismissKnownBlockingAlertIfVisible()
        }
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_element",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "wait begins"
        )
        smokeLogger.log(
            "event=wait_start step=\(self.currentStepTitle, privacy: .public) identifier=\(identifier, privacy: .public) timeout=\(formatDuration(seconds: timeout), privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
        )
        let startedAt = Date()
        let found = element.waitForExistence(timeout: timeout)
        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_element",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: found ? "success" : "failure",
            note: "wait finished"
        )
        smokeLogger.log(
            "event=wait_end step=\(self.currentStepTitle, privacy: .public) identifier=\(identifier, privacy: .public) found=\(found, privacy: .public) duration=\(formatDuration(seconds: durationSeconds), privacy: .public) currentScreen=\(self.currentScreenSummary(), privacy: .public)"
        )
        return found
    }

    @MainActor
    private func waitForOptionalHittableElement(
        _ element: XCUIElement,
        identifier: String,
        timeout: TimeInterval
    ) -> Bool {
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)

        if self.waitForOptionalElement(
            element,
            identifier: identifier,
            timeout: timeout
        ) == false {
            return false
        }

        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_hittable_element",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "waiting for hittable element"
        )

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()
            if element.isHittable {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_hittable_element",
                    identifier: identifier,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "element became hittable"
                )
                return true
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_hittable_element",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: "failure",
            note: "element did not become hittable"
        )
        return false
    }

    @MainActor
    private func dismissKnownBlockingAlertIfVisible() -> Bool {
        guard self.app != nil else {
            return false
        }
        guard self.isApplicationRunning else {
            return false
        }

        let alert = self.app.alerts.firstMatch
        guard alert.exists else {
            return false
        }

        for label in ["OK", "Close", "Dismiss", "Cancel", "Not Now", "Allow"] {
            let button = alert.buttons[label]
            guard button.exists else {
                continue
            }

            button.tap()
            self.logSmokeBreadcrumb(
                event: "alert_dismissed",
                action: "dismiss_alert",
                identifier: label,
                timeoutSeconds: "-",
                durationSeconds: "-",
                result: "success",
                note: "known alert button tapped"
            )
            return true
        }

        return false
    }

    @MainActor
    private func currentScreenSummary() -> String {
        guard self.app != nil else {
            return "appState=uninitialized screens=[-]"
        }
        guard self.isApplicationRunning else {
            return "appState=\(self.appStateDescription()) screens=[-]"
        }

        let visibleScreenTitles = LiveSmokeScreen.allCases
            .filter { screen in
                self.app.descendants(matching: .any).matching(identifier: screen.identifier).firstMatch.exists
            }
            .map(\.title)
            .joined(separator: ", ")

        return """
        appState=\(self.appStateDescription()) \
        screens=[\(visibleScreenTitles.isEmpty ? "-" : visibleScreenTitles)]
        """
    }

    @MainActor
    private func attachFailureDiagnostics(stepTitle: String, error: Error, activity: XCTActivity) {
        if self.isApplicationRunning {
            let screenshotAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshotAttachment.name = "Failure Screenshot - \(stepTitle)"
            screenshotAttachment.lifetime = .keepAlways
            activity.add(screenshotAttachment)
        }

        let hierarchyAttachment = XCTAttachment(string: self.appDebugHierarchy())
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
            Breadcrumbs:
            \(self.recentBreadcrumbLines())
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
        guard self.app != nil else {
            return "<app not initialized>"
        }
        guard self.isApplicationRunning else {
            return "<app not running>"
        }

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

    @MainActor
    private func appDebugHierarchy() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }
        guard self.isApplicationRunning else {
            return "<app not running>"
        }

        return self.app.debugDescription
    }

    @MainActor
    private func logSmokeBreadcrumb(
        event: String,
        action: String,
        identifier: String,
        timeoutSeconds: String,
        durationSeconds: String,
        result: String,
        note: String,
        captureScreenSummary: Bool = true,
        screenOverride: String? = nil
    ) {
        let screen = screenOverride ?? (captureScreenSummary ? self.currentScreenSummary() : "screens=[-] nav=[-] alerts=[-] tabs=[-]")
        let line = makeLiveSmokeBreadcrumbLine(
            event: event,
            step: self.currentStepTitle,
            action: action,
            identifier: identifier,
            timeoutSeconds: timeoutSeconds,
            durationSeconds: durationSeconds,
            screen: screen,
            result: result,
            note: note
        )
        self.appendBreadcrumb(line: line)
        fputs(line + "\n", stderr)
        smokeLogger.log("\(line, privacy: .public)")
    }

    @MainActor
    private func appendBreadcrumb(line: String) {
        self.recentBreadcrumbs.append(LiveSmokeBreadcrumb(line: line))
        if self.recentBreadcrumbs.count > self.maximumStoredBreadcrumbCount {
            self.recentBreadcrumbs.removeFirst(self.recentBreadcrumbs.count - self.maximumStoredBreadcrumbCount)
        }
    }

    @MainActor
    private func recentBreadcrumbLines() -> String {
        if self.recentBreadcrumbs.isEmpty {
            return "<no breadcrumbs>"
        }

        return self.recentBreadcrumbs.map(\.line).joined(separator: "\n")
    }

    @MainActor
    private func logActionStart(action: String, identifier: String) {
        self.logSmokeBreadcrumb(
            event: "action_start",
            action: action,
            identifier: identifier,
            timeoutSeconds: "-",
            durationSeconds: "-",
            result: "start",
            note: "action started"
        )
    }

    @MainActor
    private func logActionEnd(
        action: String,
        identifier: String,
        result: String,
        note: String,
        captureScreenSummary: Bool = true,
        screenOverride: String? = nil
    ) {
        self.logSmokeBreadcrumb(
            event: "action_end",
            action: action,
            identifier: identifier,
            timeoutSeconds: "-",
            durationSeconds: "-",
            result: result,
            note: note,
            captureScreenSummary: captureScreenSummary,
            screenOverride: screenOverride
        )
    }

    @MainActor
    private func waitForApplicationToReachForeground(timeout: TimeInterval) throws {
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_app_foreground",
            identifier: "application",
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "waiting for runningForeground",
            captureScreenSummary: false,
            screenOverride: "appState=\(self.appStateDescription()) screens=[-] nav=[-] alerts=[-] tabs=[-]"
        )
        let startedAt = Date()
        let reachedForeground = self.app.wait(for: .runningForeground, timeout: timeout)
        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_app_foreground",
            identifier: "application",
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: reachedForeground ? "success" : "failure",
            note: "foreground wait finished",
            captureScreenSummary: reachedForeground,
            screenOverride: reachedForeground ? nil : "appState=\(self.appStateDescription()) screens=[-] nav=[-] alerts=[-] tabs=[-]"
        )

        if reachedForeground == false {
            throw LiveSmokeFailure.appDidNotReachForeground(
                timeoutSeconds: timeout,
                appState: self.appStateDescription(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func relaunchApplication(resetState: LiveSmokeLaunchResetState?) throws {
        self.logActionStart(action: "terminate_app", identifier: "application")
        self.app.terminate()
        self.logActionEnd(
            action: "terminate_app",
            identifier: "application",
            result: "success",
            note: "application terminated",
            captureScreenSummary: false,
            screenOverride: "appState=notRunning screens=[-] nav=[-] alerts=[-] tabs=[-]"
        )
        self.logActionStart(action: "relaunch_app", identifier: "application")
        self.configureLaunchEnvironment(resetState: resetState)
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: self.shortUiTimeoutSeconds)
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "relaunch_app", identifier: "application", result: "success", note: "application relaunched")
    }

    @MainActor
    private func configureLaunchEnvironment(resetState: LiveSmokeLaunchResetState?) {
        self.app.launchEnvironment.removeValue(forKey: self.resetStateEnvironmentKey)
        if let resetState {
            self.app.launchEnvironment[self.resetStateEnvironmentKey] = resetState.rawValue
        }
    }

    @MainActor
    private func isAccountStatusLinked() -> Bool {
        let syncNowButton = self.app.buttons[LiveSmokeIdentifier.accountStatusSyncNowButton]
        return self.waitForOptionalElement(
            syncNowButton,
            identifier: LiveSmokeIdentifier.accountStatusSyncNowButton,
            timeout: self.optionalProbeTimeoutSeconds
        )
    }

    @MainActor
    private func visibleLinkedEmailLabel() -> String? {
        let linkedEmailLabel = self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "@")).firstMatch
        if self.waitForOptionalElement(
            linkedEmailLabel,
            identifier: "text.linkedEmail",
            timeout: self.optionalProbeTimeoutSeconds
        ) {
            return linkedEmailLabel.label
        }

        return nil
    }

    @MainActor
    private func logoutFromAccountStatus() throws {
        try self.tapElement(
            identifier: LiveSmokeIdentifier.accountStatusLogoutButton,
            timeout: self.shortUiTimeoutSeconds
        )

        let confirmationButton = self.app.alerts.buttons["Log out"]
        if self.waitForOptionalHittableElement(
            confirmationButton,
            identifier: "alert.logoutButton",
            timeout: self.shortUiTimeoutSeconds
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: "alert.logoutButton",
                timeoutSeconds: self.shortUiTimeoutSeconds,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        self.logActionStart(action: "tap_element", identifier: "alert.logoutButton")
        confirmationButton.tap()
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "tap_element", identifier: "alert.logoutButton", result: "success", note: "logout confirmed")
    }

    @MainActor
    private func completeCloudWorkspaceSelectionIfNeeded() throws {
        let deadline = Date().addingTimeInterval(self.longUiTimeoutSeconds)
        let existingWorkspacePredicate = NSPredicate(
            format: "identifier BEGINSWITH %@",
            "cloudSignIn.existingWorkspace."
        )

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            if self.isAccountStatusLinked() {
                return
            }

            let chooserScreen = self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.cloudWorkspaceChooserScreen)
                .firstMatch
            let chooserVisible = self.waitForOptionalElement(
                chooserScreen,
                identifier: LiveSmokeIdentifier.cloudWorkspaceChooserScreen,
                timeout: self.optionalProbeTimeoutSeconds
            )

            if chooserVisible {
                let existingWorkspaceButton = self.app.buttons.matching(existingWorkspacePredicate).firstMatch
                if self.waitForOptionalHittableElement(
                    existingWorkspaceButton,
                    identifier: "cloudSignIn.existingWorkspace.first",
                    timeout: self.optionalProbeTimeoutSeconds
                ) {
                    self.logActionStart(action: "tap_element", identifier: "cloudSignIn.existingWorkspace.first")
                    existingWorkspaceButton.tap()
                    _ = self.dismissKnownBlockingAlertIfVisible()
                    self.logActionEnd(
                        action: "tap_element",
                        identifier: "cloudSignIn.existingWorkspace.first",
                        result: "success",
                        note: "existing workspace tapped"
                    )
                    continue
                }

                let createWorkspaceButton = self.app.buttons[LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton]
                if self.waitForOptionalHittableElement(
                    createWorkspaceButton,
                    identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton,
                    timeout: self.optionalProbeTimeoutSeconds
                ) {
                    self.logActionStart(action: "tap_element", identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton)
                    createWorkspaceButton.tap()
                    _ = self.dismissKnownBlockingAlertIfVisible()
                    self.logActionEnd(
                        action: "tap_element",
                        identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton,
                        result: "success",
                        note: "create workspace tapped"
                    )
                    continue
                }
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }
    }

    @MainActor
    private var isApplicationRunning: Bool {
        guard self.app != nil else {
            return false
        }

        switch self.app.state {
        case .runningForeground:
            return true
        case .unknown, .notRunning, .runningBackground, .runningBackgroundSuspended:
            return false
        @unknown default:
            return false
        }
    }

    @MainActor
    private func appStateDescription() -> String {
        guard self.app != nil else {
            return "uninitialized"
        }

        switch self.app.state {
        case .unknown:
            return "unknown"
        case .notRunning:
            return "notRunning"
        case .runningBackgroundSuspended:
            return "runningBackgroundSuspended"
        case .runningBackground:
            return "runningBackground"
        case .runningForeground:
            return "runningForeground"
        @unknown default:
            return "unknownFutureState"
        }
    }

    @MainActor
    private func assertAiRunFinished(
        timeout: TimeInterval,
        completedMarkerCountBeforeWait: Int,
        errorMarkerCountBeforeWait: Int
    ) throws {
        let completedElements = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus)
        let errorElements = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiAssistantErrorMessage)
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_ai_completion",
            identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "waiting for AI completion or error"
        )

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            let completedMarkerCount = completedElements.allElementsBoundByIndex.count
            if completedMarkerCount > completedMarkerCountBeforeWait {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_ai_completion",
                    identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "AI completion marker appeared"
                )
                return
            }

            let errorMarkerCount = errorElements.allElementsBoundByIndex.count
            if errorMarkerCount > errorMarkerCountBeforeWait {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                let errorMessage = errorElements.allElementsBoundByIndex.last?.label.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_ai_completion",
                    identifier: LiveSmokeIdentifier.aiAssistantErrorMessage,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "failure",
                    note: errorMessage
                )
                throw LiveSmokeFailure.aiRunReportedError(
                    message: errorMessage.isEmpty ? "Assistant error message is empty." : errorMessage,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_ai_completion",
            identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: "failure",
            note: "AI completion markers did not appear"
        )
        throw LiveSmokeFailure.aiRunDidNotFinish(
            timeoutSeconds: timeout,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }
}
