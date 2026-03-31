import Foundation
import OSLog
import XCTest

private enum LiveSmokeIdentifier {
    static let cloudWorkspaceChooserScreen: String = "cloudSignIn.workspaceChooserScreen"
    static let cloudSignInScreen: String = "cloudSignIn.screen"
    static let reviewScreen: String = "review.screen"
    static let cardsScreen: String = "cards.screen"
    static let aiScreen: String = "ai.screen"
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
    static let cardEditorScreen: String = "cardEditor.screen"
    static let cardEditorFrontRow: String = "cardEditor.frontRow"
    static let cardEditorBackRow: String = "cardEditor.backRow"
    static let cardEditorSaveButton: String = "cardEditor.saveButton"
    static let cardEditorFrontTextEditor: String = "cardEditor.frontTextEditor"
    static let cardEditorBackTextEditor: String = "cardEditor.backTextEditor"
    static let reviewShowAnswerButton: String = "review.showAnswerButton"
    static let reviewRateGoodButton: String = "review.rateGoodButton"
    static let aiConsentAcceptButton: String = "ai.consentAcceptButton"
    static let aiNewChatButton: String = "ai.newChatButton"
    static let aiEmptyState: String = "ai.emptyState"
    static let aiMessageRow: String = "ai.messageRow"
    static let aiComposerTextField: String = "ai.composerTextField"
    static let aiComposerSendButton: String = "ai.composerSendButton"
    static let aiToolCallSummary: String = "ai.toolCallSummary"
    static let aiToolCallRequestText: String = "ai.toolCallRequestText"
    static let aiToolCallResponseText: String = "ai.toolCallResponseText"
    static let aiToolCallCompletedStatus: String = "ai.toolCallCompletedStatus"
    static let aiAssistantErrorMessage: String = "ai.assistantErrorMessage"
}

private enum LiveSmokeLaunchResetState: String {
    case localGuest = "local_guest"
    case localGuestSeededManualReviewCard = "local_guest_seeded_manual_review_card"
    case localGuestSeededAIReviewCard = "local_guest_seeded_ai_review_card"
}

private enum LiveSmokeSelectedTab: String {
    case review
    case cards
    case ai
    case settings

    var screen: LiveSmokeScreen {
        switch self {
        case .review:
            return .review
        case .cards:
            return .cards
        case .ai:
            return .ai
        case .settings:
            return .settings
        }
    }
}

private enum LiveSmokeScreen: CaseIterable {
    case review
    case cards
    case ai
    case settings
    case currentWorkspace
    case workspaceSettings
    case workspaceOverview
    case accountSettings
    case accountStatus

    var identifier: String {
        switch self {
        case .review:
            return LiveSmokeIdentifier.reviewScreen
        case .cards:
            return LiveSmokeIdentifier.cardsScreen
        case .ai:
            return LiveSmokeIdentifier.aiScreen
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
        case .review:
            return "Review"
        case .cards:
            return "Cards"
        case .ai:
            return "AI"
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
    case textInputNotReady(
        identifier: String,
        timeoutSeconds: TimeInterval,
        screen: String,
        step: String,
        exists: Bool,
        hittable: Bool,
        hasKeyboardFocus: Bool,
        softwareKeyboardVisible: Bool,
        elementLabel: String,
        elementValue: String
    )
    case unexpectedElementLabel(identifier: String, expectedLabel: String, actualLabel: String, timeoutSeconds: TimeInterval, screen: String, step: String)
    case unexpectedElementValue(identifier: String, expectedValue: String, actualValue: String, timeoutSeconds: TimeInterval, screen: String, step: String)
    case missingScreen(screen: String, identifier: String, timeoutSeconds: TimeInterval, currentScreen: String, step: String)
    case missingBackButton(screen: String, step: String)
    case currentWorkspacePickerNotVisible(screen: String, step: String)
    case unexpectedAccountState(message: String, screen: String, step: String)
    case unexpectedReviewState(message: String, screen: String, step: String)
    case aiRunDidNotFinish(timeoutSeconds: TimeInterval, screen: String, step: String)
    case aiRunReportedError(message: String, screen: String, step: String)
    case unexpectedAiConversationState(message: String, screen: String, step: String)
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
        case .textInputNotReady(
            let identifier,
            let timeoutSeconds,
            let screen,
            let step,
            let exists,
            let hittable,
            let hasKeyboardFocus,
            let softwareKeyboardVisible,
            let elementLabel,
            let elementValue
        ):
            return "Text input '\(identifier)' was not ready within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen). exists=\(exists) hittable=\(hittable) hasKeyboardFocus=\(hasKeyboardFocus) softwareKeyboardVisible=\(softwareKeyboardVisible) label='\(elementLabel)' value='\(elementValue)'"
        case .unexpectedElementLabel(let identifier, let expectedLabel, let actualLabel, let timeoutSeconds, let screen, let step):
            return "Element '\(identifier)' did not reach expected label '\(expectedLabel)' within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen). Actual label: '\(actualLabel)'"
        case .unexpectedElementValue(let identifier, let expectedValue, let actualValue, let timeoutSeconds, let screen, let step):
            return "Element '\(identifier)' did not reach expected value '\(expectedValue)' within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen). Actual value: '\(actualValue)'"
        case .missingScreen(let screen, let identifier, let timeoutSeconds, let currentScreen, let step):
            return "Screen '\(screen)' with root identifier '\(identifier)' did not appear within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)'. Current screen: \(currentScreen)"
        case .missingBackButton(let screen, let step):
            return "Back button did not appear during step '\(step)' on screen: \(screen)"
        case .currentWorkspacePickerNotVisible(let screen, let step):
            return "Current Workspace picker did not appear during step '\(step)'. Current screen: \(screen)"
        case .unexpectedAccountState(let message, let screen, let step):
            return "Account state was unexpected during step '\(step)'. Current screen: \(screen). \(message)"
        case .unexpectedReviewState(let message, let screen, let step):
            return "Review screen reached an unexpected state during step '\(step)'. Current screen: \(screen). \(message)"
        case .aiRunDidNotFinish(let timeoutSeconds, let screen, let step):
            return "AI run did not finish within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)'. Current screen: \(screen)"
        case .aiRunReportedError(let message, let screen, let step):
            return "AI run reported an assistant error during step '\(step)'. Current screen: \(screen). Message: \(message)"
        case .unexpectedAiConversationState(let message, let screen, let step):
            return "AI conversation reached an unexpected state during step '\(step)'. Current screen: \(screen). \(message)"
        case .appDidNotReachForeground(let timeoutSeconds, let appState, let step):
            return "Application did not reach runningForeground within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)'. App state: \(appState)"
        }
    }
}

