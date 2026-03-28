import Foundation

let aiChatHistoryStorageKey: String = "ai-chat-history"
let aiChatHistoryStorageKeyPrefix: String = "ai-chat-history::"
private let aiChatMaxMessages: Int = 200
private let aiChatHistoryCleanupVersionKey: String = "ai-chat-history-cleanup-version"
private let aiChatHistoryCleanupVersion: Int = 1

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
        self.resetLegacyStateIfNeeded()
        guard let data = self.userDefaults.data(forKey: self.storageKey()) else {
            return AIChatPersistedState(
                messages: [],
                chatSessionId: "",
                lastKnownChatConfig: nil
            )
        }

        do {
            let state = try self.decoder.decode(AIChatPersistedState.self, from: data)
            let trimmedMessages = Array(state.messages.suffix(aiChatMaxMessages))
            return AIChatPersistedState(
                messages: trimmedMessages,
                chatSessionId: state.chatSessionId,
                lastKnownChatConfig: state.lastKnownChatConfig
            )
        } catch {
            self.userDefaults.removeObject(forKey: self.storageKey())
            return AIChatPersistedState(
                messages: [],
                chatSessionId: "",
                lastKnownChatConfig: nil
            )
        }
    }

    func saveState(state: AIChatPersistedState) async {
        self.resetLegacyStateIfNeeded()
        let trimmedState = AIChatPersistedState(
            messages: Array(state.messages.suffix(aiChatMaxMessages)),
            chatSessionId: state.chatSessionId,
            lastKnownChatConfig: state.lastKnownChatConfig
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

    private func resetLegacyStateIfNeeded() {
        let storedVersion = self.userDefaults.integer(forKey: aiChatHistoryCleanupVersionKey)
        if storedVersion >= aiChatHistoryCleanupVersion {
            return
        }

        clearStoredAIChatHistories(userDefaults: self.userDefaults)
        self.userDefaults.set(aiChatHistoryCleanupVersion, forKey: aiChatHistoryCleanupVersionKey)
    }
}
