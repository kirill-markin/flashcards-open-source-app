#if !targetEnvironment(macCatalyst)
import Foundation
import WidgetKit

// Mac Catalyst has no App Group, so the widget snapshot exists only on iOS and iPadOS.

let reviewWidgetKind: String = "ReviewWidget"
private let widgetSnapshotUpcomingDueLimit: Int = 100
private let widgetSnapshotFrontTextCharacterLimit: Int = 300

@MainActor
extension FlashcardsStore {
    /// Hands the Home Screen widget the Review tab badge count, the card Review shows next and the streak, then
    /// reloads its timeline. A snapshot that differs from the last one only in `generatedAt` is not written.
    func refreshWidgetSnapshot() async {
        guard let database = self.database, let workspaceId = self.workspace?.workspaceId else {
            return
        }

        let now = Date()
        let dueCount = self.reviewDueBadgeCount
        let presentedReviewCard = self.presentedReviewCard
        let streakDays = makeWidgetSnapshotStreakDays(badgeState: self.reviewProgressBadgeState)
        do {
            let databaseRead = try await loadWidgetSnapshotDatabaseReadInBackground(
                databaseURL: database.databaseURL,
                workspaceId: workspaceId,
                reviewFilter: self.selectedReviewFilter,
                isReviewCardPresented: presentedReviewCard != nil,
                upcomingDueLimit: widgetSnapshotUpcomingDueLimit,
                now: now
            )
            // The detached read ignores cancellation, and an identity reset may have replaced the workspace
            // meanwhile, so a superseded run must not write.
            try Task.checkCancellation()
            guard self.workspace?.workspaceId == workspaceId else {
                return
            }

            let snapshot = WidgetSnapshot(
                generatedAt: now,
                workspaceId: workspaceId,
                dueCount: dueCount,
                upcomingDueAt: databaseRead.upcomingDueAt,
                streakDays: streakDays,
                nextCard: makeWidgetSnapshotCard(
                    presentedReviewCard: presentedReviewCard,
                    reviewHeadCard: databaseRead.reviewHeadCard
                )
            )
            if let lastWrittenWidgetSnapshot = self.lastWrittenWidgetSnapshot,
               hasSameWidgetSnapshotContent(lhs: lastWrittenWidgetSnapshot, rhs: snapshot) {
                return
            }

            try writeWidgetSnapshot(snapshot: snapshot, fileURL: try widgetSnapshotFileURL())
            self.lastWrittenWidgetSnapshot = snapshot
            WidgetCenter.shared.reloadTimelines(ofKind: reviewWidgetKind)
        } catch is CancellationError {
            return
        } catch {
            self.captureWidgetFailure(error: error, workspaceId: workspaceId, action: "widget_snapshot_write")
        }
    }

    /// The departing identity's review data must not stay on the Home Screen.
    func deleteWidgetSnapshotForCloudIdentityReset() {
        let workspaceId = self.workspace?.workspaceId
        self.lastWrittenWidgetSnapshot = nil
        do {
            try deleteWidgetSnapshot(fileURL: try widgetSnapshotFileURL())
            WidgetCenter.shared.reloadTimelines(ofKind: reviewWidgetKind)
        } catch {
            self.captureWidgetFailure(error: error, workspaceId: workspaceId, action: "widget_snapshot_delete")
        }
    }

    func captureWidgetFailure(error: Error, workspaceId: String?, action: String) {
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: IOSObservationScope(
                feature: .widget,
                userId: self.cloudSettings?.linkedUserId,
                workspaceId: workspaceId,
                requestId: nil,
                clientRequestId: nil,
                sessionId: nil,
                runId: nil,
                cloudState: self.cloudSettings?.cloudState,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            ),
            action: action,
            stage: nil,
            statusCode: nil,
            backendCode: nil,
            requestId: nil
        )
    }
}

/// Nil until progress has loaded, so the widget hides the streak instead of showing a false 0.
private func makeWidgetSnapshotStreakDays(badgeState: ReviewProgressBadgeState) -> Int? {
    badgeState == makeEmptyReviewProgressBadgeState() ? nil : badgeState.streakDays
}

/// Prefers the card Review is showing; a card without readable question text yields no widget card.
private func makeWidgetSnapshotCard(
    presentedReviewCard: Card?,
    reviewHeadCard: Card?
) -> WidgetSnapshotCard? {
    guard let card = presentedReviewCard ?? reviewHeadCard else {
        return nil
    }

    let frontPlainText = String(
        makeReviewSpeakableText(text: card.frontText)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .prefix(widgetSnapshotFrontTextCharacterLimit)
    )
    guard frontPlainText.isEmpty == false else {
        return nil
    }
    return WidgetSnapshotCard(cardId: card.cardId, frontPlainText: frontPlainText)
}

/// Compares in-memory values: the file's ISO 8601 dates drop fractional seconds.
private func hasSameWidgetSnapshotContent(lhs: WidgetSnapshot, rhs: WidgetSnapshot) -> Bool {
    lhs.workspaceId == rhs.workspaceId
        && lhs.dueCount == rhs.dueCount
        && lhs.upcomingDueAt == rhs.upcomingDueAt
        && lhs.streakDays == rhs.streakDays
        && lhs.nextCard == rhs.nextCard
}
#endif
