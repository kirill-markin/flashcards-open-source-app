import XCTest
@testable import Flashcards

@MainActor
final class AppNavigationModelTests: XCTestCase {
    func testSelectTabUpdatesSelectedTab() {
        let navigation = AppNavigationModel()

        navigation.selectTab(.cards)

        XCTAssertEqual(navigation.selectedTab, .cards)
    }

    func testOpenCardCreationSelectsCardsAndSetsPresentationRequest() {
        let navigation = AppNavigationModel()

        navigation.openCardCreation()

        XCTAssertEqual(navigation.selectedTab, .cards)
        XCTAssertEqual(navigation.cardsPresentationRequest, .createCard)
    }

    func testClearCardsPresentationRequestRemovesPendingRequest() {
        let navigation = AppNavigationModel()
        navigation.openCardCreation()

        navigation.clearCardsPresentationRequest()

        XCTAssertNil(navigation.cardsPresentationRequest)
    }

    func testOpenAICardCreationSelectsAIAndSetsPresentationRequest() {
        let navigation = AppNavigationModel()

        navigation.openAICardCreation()

        XCTAssertEqual(navigation.selectedTab, .ai)
        XCTAssertEqual(navigation.aiChatPresentationRequest, .createCard)
    }

    func testClearAIChatPresentationRequestRemovesPendingRequest() {
        let navigation = AppNavigationModel()
        navigation.openAICardCreation()

        navigation.clearAIChatPresentationRequest()

        XCTAssertNil(navigation.aiChatPresentationRequest)
    }

    func testOpenSettingsBuildsSettingsPath() {
        let navigation = AppNavigationModel()

        navigation.openSettings(destination: .accountServer)

        XCTAssertEqual(navigation.selectedTab, .settings)
        XCTAssertEqual(navigation.settingsPath, [.account, .accountAdvanced, .accountServer])
    }
}
