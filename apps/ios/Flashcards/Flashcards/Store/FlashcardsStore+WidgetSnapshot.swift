#if !targetEnvironment(macCatalyst)
import Foundation
import WidgetKit

// Mac Catalyst has no App Group, so the widget snapshot exists only on iOS and iPadOS.

let reviewWidgetKind: String = "ReviewWidget"
private let widgetSnapshotUpcomingDueLimit: Int = 100
private let widgetSnapshotUpcomingDueDayCount: Int = 6
private let widgetSnapshotFrontTextCharacterLimit: Int = 300

@MainActor
extension FlashcardsStore {
    func refreshWidgetSnapshot() async {
        guard let database = self.database, let workspaceId = self.workspace?.workspaceId else {
            return
        }

        self.widgetSnapshotRequestSequence += 1
        let requestSequence = self.widgetSnapshotRequestSequence
        let now = Date()
        let reviewFilter = self.selectedReviewFilter
        let localReadVersion = self.localReadVersion
        let reviewScheduleVersion = self.reviewScheduleVersion
        let presentedReviewCard = self.presentedReviewCard
        let streakDays = makeWidgetSnapshotStreakDays(badgeState: self.reviewProgressBadgeState)
        let widgetProgressSnapshot = makeStreakConsistentWidgetProgressSnapshot(
            widgetProgressSnapshot: self.widgetProgressSnapshot,
            streakDays: streakDays
        )
        let progress = widgetProgressSnapshot.map { snapshot in
            makeWidgetSnapshotProgress(progressSnapshot: snapshot)
        }
        let reviewSchedule = makeWidgetSnapshotReviewSchedule(
            reviewScheduleSnapshot: self.reviewScheduleSnapshot,
            isReviewScheduleSnapshotCurrent: self.reviewScheduleSnapshotPublishedLocalRevision
                == self.progressReviewScheduleLocalRevision,
            widgetProgressSnapshot: widgetProgressSnapshot
        )
        let dueDayCalendar = makeProgressStoreCalendar(timeZone: .current)
        let upcomingDueDayBoundaries = makeWidgetSnapshotUpcomingDueDayBoundaries(now: now, calendar: dueDayCalendar)
        do {
            let databaseRead = try await loadWidgetSnapshotDatabaseReadInBackground(
                databaseURL: database.databaseURL,
                workspaceId: workspaceId,
                reviewFilter: reviewFilter,
                isReviewCardPresented: presentedReviewCard != nil,
                upcomingDueLimit: widgetSnapshotUpcomingDueLimit,
                upcomingDueDayBoundaries: upcomingDueDayBoundaries,
                now: now
            )
            // The detached read ignores cancellation, and an identity reset may have replaced the workspace
            // meanwhile, so a superseded run must not write.
            try Task.checkCancellation()
            guard self.widgetSnapshotRequestSequence == requestSequence,
                  self.workspace?.workspaceId == workspaceId,
                  self.selectedReviewFilter == reviewFilter,
                  self.localReadVersion == localReadVersion,
                  self.reviewScheduleVersion == reviewScheduleVersion else {
                return
            }

            let snapshot = WidgetSnapshot(
                generatedAt: now,
                workspaceId: workspaceId,
                dueCount: databaseRead.dueCount,
                upcomingDueAt: databaseRead.upcomingDueAt,
                streakDays: streakDays,
                nextCard: makeWidgetSnapshotCard(
                    presentedReviewCard: presentedReviewCard,
                    reviewHeadCard: databaseRead.reviewHeadCard
                ),
                progress: progress,
                upcomingDueDays: makeWidgetSnapshotDueDays(
                    dayStarts: Array(upcomingDueDayBoundaries.dropLast()),
                    dueCounts: databaseRead.upcomingDueDayCounts,
                    calendar: dueDayCalendar
                ),
                reviewSchedule: reviewSchedule,
                accentColor: self.effectiveAccountAccentColor
            )
            if let lastWrittenWidgetSnapshot = self.lastWrittenWidgetSnapshot,
               lastWrittenWidgetSnapshot.generatedAt <= now,
               hasSameWidgetSnapshotContent(lhs: lastWrittenWidgetSnapshot, rhs: snapshot) {
                return
            }

            try writeWidgetSnapshot(snapshot: snapshot, fileURL: try widgetSnapshotFileURL())
            self.lastWrittenWidgetSnapshot = snapshot
            WidgetCenter.shared.reloadAllTimelines()
        } catch is CancellationError {
            return
        } catch {
            self.captureWidgetFailure(error: error, workspaceId: workspaceId, action: "widget_snapshot_write")
        }
    }

