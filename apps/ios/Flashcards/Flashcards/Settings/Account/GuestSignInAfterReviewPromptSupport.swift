import Foundation

let guestSignInAfterReviewPromptUserDefaultsKey: String = "guest-sign-in-after-review-prompt-v1"
let guestSignInAfterReviewPromptReviewThreshold: Int = 20
let guestSignInAfterReviewPromptReviewIncreaseThreshold: Int = 10
let guestSignInAfterReviewPromptSnoozeSeconds: TimeInterval = 7 * 24 * 60 * 60

struct GuestSignInAfterReviewPromptState: Codable, Hashable, Sendable {
    let lastShownAt: Date?
    let snoozedUntil: Date?
    let lastShownReviewCount: Int?
    let acceptedAt: Date?
}

func makeDefaultGuestSignInAfterReviewPromptState() -> GuestSignInAfterReviewPromptState {
    GuestSignInAfterReviewPromptState(
        lastShownAt: nil,
        snoozedUntil: nil,
        lastShownReviewCount: nil,
        acceptedAt: nil
    )
}

func shouldPresentGuestSignInAfterReviewPrompt(
    cloudState: CloudAccountState?,
    reviewedCount: Int,
    promptState: GuestSignInAfterReviewPromptState,
    now: Date,
    isModalOrAuthFlowActive: Bool
) -> Bool {
    guard cloudState == .guest else {
        return false
    }
    guard reviewedCount >= guestSignInAfterReviewPromptReviewThreshold else {
        return false
    }
    guard promptState.acceptedAt == nil else {
        return false
    }
    guard isModalOrAuthFlowActive == false else {
        return false
    }
    if let snoozedUntil = promptState.snoozedUntil {
        guard now >= snoozedUntil else {
            return false
        }
        if let lastShownReviewCount = promptState.lastShownReviewCount {
            return reviewedCount >= lastShownReviewCount + guestSignInAfterReviewPromptReviewIncreaseThreshold
        }
    }

    return true
}

func nextGuestSignInAfterReviewPromptRecheckDate(
    cloudState: CloudAccountState?,
    reviewedCount: Int,
    promptState: GuestSignInAfterReviewPromptState,
    now: Date,
    isModalOrAuthFlowActive: Bool
) -> Date? {
    guard cloudState == .guest else {
        return nil
    }
    guard reviewedCount >= guestSignInAfterReviewPromptReviewThreshold else {
        return nil
    }
    guard promptState.acceptedAt == nil else {
        return nil
    }
    guard isModalOrAuthFlowActive == false else {
        return nil
    }
    guard let snoozedUntil = promptState.snoozedUntil, now < snoozedUntil else {
        return nil
    }
    if let lastShownReviewCount = promptState.lastShownReviewCount {
        guard reviewedCount >= lastShownReviewCount + guestSignInAfterReviewPromptReviewIncreaseThreshold else {
            return nil
        }
    }

    return snoozedUntil
}

func makeGuestSignInAfterReviewPromptShownState(
    promptState: GuestSignInAfterReviewPromptState,
    reviewedCount: Int,
    now: Date
) -> GuestSignInAfterReviewPromptState {
    GuestSignInAfterReviewPromptState(
        lastShownAt: now,
        snoozedUntil: nil,
        lastShownReviewCount: reviewedCount,
        acceptedAt: promptState.acceptedAt
    )
}

func makeAcceptedGuestSignInAfterReviewPromptState(
    promptState: GuestSignInAfterReviewPromptState,
    now: Date
) -> GuestSignInAfterReviewPromptState {
    GuestSignInAfterReviewPromptState(
        lastShownAt: promptState.lastShownAt,
        snoozedUntil: promptState.snoozedUntil,
        lastShownReviewCount: promptState.lastShownReviewCount,
        acceptedAt: now
    )
}

func makeSnoozedGuestSignInAfterReviewPromptState(
    promptState: GuestSignInAfterReviewPromptState,
    reviewedCount: Int,
    now: Date
) -> GuestSignInAfterReviewPromptState {
    GuestSignInAfterReviewPromptState(
        lastShownAt: now,
        snoozedUntil: now.addingTimeInterval(guestSignInAfterReviewPromptSnoozeSeconds),
        lastShownReviewCount: reviewedCount,
        acceptedAt: promptState.acceptedAt
    )
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
        userDefaults.removeObject(forKey: guestSignInAfterReviewPromptUserDefaultsKey)
        return makeDefaultGuestSignInAfterReviewPromptState()
    }
}
