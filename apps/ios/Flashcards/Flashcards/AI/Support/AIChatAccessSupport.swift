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

/// Refusal copy for a caller without an account, where creating one is one of the ways forward.
func aiChatGuestLimitReachedMessage() -> String {
    aiSettingsLocalized(
        "ai.error.limitReached.guest",
        "You've used this month's free AI messages. Create an account or add your own OpenAI key in Settings to keep going."
    )
}

/// Refusal copy for a signed-in caller. Without a usage read there is no renewal date to name, so the copy drops that sentence only.
func aiChatAccountLimitReachedMessage(usage: AIMonthlyUsage?) -> String {
    guard let usage else {
        return aiSettingsLocalized(
            "ai.error.limitReached.accountWithoutDate",
            "You've used this month's AI messages. You can add your own OpenAI key in Settings to keep going."
        )
    }

    return aiSettingsLocalizedFormat(
        "ai.error.limitReached.account",
        "You've used this month's AI messages. They renew on %@. You can add your own OpenAI key in Settings to keep going.",
        usage.monthEndsAt.formatted(date: .long, time: .omitted)
    )
}