    /// The departing identity's review data must not stay on the Home Screen.
    func deleteWidgetSnapshotForCloudIdentityReset() {
        let workspaceId = self.workspace?.workspaceId
        self.widgetSnapshotRequestSequence += 1
        self.lastWrittenWidgetSnapshot = nil
        self.widgetProgressSnapshot = nil
        self.reviewScheduleSnapshotPublishedLocalRevision = nil
        do {
            try deleteWidgetSnapshot(fileURL: try widgetSnapshotFileURL())
            WidgetCenter.shared.reloadAllTimelines()
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

/// A rating patches only the streak badge, so a history whose streak differs from `streakDays` is stale and is
/// omitted, with the schedule that depends on it, rather than shown beside it.
private func makeStreakConsistentWidgetProgressSnapshot(
    widgetProgressSnapshot: ProgressSnapshot?,
    streakDays: Int?
) -> ProgressSnapshot? {
    guard let widgetProgressSnapshot,
          widgetProgressSnapshot.summary.currentStreakDays == streakDays else {
        return nil
    }
    return widgetProgressSnapshot
}

private func makeWidgetSnapshotProgress(progressSnapshot: ProgressSnapshot) -> WidgetSnapshotProgress {
    WidgetSnapshotProgress(
        todayLocalDate: progressSnapshot.scopeKey.to,
        firstWeekday: progressSnapshot.presentationCalendar.firstWeekday,
        days: progressSnapshot.chartData.chartDays.map { chartDay in
            WidgetSnapshotProgressDay(
                localDate: chartDay.localDate,
                reviewCount: chartDay.reviewCount,
                againCount: chartDay.againCount,
                hardCount: chartDay.hardCount,
                goodCount: chartDay.goodCount,
                easyCount: chartDay.easyCount,
                streakState: makeWidgetSnapshotStreakDayState(streakState: chartDay.streakState)
            )
        },
        currentStreakDays: progressSnapshot.summary.currentStreakDays,
        longestStreakDays: progressSnapshot.summary.longestStreakDays,
        availableFreezeCredits: progressSnapshot.summary.streakFreeze.availableCredits
    )
}

private func makeWidgetSnapshotStreakDayState(streakState: ProgressStreakDayState) -> WidgetSnapshotStreakDayState {
    switch streakState {
    case .reviewed:
        return .reviewed
    case .frozen:
        return .frozen
    case .missed:
        return .missed
    case .pending:
        return .pending
    }
}

/// Only the Progress screen publishes the schedule, so it may belong to an earlier day or a departed identity, or
/// predate a rating or sync on another tab; it passes only when current and matching the scope of the Progress
/// history the widgets show.
private func makeWidgetSnapshotReviewSchedule(
    reviewScheduleSnapshot: ReviewScheduleSnapshot?,
    isReviewScheduleSnapshotCurrent: Bool,
    widgetProgressSnapshot: ProgressSnapshot?
) -> [WidgetSnapshotScheduleBucket]? {
    guard
        let reviewScheduleSnapshot,
        isReviewScheduleSnapshotCurrent,
        let widgetProgressSnapshot,
        reviewScheduleSnapshot.scopeKey == reviewScheduleScopeKey(seriesScopeKey: widgetProgressSnapshot.scopeKey)
    else {
        return nil
    }
    return reviewScheduleSnapshot.schedule.buckets.map { bucket in
        WidgetSnapshotScheduleBucket(key: makeWidgetSnapshotScheduleBucketKey(key: bucket.key), count: bucket.count)
    }
}

private func makeWidgetSnapshotScheduleBucketKey(key: ReviewScheduleBucketKey) -> WidgetSnapshotScheduleBucketKey {
    switch key {
    case .new:
        return .new
    case .today:
        return .today
    case .days1To7:
        return .days1To7
    case .days8To30:
        return .days8To30
    case .days31To90:
        return .days31To90
    case .days91To360:
        return .days91To360
    case .years1To2:
        return .years1To2
    case .later:
        return .later
    }
}

/// The starts of the local days after today plus the end of the last one, so consecutive pairs bound each day.
private func makeWidgetSnapshotUpcomingDueDayBoundaries(now: Date, calendar: Calendar) -> [Date] {
    let startOfToday = calendar.startOfDay(for: now)
    return (1 ... widgetSnapshotUpcomingDueDayCount + 1).map { dayOffset in
        guard let dayStart = calendar.date(byAdding: .day, value: dayOffset, to: startOfToday) else {
            preconditionFailure("Expected to compute the local day \(dayOffset) days after \(startOfToday).")
        }
        return dayStart
    }
}

private func makeWidgetSnapshotDueDays(
    dayStarts: [Date],
    dueCounts: [Int],
    calendar: Calendar
) -> [WidgetSnapshotDueDay] {
    precondition(dayStarts.count == dueCounts.count, "Expected one due count per upcoming day.")
    return zip(dayStarts, dueCounts).map { dayStart, dueCount in
        WidgetSnapshotDueDay(
            localDate: progressLocalDateStringForStore(date: dayStart, calendar: calendar),
            dueCount: dueCount
        )
    }
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
        && lhs.progress == rhs.progress
        && lhs.upcomingDueDays == rhs.upcomingDueDays
        && lhs.reviewSchedule == rhs.reviewSchedule
        && lhs.accentColor == rhs.accentColor
}
#endif