private let smokeLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "flashcards-open-source-app",
    category: "ui-smoke"
)
private let aiComposerPlaceholderText: String = "Ask about cards, review history, or propose a change..."
private let aiCreatePromptText: String = "I give you all permissions. Please create one test flashcard now."
private let aiResetPromptText: String = "Please reply with one short sentence so I can verify this chat resets."
private let aiCreatePromptMaximumAttempts: Int = 3
private let liveSmokeFocusPollIntervalSeconds: TimeInterval = 0.2

private struct LiveSmokeBreadcrumb {
    let line: String
}

private struct LiveSmokeRunContext {
    let workspaceName: String
    let manualFrontText: String
    let manualBackText: String
}

private struct LiveSmokeAIToolCallCheck {
    let matchingInsertFound: Bool
    let completedSqlSummaries: [String]
}

private enum LiveSmokeSeededData {
    static let manualReviewFrontText: String = "Smoke seeded manual review question"
    static let aiReviewFrontText: String = "Smoke seeded AI review question"
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
    private let reviewInitialProbeTimeoutSeconds: TimeInterval = 15
    private let reviewInteractionTimeoutSeconds: TimeInterval = 10
    private let reviewEmailEnvironmentKey: String = "FLASHCARDS_LIVE_REVIEW_EMAIL"
    private let resetStateEnvironmentKey: String = "FLASHCARDS_UI_TEST_RESET_STATE"
    private let selectedTabEnvironmentKey: String = "FLASHCARDS_UI_TEST_SELECTED_TAB"
    private let maximumStoredBreadcrumbCount: Int = 30

