import XCTest

final class LiveSmokeOwnOpenAIKeyTests: LiveSmokeTestCase {
    @MainActor
    func testOwnKeyPersistsAcrossRelaunchAndCanBeDisabledAndRemoved() throws {
        let testKey = "sk-preflight-invalid"
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .settings)
        try self.openOwnKeySettings()

        let toggle = self.app.switches["ownOpenAIKeySettings.toggle"].firstMatch.switches.firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        XCTAssertEqual(toggle.value as? String, "0")
        toggle.clickOrTap()

        let field = self.app.secureTextFields["ownOpenAIKeySettings.keyField"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        XCTAssertTrue(field.isEnabled)
        field.clickOrTap()
        field.typeText(testKey)
        try self.tapFirstNavigationBackButton()
        self.app.terminate()

        try self.launchApplication(launchScenario: nil, selectedTab: .settings)
        try self.openOwnKeySettings()
        let restoredToggle = self.app.switches["ownOpenAIKeySettings.toggle"].firstMatch.switches.firstMatch
        XCTAssertEqual(restoredToggle.value as? String, "1")
        let restoredField = self.app.secureTextFields["ownOpenAIKeySettings.keyField"].firstMatch
        XCTAssertEqual((restoredField.value as? String)?.count, testKey.count)

        restoredToggle.clickOrTap()
        XCTAssertFalse(restoredField.exists)
        restoredToggle.clickOrTap()
        XCTAssertEqual((restoredField.value as? String)?.count, testKey.count)
        restoredField.clickOrTap()
        restoredField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: testKey.count))
        try self.tapFirstNavigationBackButton()
        try self.openOwnKeySettings()
        XCTAssertEqual(self.app.secureTextFields["ownOpenAIKeySettings.keyField"].firstMatch.value as? String, "")
        self.app.switches["ownOpenAIKeySettings.toggle"].firstMatch.switches.firstMatch.clickOrTap()
    }

    @MainActor
    private func openOwnKeySettings() throws {
        try self.tapSettingsButtonScrollingIntoView(
            identifier: "settings.ownOpenAIKeyRow",
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
    }
}
