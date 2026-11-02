import Foundation

/// Returns nil when the Review tab badge should be hidden.
func makeReviewDueBadgeLabel(dueCount: Int) -> String? {
    guard dueCount > 0 else {
        return nil
    }

    return dueCount.formatted()
}

@MainActor
extension FlashcardsStore {
    /// Publishes the due count for the current workspace and Review filter, then sleeps until the next
    /// card becomes due. The caller cancels and restarts it whenever the workspace, the Review filter, local
    /// data, or the scene phase changes.
    func runReviewDueBadgeUpdates() async {
        do {
            while true {
                guard let database = self.database, let workspaceId = self.workspace?.workspaceId else {
                    self.reviewDueBadgeCount = 0
                    return
                }

                let resolvedReviewQuery = try database.loadResolvedReviewQuery(
                    workspaceId: workspaceId,
                    reviewFilter: self.selectedReviewFilter
                )
                let snapshot = try await loadReviewDueBadgeSnapshotInBackground(
                    databaseURL: database.databaseURL,
                    workspaceId: workspaceId,
                    reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
                    now: Date()
                )
                // The detached query ignores cancellation, so a superseded run must not publish its result.
                try Task.checkCancellation()
                self.reviewDueBadgeCount = snapshot.dueCount

                guard let nextDueAt = snapshot.nextDueAt else {
                    return
                }
                try await Task.sleep(for: .seconds(max(0, nextDueAt.timeIntervalSinceNow)))
            }
        } catch is CancellationError {
            return
        } catch {
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
        }
    }
}
