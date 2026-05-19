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
