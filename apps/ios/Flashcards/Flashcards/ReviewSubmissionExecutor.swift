import Foundation

/// Executes review submissions away from ``MainActor`` so UI updates stay instant.
protocol ReviewSubmissionExecuting: Sendable {
    /// Persists one review submission and returns the updated card snapshot.
    func submitReview(workspaceId: String, submission: ReviewSubmission) async throws -> Card
}

/// Default review submission worker backed by the local SQLite database.
actor ReviewSubmissionExecutor: ReviewSubmissionExecuting {
    private let databaseURL: URL
    private var database: LocalDatabase?

    init(databaseURL: URL) {
        self.databaseURL = databaseURL
        self.database = nil
    }

    func submitReview(workspaceId: String, submission: ReviewSubmission) async throws -> Card {
        let database = try self.resolvedDatabase()
        return try database.submitReview(workspaceId: workspaceId, reviewSubmission: submission)
    }

    private func resolvedDatabase() throws -> LocalDatabase {
        if let database {
            return database
        }

        let database = try LocalDatabase(databaseURL: self.databaseURL)
        self.database = database
        return database
    }
}
