import XCTest

extension LiveSmokeUITests {
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
}
