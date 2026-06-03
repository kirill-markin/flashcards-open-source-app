@testable import Flashcards


extension AIChatStoreTestSupport {
    @MainActor
    static func setAISurfaceVisibility(store: AIChatStore, isVisible: Bool) {
        if isVisible {
            store.hasExternalProviderConsent = true
        }
        var updatedSurfaceState = store.surfaceState
        let currentActivity = updatedSurfaceState.activity
        updatedSurfaceState.activity = AIChatSurfaceActivity(
            isSceneActive: isVisible,
            isAITabSelected: isVisible,
            hasExternalProviderConsent: isVisible ? true : currentActivity.hasExternalProviderConsent,
            workspaceId: currentActivity.workspaceId,
            cloudState: currentActivity.cloudState,
            linkedUserId: currentActivity.linkedUserId,
            activeWorkspaceId: currentActivity.activeWorkspaceId
        )
        store.surfaceState = updatedSurfaceState
    }
}
