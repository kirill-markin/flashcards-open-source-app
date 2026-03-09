import Foundation

private let aiChatHistoryStorageKey: String = "ai-chat-history"
private let aiChatMaxMessages: Int = 200

final class AIChatHistoryStore: AIChatHistoryStoring {
    private let userDefaults: UserDefaults
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(userDefaults: UserDefaults, encoder: JSONEncoder, decoder: JSONDecoder) {
        self.userDefaults = userDefaults
        self.encoder = encoder
        self.decoder = decoder
    }

    func loadState() -> AIChatPersistedState {
        guard let data = self.userDefaults.data(forKey: aiChatHistoryStorageKey) else {
            return AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
        }

        do {
            let state = try self.decoder.decode(AIChatPersistedState.self, from: data)
            let trimmedMessages = Array(state.messages.suffix(aiChatMaxMessages))
            let selectedModelId = AIChatModelDef.all.contains { model in
                model.id == state.selectedModelId
            } ? state.selectedModelId : aiChatDefaultModelId
            return AIChatPersistedState(messages: trimmedMessages, selectedModelId: selectedModelId)
        } catch {
            self.userDefaults.removeObject(forKey: aiChatHistoryStorageKey)
            return AIChatPersistedState(messages: [], selectedModelId: aiChatDefaultModelId)
        }
    }

    func saveState(state: AIChatPersistedState) {
        let trimmedState = AIChatPersistedState(
            messages: Array(state.messages.suffix(aiChatMaxMessages)),
            selectedModelId: state.selectedModelId
        )

        do {
            let data = try self.encoder.encode(trimmedState)
            self.userDefaults.set(data, forKey: aiChatHistoryStorageKey)
        } catch {
            self.userDefaults.removeObject(forKey: aiChatHistoryStorageKey)
        }
    }

    func clearState() {
        self.userDefaults.removeObject(forKey: aiChatHistoryStorageKey)
    }
}
