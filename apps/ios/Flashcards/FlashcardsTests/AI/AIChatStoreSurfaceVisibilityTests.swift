import XCTest
@testable import Flashcards

@MainActor
final class AIChatStoreSurfaceVisibilityTests: XCTestCase {
    func testStartFreshLocalSessionKeepsLiveAttachEnabledWhileAISurfaceIsVisible() throws {
        let context = AIChatStoreTestSupport.Context.make()
        defer {
            context.tearDown()
        }

        try context.configureGuestCloudSession()
        let store = context.makeStore()
        store.acceptExternalProviderConsent()
        store.updateSurface(
            activity: AIChatSurfaceActivity(
                isSceneActive: true,
                isAITabSelected: true,
                hasExternalProviderConsent: true,
                workspaceId: context.flashcardsStore.workspace?.workspaceId,
                cloudState: context.flashcardsStore.cloudSettings?.cloudState,
                linkedUserId: context.flashcardsStore.cloudSettings?.linkedUserId,
                activeWorkspaceId: context.flashcardsStore.cloudSettings?.activeWorkspaceId
            )
        )

        XCTAssertTrue(store.shouldKeepLiveAttached)

        store.startFreshLocalSession(
            inputText: "",
            pendingAttachments: []
        )

        XCTAssertTrue(store.shouldKeepLiveAttached)
    }
}
