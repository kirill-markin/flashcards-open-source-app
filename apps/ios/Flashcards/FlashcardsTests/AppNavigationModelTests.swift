import XCTest
@testable import Flashcards

final class AppNavigationModelTests: XCTestCase {
    @MainActor
    func testSelectTabUpdatesSelectedTab() {
        let navigation = AppNavigationModel()

        navigation.selectTab(.cards)

        XCTAssertEqual(navigation.selectedTab, .cards)
    }

    @MainActor
    func testOpenCardCreationSelectsCardsAndSetsPresentationRequest() {
        let navigation = AppNavigationModel()

        navigation.openCardCreation()

        XCTAssertEqual(navigation.selectedTab, .cards)
        XCTAssertEqual(navigation.cardsPresentationRequest, .createCard)
    }

    @MainActor
    func testClearCardsPresentationRequestRemovesPendingRequest() {
        let navigation = AppNavigationModel()
        navigation.openCardCreation()

        navigation.clearCardsPresentationRequest()

        XCTAssertNil(navigation.cardsPresentationRequest)
    }

    @MainActor
    func testOpenAICardCreationSelectsAIAndSetsPresentationRequest() {
        let navigation = AppNavigationModel()

        navigation.openAICardCreation()

        XCTAssertEqual(navigation.selectedTab, .ai)
        XCTAssertEqual(navigation.aiChatPresentationRequest, .createCard)
    }

    @MainActor
    func testClearAIChatPresentationRequestRemovesPendingRequest() {
        let navigation = AppNavigationModel()
        navigation.openAICardCreation()

        navigation.clearAIChatPresentationRequest()

        XCTAssertNil(navigation.aiChatPresentationRequest)
    }

    @MainActor
    func testOpenSettingsBuildsSettingsPath() {
        let navigation = AppNavigationModel()

        navigation.openSettings(destination: .accountServer)

        XCTAssertEqual(navigation.selectedTab, .settings)
        XCTAssertEqual(navigation.settingsPath, [.account, .accountAdvanced, .accountServer])
    }

    @MainActor
    func testOpenWorkspaceExportBuildsSettingsPath() {
        let navigation = AppNavigationModel()

        navigation.openSettings(destination: .workspaceExport)

        XCTAssertEqual(navigation.selectedTab, .settings)
        XCTAssertEqual(navigation.settingsPath, [.workspace, .workspaceExport])
    }

    @MainActor
    func testOpenCurrentWorkspaceBuildsSettingsPath() {
        let navigation = AppNavigationModel()

        navigation.openSettings(destination: .currentWorkspace)

        XCTAssertEqual(navigation.selectedTab, .settings)
        XCTAssertEqual(navigation.settingsPath, [.currentWorkspace])
    }

    @MainActor
    func testOpenDeviceBuildsSettingsPath() {
        let navigation = AppNavigationModel()

        navigation.openSettings(destination: .device)

        XCTAssertEqual(navigation.selectedTab, .settings)
        XCTAssertEqual(navigation.settingsPath, [.device])
    }
}
