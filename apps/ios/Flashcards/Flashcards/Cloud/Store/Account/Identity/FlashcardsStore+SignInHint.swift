import Foundation

@MainActor
extension FlashcardsStore {
    func signOutCloudAccountAndForgetFromPressedControl(screen: AnalyticsSurface) async throws {
        try self.cloudNativeSignIn.forgetRememberedHint()
        try await self.signOutCloudAccountFromPressedControl(screen: screen)
    }
}
