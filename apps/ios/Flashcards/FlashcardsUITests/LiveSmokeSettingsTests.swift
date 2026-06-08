import Foundation
import XCTest

final class LiveSmokeSettingsTests: LiveSmokeTestCase {
    @MainActor
    func testLiveSmokeGuestNavigationFlow() throws {
        try self.step("verify guest navigation surfaces without login") {
            try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.cardsAddButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )

            try self.tapTabBarItem(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            try self.tapTabBarItem(selectedTab: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            try self.tapTabBarItem(selectedTab: .ai, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertAiEntrySurfaceVisible()

            try self.tapTabBarItem(selectedTab: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.verifySettingsInformationArchitecture()
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    private func verifySettingsInformationArchitecture() throws {
        try self.assertTextExists("Account", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsAccountStatusRow)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.accountStatusSignInButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.returnToSettingsRoot()

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsCurrentWorkspaceRow)
        try self.assertScreenVisible(screen: .currentWorkspace, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.assertTextExistsScrollingIntoView("General", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsReviewRemindersRow)
        try self.assertTextExistsScrollingIntoView("Workspace Review Reminders", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.assertReviewAnimationsRowOrder()
        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsReviewAnimationsRow)
        try self.assertScreenVisible(screen: .reviewAnimationsSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsLanguageRow)
        try self.assertScreenVisible(screen: .languageSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.languageSettingsSystemText,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertTextExistsScrollingIntoView("English", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExistsScrollingIntoView("Spanish Spain", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsAccessRow)
        try self.assertTextExists("Permissions", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsDecksRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsTagsRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsExportRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)

        try self.assertTextExistsScrollingIntoView("Support", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsFeedbackRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsLegalRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsSupportRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsOpenSourceRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)

        try self.assertTextExistsScrollingIntoView("Advanced", timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsSchedulingRow)
        try self.assertTextExists("Scheduler", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsAgentConnectionsRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsServerRow)
        try self.assertTextExists("Current Server", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsDeviceDiagnosticsRow)
        try self.assertTextExists("Operating system", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.returnToSettingsRoot()

        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsResetStudyProgressRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.settingsDeleteCurrentWorkspaceRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)

        try self.openSettingsRootRow(identifier: LiveSmokeIdentifier.settingsDeleteAccountRow)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.dangerZoneDeleteAccountButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.returnToSettingsRoot()

        if self.app.buttons[LiveSmokeIdentifier.settingsTestRow].firstMatch.exists {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Test settings row should be hidden when test mode is off.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func openSettingsRootRow(identifier: String) throws {
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButtonScrollingIntoView(
            identifier: identifier,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
    }

    @MainActor
    private func assertReviewAnimationsRowOrder() throws {
        try self.assertElementExistsScrollingIntoView(
            identifier: LiveSmokeIdentifier.settingsReviewRemindersRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementExistsScrollingIntoView(
            identifier: LiveSmokeIdentifier.settingsReviewAnimationsRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementExistsScrollingIntoView(
            identifier: LiveSmokeIdentifier.settingsLanguageRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )

        let remindersFrame = self.app.buttons[LiveSmokeIdentifier.settingsReviewRemindersRow].firstMatch.frame
        let animationsFrame = self.app.buttons[LiveSmokeIdentifier.settingsReviewAnimationsRow].firstMatch.frame
        let languageFrame = self.app.buttons[LiveSmokeIdentifier.settingsLanguageRow].firstMatch.frame
        if remindersFrame.minY < animationsFrame.minY && animationsFrame.minY < languageFrame.minY {
            return
        }

        throw LiveSmokeFailure.unexpectedAccountState(
            message: "Review Animations row should appear after Review Reminders and before Language.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func returnToSettingsRoot() throws {
        try self.tapFirstNavigationBackButton()
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func testLiveSmokeResetWorkspaceProgressFlow() throws {
        let context = self.makeRunContext()
        let reviewEmail = try self.configuredReviewEmail()

        try self.runSignedInLinkedWorkspaceScenario(context: context, reviewEmail: reviewEmail) {
            try self.step("create one manual card in the linked workspace") {
                try self.tapTabBarItem(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.createManualCard(frontText: context.manualFrontText, backText: context.manualBackText)
            }

            try self.step("review the manual card once") {
                try self.tapTabBarItem(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.reviewCurrentCard(expectedFrontText: context.manualFrontText)
            }

            try self.step("reset workspace progress and verify the preview count") {
                try self.openWorkspaceResetProgressFlow()
                let confirmationPhrase = try self.loadWorkspaceResetProgressConfirmationPhrase()
                try self.replaceTextSafely(
                    confirmationPhrase,
                    inElementWithIdentifier: LiveSmokeIdentifier.resetWorkspaceProgressConfirmationField,
                    timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
                )
                try self.tapButton(
                    identifier: LiveSmokeIdentifier.resetWorkspaceProgressContinueButton,
                    timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
                )
                try self.confirmWorkspaceResetProgressPreview(expectedCardsToResetCount: 1)
                try self.tapButton(
                    identifier: LiveSmokeIdentifier.resetWorkspaceProgressButton,
                    timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
                )
                try self.assertScreenVisible(screen: .resetStudyProgress, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                try self.tapFirstNavigationBackButton()
                try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }

            try self.step("verify the reset card is reviewable again") {
                try self.tapTabBarItem(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.reviewCurrentCard(expectedFrontText: context.manualFrontText)
                try self.tapTabBarItem(selectedTab: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
        }
    }

    @MainActor
    func testLiveSmokeNotificationTapColdStartOpensReviewOnce() throws {
        try self.step("verify notification tap cold start opens review once") {
            try self.launchApplicationWithAppNotificationTap(
                launchScenario: .guestManualReviewCard,
                selectedTab: .cards,
                appNotificationTapType: .reviewReminder
            )
            try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            try self.tapTabBarItem(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            XCUIDevice.shared.press(.home)
            self.app.activate()
            try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    func testLiveSmokeUnsupportedNotificationTapDoesNotNavigate() throws {
        try self.step("verify unsupported notification tap stays on selected tab") {
            try self.launchApplicationWithAppNotificationTap(
                launchScenario: .guestEmptyWorkspace,
                selectedTab: .cards,
                appNotificationTapType: .unsupported
            )
            try self.waitForSelectedTabScreen(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    // Real SpringBoard local-notification tap smoke is intentionally omitted here.
    // On the iOS 26.4 simulator, XCTest reaches Notification Center but the system
    // routes the tap into a side-swipe hint instead of executing the default action.

    @MainActor
    // TODO: Flatten the Workspace flow.
    // Settings currently opens Workspace, which then requires another tap on
    // an inner Workspace row before the chooser appears. Replace that nested flow
    // with a direct workspace chooser surface, then restore this smoke test and
    // make it verify linked-workspace creation and persistence again.
    func testLiveSmokeLoginAndLinkedWorkspaceFlow() throws {
        throw XCTSkip(
            "TODO: Restore after flattening the nested Workspace flow and reworking the linked-workspace smoke path."
        )
    }

    @MainActor
    private func configuredReviewEmail() throws -> String {
        guard let reviewEmail = ProcessInfo.processInfo.environment[LiveSmokeConfiguration.reviewEmailEnvironmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              reviewEmail.isEmpty == false else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Missing required environment variable \(LiveSmokeConfiguration.reviewEmailEnvironmentKey) for linked-workspace smoke.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        return reviewEmail
    }
}
