import Foundation

let aiChatHistoryStorageKey: String = "ai-chat-history"
let aiChatHistoryStorageKeyPrefix: String = "ai-chat-history::"
private let aiChatMaxMessages: Int = 200

func makeAIChatHistoryStorageKey(workspaceId: String) -> String {
    "\(aiChatHistoryStorageKeyPrefix)\(workspaceId)"
}

func clearStoredAIChatHistories(userDefaults: UserDefaults) {
    userDefaults.removeObject(forKey: aiChatHistoryStorageKey)

    for key in userDefaults.dictionaryRepresentation().keys where key.hasPrefix(aiChatHistoryStorageKeyPrefix) {
        userDefaults.removeObject(forKey: key)
    }
}

final class AIChatHistoryStore: AIChatHistoryStoring, @unchecked Sendable {
    private let userDefaults: UserDefaults
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var currentWorkspaceId: String?

    init(userDefaults: UserDefaults, encoder: JSONEncoder, decoder: JSONDecoder) {
        self.userDefaults = userDefaults
        self.encoder = encoder
        self.decoder = decoder
        self.currentWorkspaceId = nil
    }

    init(
        userDefaults: UserDefaults,
        encoder: JSONEncoder,
        decoder: JSONDecoder,
        workspaceId: String?
    ) {
        self.userDefaults = userDefaults
        self.encoder = encoder
        self.decoder = decoder
        self.currentWorkspaceId = workspaceId
    }

    func activateWorkspace(workspaceId: String?) {
        self.currentWorkspaceId = workspaceId
    }

    func loadState() -> AIChatPersistedState {
        guard let data = self.userDefaults.data(forKey: self.storageKey()) else {
            return AIChatPersistedState(
                messages: [],
                selectedModelId: aiChatDefaultModelId,
                chatSessionId: makeAIChatSessionId(),
                codeInterpreterContainerId: nil
            )
        }

        do {
            let state = try self.decoder.decode(AIChatPersistedState.self, from: data)
            let trimmedMessages = Array(state.messages.suffix(aiChatMaxMessages))
            let selectedModelId = AIChatModelDef.all.contains { model in
                model.id == state.selectedModelId
            } ? state.selectedModelId : aiChatDefaultModelId
            return AIChatPersistedState(
                messages: trimmedMessages,
                selectedModelId: selectedModelId,
                chatSessionId: state.chatSessionId,
                codeInterpreterContainerId: state.codeInterpreterContainerId
            )
        } catch {
            self.userDefaults.removeObject(forKey: self.storageKey())
            return AIChatPersistedState(
                messages: [],
                selectedModelId: aiChatDefaultModelId,
                chatSessionId: makeAIChatSessionId(),
                codeInterpreterContainerId: nil
            )
        }
    }

    func saveState(state: AIChatPersistedState) async {
        let trimmedState = AIChatPersistedState(
            messages: Array(state.messages.suffix(aiChatMaxMessages)),
            selectedModelId: state.selectedModelId,
            chatSessionId: state.chatSessionId,
            codeInterpreterContainerId: state.codeInterpreterContainerId
        )

        do {
            let data = try self.encoder.encode(trimmedState)
            self.userDefaults.set(data, forKey: self.storageKey())
        } catch {
            self.userDefaults.removeObject(forKey: self.storageKey())
        }
    }

    func clearState() async {
        self.userDefaults.removeObject(forKey: self.storageKey())
    }

    private func storageKey() -> String {
        guard let workspaceId = self.currentWorkspaceId, workspaceId.isEmpty == false else {
            return aiChatHistoryStorageKey
        }

        return makeAIChatHistoryStorageKey(workspaceId: workspaceId)
    }
}
