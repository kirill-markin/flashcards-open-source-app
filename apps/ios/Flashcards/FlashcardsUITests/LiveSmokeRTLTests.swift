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

        try self.step("switch Arabic RTL to library cards") {
            try self.openLibraryCards()
            // Mac finds toolbar items by English label, so it checks only the screen root.
            #if !targetEnvironment(macCatalyst)
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.cardsAddButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            #endif
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
            // Mac returns with the Settings command (Command-,) instead of the English-labeled Back item.
            #if targetEnvironment(macCatalyst)
            self.app.typeKey(",", modifierFlags: .command)
            try self.assertElementDoesNotExist(
                identifier: LiveSmokeIdentifier.accountStatusSignInButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            #else
            try self.tapFirstNavigationBackButton()
            #endif
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
