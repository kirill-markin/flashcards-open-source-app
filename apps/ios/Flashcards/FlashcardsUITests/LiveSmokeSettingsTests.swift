import Foundation
import XCTest

final class LiveSmokeSettingsTests: LiveSmokeTestCase {
    @MainActor
    func testLiveSmokeLocalNavigationFlow() throws {
        try self.step("verify local navigation surfaces without login") {
            try self.launchApplication(resetState: .localGuest, selectedTab: .cards)
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.cardsAddButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )

            try self.tapTabBarItem(named: LiveSmokeScreen.review.title, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            try self.tapTabBarItem(named: LiveSmokeScreen.ai.title, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertAiEntrySurfaceVisible()

            try self.tapTabBarItem(named: LiveSmokeScreen.settings.title, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.openAccountStatus()
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.accountStatusSignInButton,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.tapFirstNavigationBackButton()
            try self.assertScreenVisible(screen: .accountSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapFirstNavigationBackButton()
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            try self.openAccountDangerZone()
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.dangerZoneDeleteAccountButton,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.tapFirstNavigationBackButton()
            try self.assertScreenVisible(screen: .accountSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapFirstNavigationBackButton()
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    func testLiveSmokeResetWorkspaceProgressFlow() throws {
        let context = self.makeRunContext()
        let reviewEmail = try self.configuredReviewEmail()

        try self.runSignedInLinkedWorkspaceScenario(context: context, reviewEmail: reviewEmail) {
            try self.step("create one manual card in the linked workspace") {
                try self.tapTabBarItem(named: LiveSmokeScreen.cards.title, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.createManualCard(frontText: context.manualFrontText, backText: context.manualBackText)
            }

            try self.step("review the manual card once") {
                try self.tapTabBarItem(named: LiveSmokeScreen.review.title, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
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
                try self.assertScreenVisible(screen: .workspaceSettings, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            }

            try self.step("verify the reset card is reviewable again") {
                try self.tapTabBarItem(named: LiveSmokeScreen.review.title, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.reviewCurrentCard(expectedFrontText: context.manualFrontText)
                try self.tapTabBarItem(named: LiveSmokeScreen.settings.title, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                let workspaceSettingsScreen = self.app.descendants(matching: .any)
                    .matching(identifier: LiveSmokeIdentifier.workspaceSettingsScreen)
                    .firstMatch
                if workspaceSettingsScreen.exists {
                    try self.tapFirstNavigationBackButton()
                }
                try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
        }
    }

    @MainActor
    func testLiveSmokeNotificationTapColdStartOpensReviewOnce() throws {
        try self.step("verify notification tap cold start opens review once") {
            try self.launchApplicationWithAppNotificationTap(
                resetState: .localGuestSeededManualReviewCard,
                selectedTab: .cards,
                appNotificationTapType: .reviewReminder
            )
            try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            try self.tapTabBarItem(named: LiveSmokeScreen.cards.title, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
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
                resetState: .localGuest,
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

    private func configuredReviewEmail() throws -> String {
        ProcessInfo.processInfo.environment[LiveSmokeConfiguration.reviewEmailEnvironmentKey] ?? "apple-review@example.com"
    }
}
