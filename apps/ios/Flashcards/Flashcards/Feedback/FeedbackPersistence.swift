import Foundation

let feedbackPromptStateUserDefaultsKey: String = "feedback-prompt-state-v1"
let feedbackDraftUserDefaultsKey: String = "feedback-draft-v1"

func loadFeedbackPromptState(
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) -> PersistedFeedbackPromptState {
    guard let data = userDefaults.data(forKey: feedbackPromptStateUserDefaultsKey) else {
        return makeDefaultFeedbackPromptState()
    }

    do {
        return try decoder.decode(PersistedFeedbackPromptState.self, from: data)
    } catch {
        userDefaults.removeObject(forKey: feedbackPromptStateUserDefaultsKey)
        return makeDefaultFeedbackPromptState()
    }
}

func saveFeedbackPromptState(
    state: PersistedFeedbackPromptState,
    userDefaults: UserDefaults,
    encoder: JSONEncoder
) {
    do {
        let data = try encoder.encode(state)
        userDefaults.set(data, forKey: feedbackPromptStateUserDefaultsKey)
    } catch {
        userDefaults.removeObject(forKey: feedbackPromptStateUserDefaultsKey)
    }
}

func loadFeedbackDraft(userDefaults: UserDefaults) -> String {
    userDefaults.string(forKey: feedbackDraftUserDefaultsKey) ?? ""
}

func saveFeedbackDraft(
    message: String,
    userDefaults: UserDefaults
) {
    if message.isEmpty {
        userDefaults.removeObject(forKey: feedbackDraftUserDefaultsKey)
        return
    }

    userDefaults.set(message, forKey: feedbackDraftUserDefaultsKey)
}

func clearFeedbackDraft(userDefaults: UserDefaults) {
    userDefaults.removeObject(forKey: feedbackDraftUserDefaultsKey)
}
