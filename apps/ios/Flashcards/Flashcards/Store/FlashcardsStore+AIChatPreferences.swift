import Foundation

private let aiChatComposerSuggestionsEnabledUserDefaultsKey: String = "ai-chat-composer-suggestions-enabled"

func loadAIChatComposerSuggestionsEnabled(userDefaults: UserDefaults) -> Bool {
    guard userDefaults.object(forKey: aiChatComposerSuggestionsEnabledUserDefaultsKey) != nil else {
        return true
    }

    return userDefaults.bool(forKey: aiChatComposerSuggestionsEnabledUserDefaultsKey)
}

private func persistAIChatComposerSuggestionsEnabled(userDefaults: UserDefaults, isEnabled: Bool) -> Void {
    userDefaults.set(isEnabled, forKey: aiChatComposerSuggestionsEnabledUserDefaultsKey)
}

extension FlashcardsStore {
    func updateAIChatComposerSuggestionsEnabled(isEnabled: Bool) -> Void {
        self.aiChatComposerSuggestionsEnabled = isEnabled
        persistAIChatComposerSuggestionsEnabled(userDefaults: self.userDefaults, isEnabled: isEnabled)
        self.cachedAIChatStore?.areComposerSuggestionsEnabled = isEnabled
    }
}
