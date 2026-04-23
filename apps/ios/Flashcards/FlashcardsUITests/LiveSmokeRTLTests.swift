import Foundation
import XCTest

final class LiveSmokeRTLTests: LiveSmokeTestCase {
    @MainActor
    func testLiveSmokeArabicRTLTopLevelNavigation() throws {
        try self.step("launch Arabic RTL review surface") {
            try self.launchArabicRTLApplication(
                launchScenario: .guestManualReviewCard,
                selectedTab: .review
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
        }

        try self.step("switch Arabic RTL to cards tab") {
            try self.tapTabBarItem(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.cardsAddButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
        }

        try self.step("switch Arabic RTL to AI tab") {
            try self.tapTabBarItem(selectedTab: .ai, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertAiEntrySurfaceVisible()
        }

        try self.step("switch Arabic RTL to settings tab") {
            try self.tapTabBarItem(selectedTab: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.step("open Arabic RTL settings navigation") {
            try self.openAccountStatus()
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.accountStatusSignInButton,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.tapFirstNavigationBackButton()
            try self.assertScreenVisible(screen: .accountSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapFirstNavigationBackButton()
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    private func launchArabicRTLApplication(
        launchScenario: LiveSmokeLaunchScenario?,
        selectedTab: LiveSmokeSelectedTab
    ) throws {
        if self.isApplicationRunning {
            self.app.terminate()
        }

        try self.launchApplication(
            launchScenario: launchScenario,
            selectedTab: selectedTab,
            launchLocalization: .arabic
        )
    }
}
