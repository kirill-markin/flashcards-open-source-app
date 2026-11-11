import Foundation

func makeReviewDueBadgeLabel(dueCount: Int) -> String? {
    guard dueCount > 0 else {
        return nil
    }

    return dueCount.formatted()
}

struct WorkspaceReviewDueState: Equatable, Sendable {
    let workspaceId: String
    let localReadVersion: Int
    let count: Int
    let countedThrough: Date
    let nextDueAt: Date?
}

enum AppliedReviewLoadState: Hashable {
    case loading
    case incomplete
    case settled
}

enum AppliedReviewDueReconcileState: Equatable {
    case idle
    case active(cutoff: Date?)
}

@MainActor
extension FlashcardsStore {
    func publishAppliedReviewLoadCutoffIfReady(now: Date) {
        guard self.appliedReviewLoadState == .loading,
              self.isReviewHeadLoading == false, self.isReviewCountsLoading == false else {
            return
        }
        self.appliedReviewLoadState = .settled
        self.appliedReviewDueCutoff = now
    }

    var workspaceReviewDueCount: Int {
        guard let workspaceReviewDue = self.workspaceReviewDue,
              workspaceReviewDue.workspaceId == self.workspace?.workspaceId else {
            return 0
        }
        return workspaceReviewDue.count
    }

    func refreshAppliedReviewDueTimer() async {
        guard let database = self.database, let workspaceId = self.workspace?.workspaceId,
              self.isReviewHeadLoading == false, self.isReviewCountsLoading == false,
              Task.isCancelled == false else {
            return
        }
        if self.appliedReviewLoadState != .settled {
            if self.appliedReviewDueReconcileState != .active(cutoff: self.appliedReviewDueCutoff) {
                self.scheduleNextDueRefresh(nextDueAt: Date())
            }
            return
        }
        guard let cutoff = self.appliedReviewDueCutoff,
              self.wakeOverdueAppliedReviewTimerIfNeeded(cutoff: cutoff) == false else {
            return
        }
        do {
            let filter = self.selectedReviewFilter
            let localReadVersion = self.localReadVersion
            let reviewScheduleVersion = self.reviewScheduleVersion
            let resolvedReviewQuery = try database.loadResolvedReviewQuery(
                workspaceId: workspaceId,
                reviewFilter: filter
            )
            let nextDueAt = try await loadNextReviewDueAtInBackground(
                databaseURL: database.databaseURL,
                workspaceId: workspaceId,
                reviewQueryDefinition: resolvedReviewQuery.queryDefinition,
                now: cutoff
            )
            try Task.checkCancellation()
            guard self.workspace?.workspaceId == workspaceId,
                  self.selectedReviewFilter == filter,
                  self.localReadVersion == localReadVersion,
                  self.appliedReviewDueCutoff == cutoff,
                  self.appliedReviewLoadState == .settled,
                  self.isReviewHeadLoading == false, self.isReviewCountsLoading == false,
                  self.wakeOverdueAppliedReviewTimerIfNeeded(cutoff: cutoff) == false else {
                return
            }
            if self.reviewScheduleVersion != reviewScheduleVersion,
               let currentNextDueAt = self.armedNextDueRefreshAt(),
               nextDueAt.map({ currentNextDueAt < $0 }) ?? true {
                return
            }
            self.scheduleNextDueRefresh(nextDueAt: nextDueAt)
        } catch is CancellationError {
            return
        } catch {
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
        }
    }

    private func wakeOverdueAppliedReviewTimerIfNeeded(cutoff: Date) -> Bool {
        guard let dueAt = self.armedNextDueRefreshAt(), dueAt > cutoff, dueAt <= Date() else {
            return false
        }
        // A wall-clock jump can make a timer due before its elapsed-time sleep ends.
        if self.appliedReviewDueReconcileState != .active(cutoff: cutoff) {
            self.scheduleNextDueRefresh(nextDueAt: dueAt)
        }
        return true
    }

