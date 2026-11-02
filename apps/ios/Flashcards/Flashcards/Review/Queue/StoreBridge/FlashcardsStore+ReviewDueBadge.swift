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
    /// Publishes the due count for the current workspace and Review filter and arms the next-due timer. The caller
    /// restarts it whenever the workspace, the Review filter, local data, or the scene phase changes; a rating
    /// adjusts the badge through its reconcile and moves only the timer.
    /// See docs/fsrs-scheduling-logic.md#non-blocking-review.
    func runReviewDueBadgeUpdates() async {
        do {
            guard let database = self.database, let workspaceId = self.workspace?.workspaceId else {
                self.reviewDueBadgeCount = 0
                self.scheduleNextDueRefresh(nextDueAt: nil)
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
            self.scheduleNextDueRefresh(nextDueAt: snapshot.nextDueAt)
        } catch is CancellationError {
            return
        } catch {
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
        }
    }
}
