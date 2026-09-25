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

extension FlashcardsStore {
    /// Turning the switch off keeps the stored key, so turning it on again reuses it.
    func updateOwnOpenAIKeyEnabled(isEnabled: Bool) throws -> Void {
        self.isOwnOpenAIKeyEnabled = isEnabled
        persistOwnOpenAIKeyEnabled(userDefaults: self.userDefaults, isEnabled: isEnabled)
        try self.reloadOwnOpenAIKeyActive()
    }

    func reloadOwnOpenAIKeyActive() throws -> Void {
        self.isOwnOpenAIKeyActive = try makeOwnOpenAIKeyStore(userDefaults: self.userDefaults).loadActiveApiKey() != nil
    }

    func loadOwnOpenAIKey() throws -> String {
        try makeOwnOpenAIKeyStore(userDefaults: self.userDefaults).loadApiKey()
    }

    func saveOwnOpenAIKey(apiKey: String) throws -> Void {
        try makeOwnOpenAIKeyStore(userDefaults: self.userDefaults).saveApiKey(apiKey: apiKey)
        self.isOwnOpenAIKeyActive = self.isOwnOpenAIKeyEnabled
            && apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    /**
     The key and its switch belong to the person leaving, so the next identity on this device never runs on them.

     Never throws: it runs inside the identity teardown after the credentials are gone, where a throw would leave
     the local data of the person leaving in place. The switch is turned off before the Keychain delete, so a
     failed delete still sends no key, and the failure is captured with the Keychain status only, never the key.
     */
    func resetOwnOpenAIKeyForCloudIdentityReset() -> Void {
        self.isOwnOpenAIKeyEnabled = false
        self.isOwnOpenAIKeyActive = false
        persistOwnOpenAIKeyEnabled(userDefaults: self.userDefaults, isEnabled: false)
        do {
            try makeOwnOpenAIKeyStore(userDefaults: self.userDefaults).saveApiKey(apiKey: "")
        } catch {
            FlashcardsObservability.captureSilentFailure(
                error: error,
                scope: IOSObservationScope(
                    feature: .aiChat,
                    userId: self.cloudSettings?.linkedUserId,
                    workspaceId: self.workspace?.workspaceId,
                    requestId: nil,
                    clientRequestId: nil,
                    sessionId: nil,
                    runId: nil,
                    cloudState: self.cloudSettings?.cloudState,
                    configurationMode: try? self.currentCloudServiceConfiguration().mode
                ),
                action: "own_openai_key_identity_reset",
                stage: "keychain_delete",
                statusCode: nil,
                backendCode: nil,
                requestId: nil
            )
        }
    }
}
