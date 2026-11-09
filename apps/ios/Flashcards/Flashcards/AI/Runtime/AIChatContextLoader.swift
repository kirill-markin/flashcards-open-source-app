import Foundation

actor AIChatContextLoader: AIChatContextLoading {
    private let databaseURL: URL

    init(databaseURL: URL) {
        self.databaseURL = databaseURL
    }

    func loadContext() async throws -> AIChatContext {
        try LocalDatabase(databaseURL: self.databaseURL).loadAIChatContext()
    }
}

struct UnavailableAIChatContextLoader: AIChatContextLoading {
    func loadContext() async throws -> AIChatContext {
        throw LocalStoreError.uninitialized("AI chat context is unavailable")
    }
}

extension LocalDatabase {
    func loadAIChatContext() throws -> AIChatContext {
        let bootstrapSnapshot = try self.loadBootstrapSnapshot()
        return AIChatContext(
            workspace: bootstrapSnapshot.workspace,
            schedulerSettings: bootstrapSnapshot.schedulerSettings,
            totalActiveCards: try self.cardStore.loadActiveCardCount(workspaceId: bootstrapSnapshot.workspace.workspaceId)
        )
    }
}
