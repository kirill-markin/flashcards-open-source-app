import Foundation

let aiChatHistoryStorageKey: String = "ai-chat-history"
let aiChatHistoryStorageKeyPrefix: String = "ai-chat-history::"
let aiChatDraftStorageKeyPrefix: String = "ai-chat-draft::"
private let aiChatMaxMessages: Int = 200
private let aiChatHistoryMigrationCleanupVersionKey: String = "ai-chat-history-cleanup-version"
private let aiChatHistoryMigrationCleanupVersion: Int = 2

func makeAIChatHistoryScopedWorkspaceId(
    workspaceId: String?,
    cloudSettings: CloudSettings?
) -> String? {
    let resolvedWorkspaceId = workspaceId?.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedWorkspaceId = resolvedWorkspaceId?.isEmpty == false ? resolvedWorkspaceId! : "default"

    switch cloudSettings?.cloudState {
    case .linked:
        let linkedUserId = cloudSettings?.linkedUserId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedUserId = linkedUserId?.isEmpty == false ? linkedUserId! : "linked-user"
        let activeWorkspaceId = cloudSettings?.activeWorkspaceId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedActiveWorkspaceId = activeWorkspaceId?.isEmpty == false ? activeWorkspaceId! : normalizedWorkspaceId
        return "linked::\(normalizedUserId)::\(normalizedActiveWorkspaceId)"
    case .guest:
        let guestUserId = cloudSettings?.linkedUserId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedUserId = guestUserId?.isEmpty == false ? guestUserId! : "guest-user"
        return "guest::\(normalizedUserId)::\(normalizedWorkspaceId)"
    case .disconnected, .linkingReady, .none:
        return "local::\(normalizedWorkspaceId)"
    }
}

func makeAIChatHistoryStorageKey(workspaceId: String) -> String {
    "\(aiChatHistoryStorageKeyPrefix)\(workspaceId)"
}

func clearStoredAIChatHistories(userDefaults: UserDefaults) {
    userDefaults.removeObject(forKey: aiChatHistoryStorageKey)

    for key in userDefaults.dictionaryRepresentation().keys where key.hasPrefix(aiChatHistoryStorageKeyPrefix) {
        userDefaults.removeObject(forKey: key)
    }

    for key in userDefaults.dictionaryRepresentation().keys where key.hasPrefix(aiChatDraftStorageKeyPrefix) {
        userDefaults.removeObject(forKey: key)
    }
}

func storeAIChatHistoryStateSynchronously(
    userDefaults: UserDefaults,
    encoder: JSONEncoder,
    workspaceId: String?,
    state: AIChatPersistedState
) throws {
    runAIChatHistoryMigrationCleanupIfNeeded(userDefaults: userDefaults)
    let trimmedState = AIChatPersistedState(
        messages: Array(state.messages.suffix(aiChatMaxMessages)),
        chatSessionId: state.chatSessionId,
        lastKnownChatConfig: state.lastKnownChatConfig
    )
    let data = try encoder.encode(trimmedState)
    userDefaults.set(data, forKey: aiChatHistoryStorageKeyForWorkspace(workspaceId: workspaceId))
}

