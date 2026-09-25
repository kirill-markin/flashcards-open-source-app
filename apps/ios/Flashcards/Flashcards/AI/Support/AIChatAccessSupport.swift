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

/// `AI_LIMIT_REACHED` is the code the backend raises when a signed-in account reaches its AI allowance;
/// `GUEST_AI_LIMIT_REACHED` is the code it raises for a guest.
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
