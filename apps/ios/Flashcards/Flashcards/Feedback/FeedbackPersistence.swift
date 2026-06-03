import Foundation

let legacyFeedbackPromptStateUserDefaultsKey: String = "feedback-prompt-state-v1"
let legacyFeedbackDraftUserDefaultsKey: String = "feedback-draft-v1"
private let feedbackPromptStateUserDefaultsKeyPrefix: String = "feedback-prompt-state-v1:"
private let feedbackDraftUserDefaultsKeyPrefix: String = "feedback-draft-v1:"

func feedbackPromptStateUserDefaultsKey(identityKey: FeedbackPromptIdentityKey) -> String {
    "\(feedbackPromptStateUserDefaultsKeyPrefix)\(identityKey.rawValue)"
}

func feedbackDraftUserDefaultsKey(identityKey: FeedbackPromptIdentityKey) -> String {
    "\(feedbackDraftUserDefaultsKeyPrefix)\(identityKey.rawValue)"
}

func loadFeedbackPromptState(
    identityKey: FeedbackPromptIdentityKey,
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) -> PersistedFeedbackPromptState {
    let storageKey = feedbackPromptStateUserDefaultsKey(identityKey: identityKey)
    guard let data = userDefaults.data(forKey: storageKey) else {
        return makeDefaultFeedbackPromptState()
    }

    do {
        return try decoder.decode(PersistedFeedbackPromptState.self, from: data)
    } catch {
        userDefaults.removeObject(forKey: storageKey)
        return makeDefaultFeedbackPromptState()
    }
}

func saveFeedbackPromptState(
    identityKey: FeedbackPromptIdentityKey,
    state: PersistedFeedbackPromptState,
    userDefaults: UserDefaults,
    encoder: JSONEncoder
) {
    let storageKey = feedbackPromptStateUserDefaultsKey(identityKey: identityKey)
    do {
        let data = try encoder.encode(state)
        userDefaults.set(data, forKey: storageKey)
    } catch {
        userDefaults.removeObject(forKey: storageKey)
    }
}

func loadFeedbackDraft(
    identityKey: FeedbackPromptIdentityKey,
    userDefaults: UserDefaults
) -> String {
    userDefaults.string(forKey: feedbackDraftUserDefaultsKey(identityKey: identityKey)) ?? ""
}

func saveFeedbackDraft(
    identityKey: FeedbackPromptIdentityKey,
    message: String,
    userDefaults: UserDefaults
) {
    let storageKey = feedbackDraftUserDefaultsKey(identityKey: identityKey)
    if message.isEmpty {
        userDefaults.removeObject(forKey: storageKey)
        return
    }

    userDefaults.set(message, forKey: storageKey)
}

func clearFeedbackDraft(
    identityKey: FeedbackPromptIdentityKey,
    userDefaults: UserDefaults
) {
    userDefaults.removeObject(forKey: feedbackDraftUserDefaultsKey(identityKey: identityKey))
}

func clearFeedbackPromptPersistence(
    identityKey: FeedbackPromptIdentityKey,
    userDefaults: UserDefaults
) {
    userDefaults.removeObject(forKey: feedbackPromptStateUserDefaultsKey(identityKey: identityKey))
    userDefaults.removeObject(forKey: feedbackDraftUserDefaultsKey(identityKey: identityKey))
    userDefaults.removeObject(forKey: legacyFeedbackPromptStateUserDefaultsKey)
    userDefaults.removeObject(forKey: legacyFeedbackDraftUserDefaultsKey)
}
