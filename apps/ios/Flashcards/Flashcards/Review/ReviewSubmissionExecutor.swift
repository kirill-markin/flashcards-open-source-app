import Foundation

/// Executes review submissions away from ``MainActor`` so UI updates stay instant.
protocol ReviewSubmissionExecuting: Sendable {
    /// Persists one review submission and returns the updated card snapshot.
    func submitReview(workspaceId: String, submission: ReviewSubmission) async throws -> Card
}

final class ReviewSubmissionOutboxMutationGate: @unchecked Sendable {
    private let lock: NSLock
    private var isBlockedForGuestUpgrade: Bool
    private var activeReviewSubmissionCount: Int
    private var activeReviewSubmissionWaiters: [CheckedContinuation<Void, Never>]

    init() {
        self.lock = NSLock()
        self.isBlockedForGuestUpgrade = false
        self.activeReviewSubmissionCount = 0
        self.activeReviewSubmissionWaiters = []
    }

    func beginReviewSubmission() throws {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }

        guard self.isBlockedForGuestUpgrade == false else {
            throw PendingGuestUpgradeLocalMutationError.blocked
        }

        self.activeReviewSubmissionCount += 1
    }

    func finishReviewSubmission() {
        let waiters: [CheckedContinuation<Void, Never>]

        self.lock.lock()
        guard self.activeReviewSubmissionCount > 0 else {
            self.lock.unlock()
            preconditionFailure("Review submission gate finished without an active submission")
        }

        self.activeReviewSubmissionCount -= 1
        if self.activeReviewSubmissionCount == 0 {
            waiters = self.activeReviewSubmissionWaiters
            self.activeReviewSubmissionWaiters = []
        } else {
            waiters = []
        }
        self.lock.unlock()

        for waiter in waiters {
            waiter.resume()
        }
    }

    func blockNewReviewSubmissionsAndWaitForActiveSubmissions() async {
        let hasActiveReviewSubmissions = self.blockNewReviewSubmissions()
        guard hasActiveReviewSubmissions else {
            return
        }

        await withCheckedContinuation { continuation in
            if self.appendActiveReviewSubmissionWaiterOrShouldResumeImmediately(continuation: continuation) {
                continuation.resume()
            }
        }
    }

    func unblockReviewSubmissions() {
        self.lock.lock()
        self.isBlockedForGuestUpgrade = false
        self.lock.unlock()
    }

    private func blockNewReviewSubmissions() -> Bool {
        self.lock.lock()
        self.isBlockedForGuestUpgrade = true
        let hasActiveReviewSubmissions = self.activeReviewSubmissionCount > 0
        self.lock.unlock()
        return hasActiveReviewSubmissions
    }

    private func appendActiveReviewSubmissionWaiterOrShouldResumeImmediately(
        continuation: CheckedContinuation<Void, Never>
    ) -> Bool {
        self.lock.lock()
        defer {
            self.lock.unlock()
        }

        if self.activeReviewSubmissionCount == 0 {
            return true
        }

        self.activeReviewSubmissionWaiters.append(continuation)
        return false
    }
}

/// Default review submission worker backed by the local SQLite database.
actor ReviewSubmissionExecutor: ReviewSubmissionExecuting {
    private let databaseURL: URL
    private let outboxMutationGate: ReviewSubmissionOutboxMutationGate
    private var database: LocalDatabase?

    init(databaseURL: URL, outboxMutationGate: ReviewSubmissionOutboxMutationGate) {
        self.databaseURL = databaseURL
        self.outboxMutationGate = outboxMutationGate
        self.database = nil
    }

    func submitReview(workspaceId: String, submission: ReviewSubmission) async throws -> Card {
        try self.outboxMutationGate.beginReviewSubmission()
        do {
            let database = try self.resolvedDatabase()
            let card = try database.submitReview(workspaceId: workspaceId, reviewSubmission: submission)
            self.outboxMutationGate.finishReviewSubmission()
            return card
        } catch {
            self.outboxMutationGate.finishReviewSubmission()
            throw error
        }
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
