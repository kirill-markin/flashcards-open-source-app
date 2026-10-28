import Foundation

let guestSignInAfterReviewPromptUserDefaultsKey: String = "guest-sign-in-after-review-prompt-v1"

struct GuestSignInAfterReviewPromptState: Codable, Hashable, Sendable {
    let lastShownAt: Date?
}

func makeDefaultGuestSignInAfterReviewPromptState() -> GuestSignInAfterReviewPromptState {
    GuestSignInAfterReviewPromptState(lastShownAt: nil)
}

func loadGuestSignInAfterReviewPromptState(
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) -> GuestSignInAfterReviewPromptState {
    guard let data = userDefaults.data(forKey: guestSignInAfterReviewPromptUserDefaultsKey) else {
        return makeDefaultGuestSignInAfterReviewPromptState()
    }

    do {
        return try decoder.decode(GuestSignInAfterReviewPromptState.self, from: data)
    } catch {
        captureGuestSignInAfterReviewPromptSilentFailure(
            error: error,
            action: "guest_sign_in_after_review_prompt_state_load",
            stage: "decode",
            cloudSettings: nil,
            workspaceId: nil,
            configurationMode: nil
        )
        userDefaults.removeObject(forKey: guestSignInAfterReviewPromptUserDefaultsKey)
        return makeDefaultGuestSignInAfterReviewPromptState()
    }
}