func storeAIChatDraftSynchronously(
    userDefaults: UserDefaults,
    encoder: JSONEncoder,
    workspaceId: String?,
    sessionId: String?,
    draft: AIChatComposerDraft
) throws {
    runAIChatHistoryMigrationCleanupIfNeeded(userDefaults: userDefaults)
    guard let normalizedSessionId = normalizedAIChatDraftSessionId(sessionId: sessionId) else {
        return
    }
    let key = aiChatDraftStorageKeyForWorkspace(workspaceId: workspaceId, sessionId: normalizedSessionId)
    if draft.isEmpty {
        userDefaults.removeObject(forKey: key)
        return
    }

    let data = try encoder.encode(draft)
    userDefaults.set(data, forKey: key)
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
        runAIChatHistoryMigrationCleanupIfNeeded(userDefaults: self.userDefaults)
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
        do {
            try storeAIChatHistoryStateSynchronously(
                userDefaults: self.userDefaults,
                encoder: self.encoder,
                workspaceId: self.currentWorkspaceId,
                state: state
            )
        } catch {
            self.userDefaults.removeObject(forKey: self.storageKey())
        }
    }

    func clearState() async {
        self.userDefaults.removeObject(forKey: self.storageKey())
        removeStoredAIChatDrafts(
            userDefaults: self.userDefaults,
            workspaceId: self.currentWorkspaceId
        )
    }

    func loadDraft(workspaceId: String?, sessionId: String?) -> AIChatComposerDraft {
        runAIChatHistoryMigrationCleanupIfNeeded(userDefaults: self.userDefaults)
        guard let normalizedSessionId = normalizedAIChatDraftSessionId(sessionId: sessionId) else {
            return AIChatComposerDraft(inputText: "", pendingAttachments: [])
        }
        let resolvedKey = aiChatDraftStorageKeyForWorkspace(
            workspaceId: workspaceId,
            sessionId: normalizedSessionId
        )

        if let data = self.userDefaults.data(forKey: resolvedKey) {
            do {
                return try self.decoder.decode(AIChatComposerDraft.self, from: data)
            } catch {
                self.userDefaults.removeObject(forKey: resolvedKey)
                return AIChatComposerDraft(inputText: "", pendingAttachments: [])
            }
        }

        return AIChatComposerDraft(inputText: "", pendingAttachments: [])
    }

    func saveDraft(workspaceId: String?, sessionId: String?, draft: AIChatComposerDraft) async {
        do {
            try storeAIChatDraftSynchronously(
                userDefaults: self.userDefaults,
                encoder: self.encoder,
                workspaceId: workspaceId,
                sessionId: sessionId,
                draft: draft
            )
        } catch {
            guard let normalizedSessionId = normalizedAIChatDraftSessionId(sessionId: sessionId) else {
                return
            }
            self.userDefaults.removeObject(
                forKey: aiChatDraftStorageKeyForWorkspace(
                    workspaceId: workspaceId,
                    sessionId: normalizedSessionId
                )
            )
        }
    }

    private func storageKey() -> String {
        aiChatHistoryStorageKeyForWorkspace(workspaceId: self.currentWorkspaceId)
    }
}

private func aiChatHistoryStorageKeyForWorkspace(workspaceId: String?) -> String {
    guard let workspaceId, workspaceId.isEmpty == false else {
        return aiChatHistoryStorageKey
    }

    return makeAIChatHistoryStorageKey(workspaceId: workspaceId)
}

private func aiChatDraftStorageKeyForWorkspace(
    workspaceId: String?,
    sessionId: String
) -> String {
    guard let workspaceId, workspaceId.isEmpty == false else {
        return "\(aiChatDraftStorageKeyPrefix)\(sessionId)"
    }

    return "\(aiChatDraftStorageKeyPrefix)\(workspaceId)::\(sessionId)"
}

private func normalizedAIChatDraftSessionId(sessionId: String?) -> String? {
    let normalizedSessionId = sessionId?.trimmingCharacters(in: .whitespacesAndNewlines)
    return normalizedSessionId?.isEmpty == false ? normalizedSessionId! : nil
}

private func removeStoredAIChatDrafts(
    userDefaults: UserDefaults,
    workspaceId: String?
) {
    for key in userDefaults.dictionaryRepresentation().keys
        where aiChatDraftStorageKeyMatchesWorkspace(key: key, workspaceId: workspaceId) {
        userDefaults.removeObject(forKey: key)
    }
}

private func aiChatDraftStorageKeyMatchesWorkspace(
    key: String,
    workspaceId: String?
) -> Bool {
    if let workspaceId, workspaceId.isEmpty == false {
        return key.hasPrefix("\(aiChatDraftStorageKeyPrefix)\(workspaceId)::")
    }

    guard key.hasPrefix(aiChatDraftStorageKeyPrefix) else {
        return false
    }

    let suffix = key.dropFirst(aiChatDraftStorageKeyPrefix.count)
    return suffix.contains("::") == false
}

private func runAIChatHistoryMigrationCleanupIfNeeded(userDefaults: UserDefaults) {
    let storedVersion = userDefaults.integer(forKey: aiChatHistoryMigrationCleanupVersionKey)
    if storedVersion >= aiChatHistoryMigrationCleanupVersion {
        return
    }

    clearStoredAIChatHistories(userDefaults: userDefaults)
    userDefaults.set(
        aiChatHistoryMigrationCleanupVersion,
        forKey: aiChatHistoryMigrationCleanupVersionKey
    )
}
