import Foundation

enum AIChatAccessState: Equatable {
    case consentRequired
    case ready
}

func hasAIChatExternalProviderConsent(userDefaults: UserDefaults) -> Bool {
    userDefaults.bool(forKey: aiChatExternalProviderConsentUserDefaultsKey)
}

func grantAIChatExternalProviderConsent(userDefaults: UserDefaults) {
    userDefaults.set(true, forKey: aiChatExternalProviderConsentUserDefaultsKey)
}

func aiChatAccessState(
    hasExternalProviderConsent: Bool
) -> AIChatAccessState {
    guard hasExternalProviderConsent else {
        return .consentRequired
    }

    return .ready
}

/// `AI_LIMIT_REACHED` is accepted ahead of the backend change that starts raising it for every
/// caller, guest and signed-in alike. `GUEST_AI_LIMIT_REACHED` is the guest-only code that change
/// supersedes, and it stays matched for as long as a deployed backend can still be raising it.
func isAiLimitReachedCode(_ code: String?) -> Bool {
    code == "AI_LIMIT_REACHED" || code == "GUEST_AI_LIMIT_REACHED"
}

/// Copy for a caller who cannot fix the limit by signing in.
func aiChatLimitReachedMessage() -> String {
    aiSettingsLocalized(
        "ai.error.limitReached",
        "Your AI limit for this month is used up. It resets at the start of next month."
    )
}