    func applyWorkspaceReviewDueRating(previousCard: Card, ratedCard: Card, localReadVersion: Int) {
        guard let cached = self.workspaceReviewDue,
              cached.workspaceId == self.workspace?.workspaceId,
              cached.workspaceId == ratedCard.workspaceId,
              cached.localReadVersion == localReadVersion, self.localReadVersion == localReadVersion else {
            return
        }

        let countedThroughMillis = epochMillis(date: cached.countedThrough)
        let previousEligibility = workspaceReviewDueEligibility(card: previousCard, countedThroughMillis: countedThroughMillis)
        let ratedEligibility = workspaceReviewDueEligibility(card: ratedCard, countedThroughMillis: countedThroughMillis)
        let nextDueAt = ratedEligibility.futureDueAt.map { dueAt in
            min(dueAt, cached.nextDueAt ?? dueAt)
        } ?? cached.nextDueAt
        self.workspaceReviewDue = WorkspaceReviewDueState(
            workspaceId: cached.workspaceId,
            localReadVersion: cached.localReadVersion,
            count: cached.count + (ratedEligibility.isCounted ? 1 : 0) - (previousEligibility.isCounted ? 1 : 0),
            countedThrough: cached.countedThrough,
            nextDueAt: nextDueAt
        )
    }

    func runWorkspaceReviewDueUpdates() async {
        guard let databaseURL = self.localDatabaseURL, let workspaceId = self.workspace?.workspaceId else {
            return
        }
        let localReadVersion = self.localReadVersion
        let ratingVersion = self.workspaceReviewDueRatingVersion
        do {
            while self.workspace?.workspaceId == workspaceId,
                  self.localReadVersion == localReadVersion,
                  self.workspaceReviewDueRatingVersion == ratingVersion,
                  self.workspaceReviewDueRatingSavesInFlight == 0 {
                try Task.checkCancellation()
                let now = Date()
                let cached = self.workspaceReviewDue
                let previous = cached.flatMap { state in
                    state.workspaceId == workspaceId && state.localReadVersion == localReadVersion
                        && state.countedThrough <= now ? state : nil
                }
                if let previous {
                    guard let nextDueAt = previous.nextDueAt else {
                        return
                    }
                    if nextDueAt > now {
                        try await Task.sleep(for: .seconds(nextDueAt.timeIntervalSince(now)))
                        continue
                    }
                }
                let snapshot = try await loadWorkspaceReviewDueInBackground(
                    databaseURL: databaseURL,
                    workspaceId: workspaceId,
                    previous: previous,
                    now: now
                )
                // SQLite can see a rating before the store patches its cached count.
                try Task.checkCancellation()
                guard self.workspace?.workspaceId == workspaceId,
                      self.localReadVersion == localReadVersion,
                      self.workspaceReviewDueRatingVersion == ratingVersion,
                      self.workspaceReviewDueRatingSavesInFlight == 0 else {
                    return
                }
                guard self.workspaceReviewDue == cached else {
                    continue
                }
                self.workspaceReviewDue = WorkspaceReviewDueState(
                    workspaceId: workspaceId,
                    localReadVersion: localReadVersion,
                    count: snapshot.dueCount,
                    countedThrough: now,
                    nextDueAt: snapshot.nextDueAt
                )
            }
        } catch is CancellationError {
            return
        } catch {
            self.globalErrorMessage = Flashcards.errorMessage(error: error)
        }
    }
}

private func workspaceReviewDueEligibility(card: Card, countedThroughMillis: Int64) -> (isCounted: Bool, futureDueAt: Date?) {
    guard card.deletedAt == nil else {
        return (false, nil)
    }
    guard let dueAt = card.dueAt else {
        return (true, nil)
    }
    guard let date = parseIsoTimestamp(value: dueAt) else {
        return (false, nil)
    }
    let dueMillis = epochMillis(date: date)
    if dueMillis <= countedThroughMillis {
        return (true, nil)
    }
    return (false, Date(timeIntervalSince1970: TimeInterval(dueMillis) / 1_000))
}