    private var app: XCUIApplication!
    private var currentStepTitle: String = "test bootstrap"
    private var hasPrintedInlineRawScreenStateForCurrentFailure: Bool = false
    private var recentBreadcrumbs: [LiveSmokeBreadcrumb] = []

    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "Live smoke known interruptions") { alert in
            MainActor.assumeIsolated {
                for label in ["Not now", "Not Now", "OK", "Close", "Dismiss", "Cancel", "Allow"] {
                    let button = alert.buttons[label]
                    guard button.exists else {
                        continue
                    }

                    button.tap()
                    return true
                }

                return false
            }
        }
    }

    override func tearDownWithError() throws {
        if let app = self.app {
            MainActor.assumeIsolated {
                app.terminate()
            }
        }
        self.app = nil
        self.hasPrintedInlineRawScreenStateForCurrentFailure = false
        self.recentBreadcrumbs = []
        self.currentStepTitle = "test bootstrap"
        try super.tearDownWithError()
    }

    @MainActor
    func testLiveSmokeManualCardCreationFlow() throws {
        let context = self.makeRunContext()
        try self.launchApplication(resetState: .localGuest, selectedTab: .cards)

        try self.step("create one local manual card without login") {
            try self.createManualCard(frontText: context.manualFrontText, backText: context.manualBackText)
        }
    }

    @MainActor
    func testLiveSmokeManualCardReviewFlow() throws {
        try self.launchApplication(resetState: .localGuestSeededManualReviewCard, selectedTab: .review)

        try self.step("review the seeded manual card") {
            try self.reviewCurrentCard(
                expectedFrontText: LiveSmokeSeededData.manualReviewFrontText
            )
        }
    }

    @MainActor
    func testLiveSmokeGuestAiCardCreationFlow() throws {
        try self.launchApplication(resetState: .localGuest, selectedTab: .ai)

        try self.step("create one guest AI card and confirm the insert completed") {
            try self.createAiCardWithConfirmation()
        }
    }

    @MainActor
    func testLiveSmokeGuestAiChatResetFlow() throws {
        try self.launchApplication(resetState: .localGuest, selectedTab: .ai)

        try self.step("create one guest AI conversation before reset") {
            try self.createGuestAiConversationForReset()
        }

        try self.step("start a new chat and confirm the conversation resets cleanly") {
            try self.startNewAiChatAndAssertConversationReset()
        }
    }

    @MainActor
    func testLiveSmokeGuestAiCardReviewFlow() throws {
        try self.launchApplication(resetState: .localGuestSeededAIReviewCard, selectedTab: .review)

        try self.step("review the seeded AI card") {
            try self.reviewCurrentCard(
                expectedFrontText: LiveSmokeSeededData.aiReviewFrontText
            )
        }
    }

    @MainActor
    func testLiveSmokeLocalNavigationFlow() throws {
        try self.step("verify local navigation surfaces without login") {
            try self.launchApplication(resetState: .localGuest, selectedTab: .cards)
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.cardsAddButton,
                timeout: self.shortUiTimeoutSeconds
            )

            try self.tapTabBarItem(named: LiveSmokeScreen.review.title, timeout: self.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .review, timeout: self.shortUiTimeoutSeconds)

            try self.tapTabBarItem(named: LiveSmokeScreen.ai.title, timeout: self.shortUiTimeoutSeconds)
            try self.assertAiEntrySurfaceVisible()

            try self.tapTabBarItem(named: LiveSmokeScreen.settings.title, timeout: self.shortUiTimeoutSeconds)
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

    @MainActor
    // TODO: Flatten the Current Workspace flow.
    // Settings currently opens Current Workspace, which then requires another tap on
    // an inner Workspace row before the chooser appears. Replace that nested flow
    // with a direct workspace chooser surface, then restore this smoke test and
    // make it verify linked-workspace creation and persistence again.
    func testLiveSmokeLoginAndLinkedWorkspaceFlow() throws {
        throw XCTSkip(
            "TODO: Restore after flattening the nested Current Workspace -> Workspace flow and reworking the linked-workspace smoke path."
        )
    }

    @MainActor
    private func makeRunContext() -> LiveSmokeRunContext {
        let runToken = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(10))
        let workspaceToken = String(runToken.prefix(6))

        return LiveSmokeRunContext(
            workspaceName: "E2E iOS \(workspaceToken)",
            manualFrontText: "Manual \(runToken)",
            manualBackText: "Manual answer \(runToken)"
        )
    }

    @MainActor
    private func runSignedInLinkedWorkspaceScenario(
        context: LiveSmokeRunContext,
        reviewEmail: String,
        scenario: () throws -> Void
    ) throws {
        try self.launchApplication(resetState: .localGuest, selectedTab: .settings)

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
            if primaryFailure != nil {
                self.resetInlineRawScreenStateFailureGuard()
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

            do {
                try action()

                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "step_end",
                    action: "step",
                    identifier: "-",
                    timeoutSeconds: "-",
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: title
                )
            } catch {
                self.emitInlineRawScreenStateIfNeeded(action: "step.\(title)")
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
    private func launchApplication(
        resetState: LiveSmokeLaunchResetState?,
        selectedTab: LiveSmokeSelectedTab
    ) throws {
        self.app = XCUIApplication()
        self.configureLaunchEnvironment(resetState: resetState, selectedTab: selectedTab)
        self.logActionStart(action: "launch_app", identifier: "application")
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: self.shortUiTimeoutSeconds)
        _ = self.dismissKnownBlockingAlertIfVisible()
        try self.waitForSelectedTabScreen(selectedTab: selectedTab, timeout: self.shortUiTimeoutSeconds)
        self.logActionEnd(action: "launch_app", identifier: "application", result: "success", note: "application launched")
    }

    @MainActor
    private func signInWithReviewAccount(reviewEmail: String) throws {
        try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
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
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.cloudSignInScreen,
                timeout: self.longUiTimeoutSeconds
            )
            try self.typeTextSafely(
                reviewEmail,
                intoElementWithIdentifier: LiveSmokeIdentifier.cloudSignInEmailField,
                timeout: self.longUiTimeoutSeconds
            )
            try self.tapElement(
                identifier: LiveSmokeIdentifier.cloudSignInSendCodeButton,
                timeout: self.longUiTimeoutSeconds
            )
            try self.completeCloudWorkspaceSelectionIfNeeded()
        } else if self.isAccountStatusLinked() {
            let visibleEmail = self.visibleLinkedEmailLabel()
            if visibleEmail?.contains(reviewEmail) == false {
                throw LiveSmokeFailure.unexpectedAccountState(
                    message: "Expected linked review email containing '\(reviewEmail)', but found '\(visibleEmail ?? "unknown")'.",
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
        }

        try self.assertLinkedEmailVisible(reviewEmail: reviewEmail, timeout: self.longUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.accountStatusSyncNowButton,
            timeout: self.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapFirstNavigationBackButton()
    }

    @MainActor
    private func createEphemeralWorkspace(workspaceName: String) throws {
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
        try self.replaceTextSafely(
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
        try self.assertScreenVisible(screen: .cards, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(identifier: LiveSmokeIdentifier.cardsAddButton, timeout: self.longUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.cardEditorScreen,
            timeout: self.longUiTimeoutSeconds
        )
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: self.longUiTimeoutSeconds)
        try self.typeTextSafely(
            frontText,
            intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor,
            timeout: self.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorBackRow, timeout: self.longUiTimeoutSeconds)
        try self.typeTextSafely(
            backText,
            intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorBackTextEditor,
            timeout: self.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: self.longUiTimeoutSeconds)
        try self.assertTextExists(frontText, timeout: self.longUiTimeoutSeconds)
    }

    @MainActor
    private func reviewCurrentCard(expectedFrontText: String) throws {
        try self.assertScreenVisible(screen: .review, timeout: self.shortUiTimeoutSeconds)
        try self.assertTextExists(
            expectedFrontText,
            timeout: self.reviewInitialProbeTimeoutSeconds
        )
        try self.tapElement(
            identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
            timeout: self.reviewInteractionTimeoutSeconds
        )
        try self.waitForReviewAnswerReveal()
        try self.tapElement(
            identifier: LiveSmokeIdentifier.reviewRateGoodButton,
            timeout: self.reviewInteractionTimeoutSeconds
        )
    }

    @MainActor
    private func waitForReviewAnswerReveal() throws {
        let showAnswerButton = self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton]
        let rateGoodButton = self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton]
        let deadline = Date().addingTimeInterval(self.reviewInteractionTimeoutSeconds)

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            if showAnswerButton.exists == false && rateGoodButton.exists {
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        if showAnswerButton.exists {
            throw LiveSmokeFailure.unexpectedReviewState(
                message: "Review answer did not reveal after tapping Show answer.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        throw LiveSmokeFailure.missingElement(
            identifier: LiveSmokeIdentifier.reviewRateGoodButton,
            timeoutSeconds: self.reviewInteractionTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func createAiCardWithConfirmation() throws {
        try self.assertScreenVisible(screen: .ai, timeout: self.shortUiTimeoutSeconds)

        let aiConsentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            aiConsentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: self.optionalProbeTimeoutSeconds
        ) {
            try self.tapElement(
                identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
                timeout: self.shortUiTimeoutSeconds
            )
            try self.waitForAiComposerAfterConsent()
        }

        var latestCompletedSqlSummaries: [String] = []

        for attempt in 1...aiCreatePromptMaximumAttempts {
            try self.assertElementDisabled(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeout: self.shortUiTimeoutSeconds
            )
            try self.replaceAiComposerText(
                aiCreatePromptText,
                timeout: self.shortUiTimeoutSeconds
            )
            let completedMarkerCountBeforeAttempt = self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus)
                .count
            let errorMarkerCountBeforeAttempt = self.visibleAssistantErrorMessages().count
            try self.assertElementEnabled(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeout: self.shortUiTimeoutSeconds
            )
            _ = self.dismissKnownBlockingAlertIfVisible()
            self.logActionStart(action: "ai_send_\(attempt)", identifier: LiveSmokeIdentifier.aiComposerSendButton)
            try self.tapElement(identifier: LiveSmokeIdentifier.aiComposerSendButton, timeout: self.shortUiTimeoutSeconds)
            _ = self.dismissKnownBlockingAlertIfVisible()
            self.logActionEnd(
                action: "ai_send_\(attempt)",
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                result: "success",
                note: "AI create request sent"
            )
            try self.assertAiRunStartedOrFinished(
                timeout: self.longUiTimeoutSeconds,
                completedMarkerCountBeforeWait: completedMarkerCountBeforeAttempt,
                errorMarkerCountBeforeWait: errorMarkerCountBeforeAttempt
            )
            try self.assertAiRunFinished(
                timeout: self.longUiTimeoutSeconds,
                completedMarkerCountBeforeWait: completedMarkerCountBeforeAttempt,
                errorMarkerCountBeforeWait: errorMarkerCountBeforeAttempt
            )
            try self.assertElementLabel(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                expectedLabel: "Send message",
                timeout: self.longUiTimeoutSeconds
            )
            try self.assertElementDisabled(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeout: self.longUiTimeoutSeconds
            )

            let toolCallCheck = try self.completedAiInsertToolCallCheck()
            latestCompletedSqlSummaries = toolCallCheck.completedSqlSummaries
            if toolCallCheck.matchingInsertFound {
                return
            }
        }

        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "AI create flow did not produce a completed SQL INSERT INTO cards after \(aiCreatePromptMaximumAttempts) attempts. CompletedSqlToolCalls: \(latestCompletedSqlSummaries)",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func startNewAiChatAndAssertConversationReset() throws {
        let assistantErrorMessagesBeforeReset = self.visibleAssistantErrorMessages().count

        try self.tapElement(
            identifier: LiveSmokeIdentifier.aiNewChatButton,
            timeout: self.shortUiTimeoutSeconds
        )

        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: self.longUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiEmptyState,
            timeout: self.longUiTimeoutSeconds
        )
        try self.assertElementDisabled(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: self.longUiTimeoutSeconds
        )

        let messageRows = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiMessageRow)
            .count
        if messageRows != 0 {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected zero AI chat message rows after starting a new chat, found \(messageRows).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        let assistantErrorMessages = self.visibleAssistantErrorMessages().count
        if assistantErrorMessages != assistantErrorMessagesBeforeReset {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected no new AI assistant error messages after starting a new chat, found \(assistantErrorMessages - assistantErrorMessagesBeforeReset).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func waitForAiComposerAfterConsent() throws {
        let consentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        let composerTextField = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiComposerTextField)
            .firstMatch
        let deadline = Date().addingTimeInterval(self.longUiTimeoutSeconds)

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            if consentButton.exists == false && composerTextField.exists {
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        if consentButton.exists {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "AI consent gate did not dismiss after accepting consent.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        throw LiveSmokeFailure.missingElement(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeoutSeconds: self.longUiTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func createGuestAiConversationForReset() throws {
        try self.assertScreenVisible(screen: .ai, timeout: self.shortUiTimeoutSeconds)

        let aiConsentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            aiConsentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: self.optionalProbeTimeoutSeconds
        ) {
            try self.tapElement(
                identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
                timeout: self.shortUiTimeoutSeconds
            )
            try self.waitForAiComposerAfterConsent()
        }

        try self.assertElementDisabled(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.replaceAiComposerText(
            aiResetPromptText,
            timeout: self.shortUiTimeoutSeconds
        )
        let completedMarkerCountBeforeWait = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus)
            .count
        let errorMarkerCountBeforeWait = self.visibleAssistantErrorMessages().count
        try self.assertElementEnabled(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.tapElement(
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: self.shortUiTimeoutSeconds
        )
        try self.assertAiRunStartedOrFinished(
            timeout: self.longUiTimeoutSeconds,
            completedMarkerCountBeforeWait: completedMarkerCountBeforeWait,
            errorMarkerCountBeforeWait: errorMarkerCountBeforeWait
        )
        try self.assertTextExists(
            aiResetPromptText,
            timeout: self.longUiTimeoutSeconds
        )
        try self.assertElementEnabled(
            identifier: LiveSmokeIdentifier.aiNewChatButton,
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

        try self.replaceTextSafely(
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
    }

    @MainActor
    private func openAccountStatus() throws {
        try self.assertScreenVisible(screen: .settings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.settingsAccountSettingsRow,
            timeout: self.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .accountSettings, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(
            identifier: LiveSmokeIdentifier.accountSettingsAccountStatusRow,
            timeout: self.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .accountStatus, timeout: self.shortUiTimeoutSeconds)
    }

    @MainActor
    private func openWorkspaceOverviewFromSettings() throws {
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
    private func tapButton(named name: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_button.\(name)") {
            let button = self.app.buttons[name].firstMatch
            if self.waitForOptionalElement(
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
            if button.isEnabled == false {
                throw LiveSmokeFailure.disabledElement(
                    identifier: "button.\(name)",
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
            self.logActionStart(action: "tap_button", identifier: "button.\(name)")
            button.tap()
            _ = self.dismissKnownBlockingAlertIfVisible()
            self.logActionEnd(action: "tap_button", identifier: "button.\(name)", result: "success", note: "button tapped")
        }
    }

    @MainActor
    private func tapTabBarItem(named name: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_tab.\(name)") {
            let tabBarButton = self.app.tabBars.buttons[name].firstMatch
            let fallbackButton = self.app.buttons[name].firstMatch
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                if tabBarButton.exists && tabBarButton.isHittable {
                    self.logActionStart(action: "tap_tab", identifier: "tab.\(name)")
                    tabBarButton.tap()
                    _ = self.dismissKnownBlockingAlertIfVisible()
                    self.logActionEnd(action: "tap_tab", identifier: "tab.\(name)", result: "success", note: "tab bar button tapped")
                    return
                }
                if fallbackButton.exists && fallbackButton.isHittable {
                    self.logActionStart(action: "tap_tab", identifier: "tab.\(name)")
                    fallbackButton.tap()
                    _ = self.dismissKnownBlockingAlertIfVisible()
                    self.logActionEnd(action: "tap_tab", identifier: "tab.\(name)", result: "success", note: "fallback button tapped")
                    return
                }
                RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            }
            throw LiveSmokeFailure.missingElement(
                identifier: "tab.\(name)",
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func tapElement(identifier: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_element.\(identifier)") {
            let button = self.app.buttons[identifier].firstMatch
            if self.waitForOptionalElement(
                button,
                identifier: identifier,
                timeout: timeout
            ) {
                self.logActionStart(action: "tap_element", identifier: identifier)
                if button.isEnabled == false {
                    throw LiveSmokeFailure.disabledElement(
                        identifier: identifier,
                        screen: self.currentScreenSummary(),
                        step: self.currentStepTitle
                    )
                }
                button.tap()
                _ = self.dismissKnownBlockingAlertIfVisible()
                self.logActionEnd(action: "tap_element", identifier: identifier, result: "success", note: "button tapped")
                return
            }

            let cell = self.app.cells[identifier].firstMatch
            if self.waitForOptionalElement(
                cell,
                identifier: identifier,
                timeout: self.optionalProbeTimeoutSeconds
            ) {
                self.logActionStart(action: "tap_element", identifier: identifier)
                cell.tap()
                _ = self.dismissKnownBlockingAlertIfVisible()
                self.logActionEnd(action: "tap_element", identifier: identifier, result: "success", note: "cell tapped")
                return
            }

            throw LiveSmokeFailure.missingElement(
                identifier: identifier,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func assertElementExists(identifier: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_element_exists.\(identifier)") {
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
    }

    @MainActor
    private func assertTextExists(_ text: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_text_exists.\(text)") {
            let textElement = self.exactVisibleText(text).firstMatch
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
    }

    @MainActor
    private func assertVisibleTextContains(
        _ text: String,
        timeout: TimeInterval,
        aiErrorMarkerCountBeforeWait: Int,
        ignoredExactLabels: Set<String>
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_visible_text_contains.\(text)") {
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

                if self.visibleStaticTextLabels(ignoredExactLabels: ignoredExactLabels).contains(where: { label in
                    label.contains(text)
                }) {
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

                let assistantErrorMessages = self.visibleAssistantErrorMessages()
                if assistantErrorMessages.count > aiErrorMarkerCountBeforeWait {
                    let durationSeconds = Date().timeIntervalSince(startedAt)
                    let errorMessage = assistantErrorMessages.last ?? ""
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
    }

    @MainActor
    private func visibleStaticTextLabels(ignoredExactLabels: Set<String>) -> [String] {
        self.elements(query: self.app.staticTexts)
            .map(\.label)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { label in
                label.isEmpty == false && ignoredExactLabels.contains(label) == false
            }
    }

    @MainActor
    private func visibleAssistantErrorTextQuery() -> XCUIElementQuery {
        self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiAssistantErrorMessage)
    }

    @MainActor
    private func visibleAssistantErrorMessages() -> [String] {
        self.elements(query: self.visibleAssistantErrorTextQuery())
            .map { self.elementValue(element: $0) }
            .filter { label in
                label.isEmpty == false
            }
    }

    @MainActor
    private func exactVisibleText(_ text: String) -> XCUIElementQuery {
        let predicate = NSPredicate(format: "label == %@ OR identifier == %@", text, text)
        return self.app.descendants(matching: .any).matching(predicate)
    }

    @MainActor
    private func assertElementEnabled(identifier: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_element_enabled.\(identifier)") {
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
    }

    @MainActor
    private func assertElementDisabled(identifier: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_element_disabled.\(identifier)") {
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

            if element.isEnabled {
                throw LiveSmokeFailure.unexpectedAiConversationState(
                    message: "Expected \(identifier) to be disabled.",
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
        }
    }

    @MainActor
    private func assertElementLabel(
        identifier: String,
        expectedLabel: String,
        timeout: TimeInterval
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_element_label.\(identifier)") {
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
    }

    // Raw XCUIElement.typeText can hang until XCTest's global execution allowance
    // when Simulator or CI never grants keyboard focus. Always gate text entry on
    // explicit focus so text-input failures fail fast with local diagnostics.
    @MainActor
    private func typeTextSafely(
        _ text: String,
        intoElement element: XCUIElement,
        identifier: String,
        timeout: TimeInterval
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "type_text.\(identifier)") {
            try self.focusElementForTextInput(
                element,
                identifier: identifier,
                timeout: timeout
            )
            self.logActionStart(action: "type_text", identifier: identifier)
            element.typeText(text)
            _ = self.dismissKnownBlockingAlertIfVisible()
            if self.waitForElementValueContaining(
                element,
                identifier: identifier,
                expectedValue: text,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.unexpectedElementValue(
                    identifier: identifier,
                    expectedValue: text,
                    actualValue: self.elementValue(element: element),
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
            self.logActionEnd(action: "type_text", identifier: identifier, result: "success", note: "text typed")
        }
    }

    @MainActor
    private func typeTextSafely(
        _ text: String,
        intoElementWithIdentifier identifier: String,
        timeout: TimeInterval
    ) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        try self.typeTextSafely(
            text,
            intoElement: element,
            identifier: identifier,
            timeout: timeout
        )
    }

    @MainActor
    private func replaceTextSafely(
        _ text: String,
        inElement element: XCUIElement,
        identifier: String,
        placeholderValue: String,
        timeout: TimeInterval
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "replace_text.\(identifier)") {
            try self.focusElementForTextInput(
                element,
                identifier: identifier,
                timeout: timeout
            )

            self.logActionStart(action: "replace_text", identifier: identifier)
            let existingValue = element.value as? String ?? ""
            if existingValue.isEmpty == false && existingValue != placeholderValue {
                let deleteSequence = String(repeating: XCUIKeyboardKey.delete.rawValue, count: existingValue.count)
                element.typeText(deleteSequence)
            }
            element.typeText(text)
            _ = self.dismissKnownBlockingAlertIfVisible()

            if self.waitForElementValueContaining(
                element,
                identifier: identifier,
                expectedValue: text,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.unexpectedElementValue(
                    identifier: identifier,
                    expectedValue: text,
                    actualValue: self.elementValue(element: element),
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            self.logActionEnd(action: "replace_text", identifier: identifier, result: "success", note: "text replaced")
        }
    }

    @MainActor
    private func replaceTextSafely(
        _ text: String,
        inElementWithIdentifier identifier: String,
        timeout: TimeInterval
    ) throws {
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        try self.replaceTextSafely(
            text,
            inElement: element,
            identifier: identifier,
            placeholderValue: element.placeholderValue ?? "",
            timeout: timeout
        )
    }

    @MainActor
    private func replaceAiComposerText(_ text: String, timeout: TimeInterval) throws {
        let element = self.aiComposerTextFieldElement()
        try self.replaceTextSafely(
            text,
            inElement: element,
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            placeholderValue: aiComposerPlaceholderText,
            timeout: timeout
        )
    }

    @MainActor
    private func aiComposerTextFieldElement() -> XCUIElement {
        let predicate = NSPredicate(
            format: "identifier == %@ OR value == %@ OR label == %@",
            LiveSmokeIdentifier.aiComposerTextField,
            aiComposerPlaceholderText,
            aiComposerPlaceholderText
        )
        return self.app.descendants(matching: .any).matching(predicate).firstMatch
    }

    @MainActor
    private func focusElementForTextInput(
        _ element: XCUIElement,
        identifier: String,
        timeout: TimeInterval
    ) throws {
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
        var didRetryActivation = false
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_text_input_focus",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "waiting for keyboard focus"
        )

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            if element.exists && element.isHittable {
                element.tap()
                if self.elementHasKeyboardFocus(element: element) {
                    let durationSeconds = Date().timeIntervalSince(startedAt)
                    self.logSmokeBreadcrumb(
                        event: "wait_end",
                        action: "wait_for_text_input_focus",
                        identifier: identifier,
                        timeoutSeconds: formatDuration(seconds: timeout),
                        durationSeconds: formatDuration(seconds: durationSeconds),
                        result: "success",
                        note: "keyboard focus acquired"
                    )
                    return
                }

                if didRetryActivation == false {
                    self.app.activate()
                    didRetryActivation = true
                    RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
                    continue
                }

                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_text_input_focus",
                    identifier: identifier,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "keyboard focus not reported but element is hittable, proceeding"
                )
                return
            }

            if didRetryActivation == false {
                self.app.activate()
                didRetryActivation = true
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }

        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_text_input_focus",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: "failure",
            note: self.textInputFailureNote(element: element)
        )
        throw LiveSmokeFailure.textInputNotReady(
            identifier: identifier,
            timeoutSeconds: timeout,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle,
            exists: element.exists,
            hittable: element.isHittable,
            hasKeyboardFocus: self.elementHasKeyboardFocus(element: element),
            softwareKeyboardVisible: self.softwareKeyboardIsVisible(),
            elementLabel: element.label,
            elementValue: self.elementValue(element: element)
        )
    }

    @MainActor
    private func elementHasKeyboardFocus(element: XCUIElement) -> Bool {
        (element.value(forKey: "hasKeyboardFocus") as? Bool) == true
    }

    @MainActor
    private func softwareKeyboardIsVisible() -> Bool {
        self.app.keyboards.firstMatch.exists
    }

    @MainActor
    private func textInputFailureNote(element: XCUIElement) -> String {
        "exists=\(element.exists) hittable=\(element.isHittable) hasKeyboardFocus=\(self.elementHasKeyboardFocus(element: element)) softwareKeyboardVisible=\(self.softwareKeyboardIsVisible()) value=\(self.elementValue(element: element))"
    }

    @MainActor
    private func tapFirstNavigationBackButton() throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_back_button.navigation.backButton") {
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
            if backButton.isEnabled == false {
                throw LiveSmokeFailure.disabledElement(
                    identifier: "navigation.backButton",
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
            self.logActionStart(action: "tap_back_button", identifier: "navigation.backButton")
            backButton.tap()
            _ = self.dismissKnownBlockingAlertIfVisible()
            self.logActionEnd(action: "tap_back_button", identifier: "navigation.backButton", result: "success", note: "back tapped")
        }
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
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_screen.\(screen.identifier)") {
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
        return found
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

        for label in ["OK", "Close", "Dismiss", "Cancel", "Not now", "Not Now", "Allow"] {
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
    private func launchEnvironmentSummary() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }

        let resetState = self.app.launchEnvironment[self.resetStateEnvironmentKey] ?? "-"
        let selectedTab = self.app.launchEnvironment[self.selectedTabEnvironmentKey] ?? "-"
        return "resetState=\(resetState) selectedTab=\(selectedTab)"
    }

    @MainActor
    private func activeAlertsSnapshot() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }
        guard self.isApplicationRunning else {
            return "<app not running>"
        }

        let alerts = self.elements(query: self.app.alerts).map { alert in
            let buttons = self.elements(query: alert.buttons)
                .map(\.label)
                .joined(separator: ", ")
            return "\(alert.label) [\(buttons.isEmpty ? "-" : buttons)]"
        }

        if alerts.isEmpty {
            return "<no active alerts>"
        }

        return alerts.joined(separator: " | ")
    }

    @MainActor
    private func rootScreenQuerySnapshot() -> String {
        guard self.app != nil else {
            return "<app not initialized>"
        }
        guard self.isApplicationRunning else {
            return "<app not running>"
        }

        let screens: [LiveSmokeScreen] = [.review, .cards, .ai, .settings]
        return screens.map { screen in
            let exists = self.app.descendants(matching: .any).matching(identifier: screen.identifier).firstMatch.exists
            return "\(screen.identifier)=\(exists)"
        }.joined(separator: " | ")
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
            Launch environment: \(self.launchEnvironmentSummary())
            Root screen queries: \(self.rootScreenQuerySnapshot())
            Active alerts: \(self.activeAlertsSnapshot())
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

        let labels = self.visibleStaticTextLabels(ignoredExactLabels: [])

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
    private func resetInlineRawScreenStateFailureGuard() {
        self.hasPrintedInlineRawScreenStateForCurrentFailure = false
    }

    @MainActor
    private func emitInlineRawScreenStateIfNeeded(action: String) {
        if self.hasPrintedInlineRawScreenStateForCurrentFailure {
            return
        }

        self.hasPrintedInlineRawScreenStateForCurrentFailure = true
        fputs(self.inlineRawScreenStateBlock(action: action) + "\n", stderr)
    }

    @MainActor
    private func inlineRawScreenStateBlock(action: String) -> String {
        return [
            "===== BEGIN RAW SCREEN STATE =====",
            "platform: ios",
            "test: \(self.name)",
            "step: \(self.currentStepTitle)",
            "action: \(action)",
            "capturedAt: \(ISO8601DateFormatter().string(from: Date()))",
            "context: \(self.currentScreenSummary())",
            "",
            "activeAlerts: \(self.activeAlertsSnapshot())",
            "",
            self.appDebugHierarchy(),
            "===== END RAW SCREEN STATE ====="
        ].joined(separator: "\n")
    }

    @MainActor
    private func runWithInlineRawScreenStateOnFailure<T>(
        action: String,
        operation: () throws -> T
    ) throws -> T {
        do {
            return try operation()
        } catch {
            self.emitInlineRawScreenStateIfNeeded(action: action)
            throw error
        }
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
        captureScreenSummary: Bool = false,
        screenOverride: String? = nil
    ) {
        let shouldCaptureScreenSummary = captureScreenSummary || result == "failure"
        let screen = screenOverride ?? (shouldCaptureScreenSummary ? self.currentScreenSummary() : "screens=[-] nav=[-] alerts=[-] tabs=[-]")
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
        captureScreenSummary: Bool = false,
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
        try self.runWithInlineRawScreenStateOnFailure(action: "wait_for_app_foreground") {
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
                captureScreenSummary: false,
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
    }

    @MainActor
    private func configureLaunchEnvironment(
        resetState: LiveSmokeLaunchResetState?,
        selectedTab: LiveSmokeSelectedTab
    ) {
        self.app.launchEnvironment.removeValue(forKey: self.resetStateEnvironmentKey)
        self.app.launchEnvironment[self.selectedTabEnvironmentKey] = selectedTab.rawValue
        if let resetState {
            self.app.launchEnvironment[self.resetStateEnvironmentKey] = resetState.rawValue
        }
    }

    @MainActor
    private func elements(query: XCUIElementQuery) -> [XCUIElement] {
        let count = query.count
        guard count > 0 else {
            return []
        }

        return (0..<count).compactMap { index in
            let element = query.element(boundBy: index)
            return element.exists ? element : nil
        }
    }

    @MainActor
    private func elementLabel(query: XCUIElementQuery, index: Int) -> String {
        guard index >= 0, index < query.count else {
            return ""
        }

        let element = query.element(boundBy: index)
        guard element.exists else {
            return ""
        }

        return element.label.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @MainActor
    private func elementValue(element: XCUIElement) -> String {
        if let value = element.value as? String {
            return value.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        if let value = element.value {
            return String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        return element.label.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @MainActor
    private func waitForElementValueContaining(
        _ element: XCUIElement,
        identifier: String,
        expectedValue: String,
        timeout: TimeInterval
    ) -> Bool {
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_element_value",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: expectedValue
        )
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()
            let currentValue = self.elementValue(element: element)
            if currentValue == expectedValue || currentValue.contains(expectedValue) {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_element_value",
                    identifier: identifier,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: expectedValue
                )
                return true
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_element_value",
            identifier: identifier,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: "failure",
            note: self.elementValue(element: element)
        )
        return false
    }

    @MainActor
    private func waitForSelectedTabScreen(selectedTab: LiveSmokeSelectedTab, timeout: TimeInterval) throws {
        try self.assertScreenVisible(screen: selectedTab.screen, timeout: timeout)
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
    private func assertLinkedEmailVisible(reviewEmail: String, timeout: TimeInterval) throws {
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()
            if let visibleEmail = self.visibleLinkedEmailLabel(), visibleEmail.contains(reviewEmail) {
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        try self.assertTextExists(reviewEmail, timeout: self.optionalProbeTimeoutSeconds)
    }

    @MainActor
    private func logoutFromAccountStatus() throws {
        try self.tapElement(
            identifier: LiveSmokeIdentifier.accountStatusLogoutButton,
            timeout: self.shortUiTimeoutSeconds
        )

        let confirmationButton = self.app.alerts.buttons["Log out"]
        if self.waitForOptionalElement(
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
        if confirmationButton.isEnabled == false {
            throw LiveSmokeFailure.disabledElement(
                identifier: "alert.logoutButton",
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
                if self.waitForOptionalElement(
                    existingWorkspaceButton,
                    identifier: "cloudSignIn.existingWorkspace.first",
                    timeout: self.optionalProbeTimeoutSeconds
                ) && existingWorkspaceButton.isEnabled {
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
                if self.waitForOptionalElement(
                    createWorkspaceButton,
                    identifier: LiveSmokeIdentifier.cloudSignInCreateWorkspaceButton,
                    timeout: self.optionalProbeTimeoutSeconds
                ) && createWorkspaceButton.isEnabled {
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

            let assistantErrorMessages = self.visibleAssistantErrorMessages()
            if assistantErrorMessages.count > errorMarkerCountBeforeWait {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                let errorMessage = assistantErrorMessages.last ?? ""
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

            let completedMarkerCount = completedElements.count
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

    @MainActor
    private func assertAiRunStartedOrFinished(
        timeout: TimeInterval,
        completedMarkerCountBeforeWait: Int,
        errorMarkerCountBeforeWait: Int
    ) throws {
        let sendButtonQuery = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiComposerSendButton)
        let sendButton = sendButtonQuery
            .firstMatch
        let completedElements = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus)

        if self.waitForOptionalElement(
            sendButton,
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeout: timeout
        ) == false {
            throw LiveSmokeFailure.missingElement(
                identifier: LiveSmokeIdentifier.aiComposerSendButton,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(timeout)
        self.logSmokeBreadcrumb(
            event: "wait_start",
            action: "wait_for_ai_activity",
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: "-",
            result: "start",
            note: "waiting for AI run start or completion"
        )

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            let assistantErrorMessages = self.visibleAssistantErrorMessages()
            if assistantErrorMessages.count > errorMarkerCountBeforeWait {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                let errorMessage = assistantErrorMessages.last ?? ""
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_ai_activity",
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

            if completedElements.count > completedMarkerCountBeforeWait {
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_ai_activity",
                    identifier: LiveSmokeIdentifier.aiToolCallCompletedStatus,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "AI run completed before stop state was observed"
                )
                return
            }

            let currentSendButton = sendButtonQuery.firstMatch
            if currentSendButton.exists, currentSendButton.label == "Stop response" {
                if currentSendButton.isEnabled == false {
                    throw LiveSmokeFailure.disabledElement(
                        identifier: LiveSmokeIdentifier.aiComposerSendButton,
                        screen: self.currentScreenSummary(),
                        step: self.currentStepTitle
                    )
                }
                let durationSeconds = Date().timeIntervalSince(startedAt)
                self.logSmokeBreadcrumb(
                    event: "wait_end",
                    action: "wait_for_ai_activity",
                    identifier: LiveSmokeIdentifier.aiComposerSendButton,
                    timeoutSeconds: formatDuration(seconds: timeout),
                    durationSeconds: formatDuration(seconds: durationSeconds),
                    result: "success",
                    note: "AI run entered streaming state"
                )
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        let durationSeconds = Date().timeIntervalSince(startedAt)
        self.logSmokeBreadcrumb(
            event: "wait_end",
            action: "wait_for_ai_activity",
            identifier: LiveSmokeIdentifier.aiComposerSendButton,
            timeoutSeconds: formatDuration(seconds: timeout),
            durationSeconds: formatDuration(seconds: durationSeconds),
            result: "failure",
            note: "AI run did not start or complete"
        )
        throw LiveSmokeFailure.unexpectedAiConversationState(
            message: "AI run did not enter streaming or completion state within \(formatDuration(seconds: timeout)).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func completedAiInsertToolCallCheck() throws -> LiveSmokeAIToolCallCheck {
        try self.expandAllVisibleAiToolCallSummaries()

        let summaryTexts = self.elements(
            query: self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiToolCallSummary)
        ).map(\.label).map { label in
            label.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { label in
            label.isEmpty == false
        }
        let requestTexts = self.elements(
            query: self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiToolCallRequestText)
        ).map(\.label).map { label in
            label.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { label in
            label.isEmpty == false
        }
        let responseTexts = self.elements(
            query: self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiToolCallResponseText)
        ).map(\.label).map { label in
            label.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { label in
            label.isEmpty == false
        }
        let completedSqlSummaries = summaryTexts.filter { summaryText in
            summaryText.contains("SQL:")
        }
        let summaryMatch = completedSqlSummaries.contains { summaryText in
            summaryText.contains("INSERT INTO cards")
        }
        let requestMatch = requestTexts.isEmpty || requestTexts.contains { requestText in
            requestText.contains("INSERT INTO cards")
        }
        let responseMatch = responseTexts.isEmpty || responseTexts.contains { responseText in
            responseText.contains("\"ok\":true")
        }
        let matchingInsertFound = summaryMatch && requestMatch && responseMatch

        return LiveSmokeAIToolCallCheck(
            matchingInsertFound: matchingInsertFound,
            completedSqlSummaries: completedSqlSummaries
        )
    }

    @MainActor
    private func expandAllVisibleAiToolCallSummaries() throws {
        let summaryElements = self.elements(
            query: self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.aiToolCallSummary)
        )

        for (index, summaryElement) in summaryElements.enumerated() {
            guard summaryElement.exists, summaryElement.isHittable else {
                continue
            }

            self.logActionStart(
                action: "tap_tool_call_summary",
                identifier: "\(LiveSmokeIdentifier.aiToolCallSummary).\(index)"
            )
            summaryElement.tap()
            _ = self.dismissKnownBlockingAlertIfVisible()
            self.logActionEnd(
                action: "tap_tool_call_summary",
                identifier: "\(LiveSmokeIdentifier.aiToolCallSummary).\(index)",
                result: "success",
                note: "tool call summary toggled"
            )
        }
    }
}
