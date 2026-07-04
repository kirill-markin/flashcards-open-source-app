import Foundation
import UIKit
import UserNotifications

let appNotificationPendingRequestsLimit: Int = 64
let notificationSchedulingDelayedReadbackNanoseconds: UInt64 = 350_000_000
let notificationSchedulingReadbackRetryDelayNanoseconds: [UInt64] = [
    350_000_000,
    1_000_000_000,
    2_000_000_000
]

struct NotificationSchedulingReadbackResult: Sendable, Hashable {
    let pendingRequestIdentifiers: [String]
    let delayedReadback: DelayedNotificationSchedulingReadback?
    let isComplete: Bool
    let attemptCount: Int
}

struct NotificationForegroundOperationCounts: Sendable, Hashable {
    let pendingBefore: AppNotificationPendingRequestBreakdown?
    let pendingAfter: AppNotificationPendingRequestBreakdown?
    let deliveredBeforeCount: Int?
    let deliveredRemovedCount: Int?
    let plannedCount: Int?
    let attemptedCount: Int?
    let acceptedCount: Int?
    let readbackCompleted: Bool?
    let readbackAttemptCount: Int?
}

func emptyNotificationForegroundOperationCounts() -> NotificationForegroundOperationCounts {
    NotificationForegroundOperationCounts(
        pendingBefore: nil,
        pendingAfter: nil,
        deliveredBeforeCount: nil,
        deliveredRemovedCount: nil,
        plannedCount: nil,
        attemptedCount: nil,
        acceptedCount: nil,
        readbackCompleted: nil,
        readbackAttemptCount: nil
    )
}

func notificationCleanupForegroundOperationCounts(
    pendingBefore: AppNotificationPendingRequestBreakdown,
    deliveredBeforeCount: Int?,
    deliveredRemovedCount: Int?
) -> NotificationForegroundOperationCounts {
    NotificationForegroundOperationCounts(
        pendingBefore: pendingBefore,
        pendingAfter: nil,
        deliveredBeforeCount: deliveredBeforeCount,
        deliveredRemovedCount: deliveredRemovedCount,
        plannedCount: nil,
        attemptedCount: nil,
        acceptedCount: nil,
        readbackCompleted: nil,
        readbackAttemptCount: nil
    )
}

func notificationPlannedForegroundOperationCounts(
    plannedCount: Int
) -> NotificationForegroundOperationCounts {
    NotificationForegroundOperationCounts(
        pendingBefore: nil,
        pendingAfter: nil,
        deliveredBeforeCount: nil,
        deliveredRemovedCount: nil,
        plannedCount: plannedCount,
        attemptedCount: nil,
        acceptedCount: nil,
        readbackCompleted: nil,
        readbackAttemptCount: nil
    )
}

func notificationPendingBeforeForegroundOperationCounts(
    pendingBefore: AppNotificationPendingRequestBreakdown,
    plannedCount: Int
) -> NotificationForegroundOperationCounts {
    NotificationForegroundOperationCounts(
        pendingBefore: pendingBefore,
        pendingAfter: nil,
        deliveredBeforeCount: nil,
        deliveredRemovedCount: nil,
        plannedCount: plannedCount,
        attemptedCount: nil,
        acceptedCount: nil,
        readbackCompleted: nil,
        readbackAttemptCount: nil
    )
}

func notificationAddForegroundOperationCounts(
    pendingBefore: AppNotificationPendingRequestBreakdown,
    plannedCount: Int,
    attemptedCount: Int
) -> NotificationForegroundOperationCounts {
    NotificationForegroundOperationCounts(
        pendingBefore: pendingBefore,
        pendingAfter: nil,
        deliveredBeforeCount: nil,
        deliveredRemovedCount: nil,
        plannedCount: plannedCount,
        attemptedCount: attemptedCount,
        acceptedCount: nil,
        readbackCompleted: nil,
        readbackAttemptCount: nil
    )
}

func notificationReadbackForegroundOperationCounts(
    pendingBefore: AppNotificationPendingRequestBreakdown,
    pendingAfter: AppNotificationPendingRequestBreakdown?,
    deliveredBeforeCount: Int?,
    deliveredRemovedCount: Int?,
    plannedCount: Int,
    attemptedCount: Int,
    acceptedCount: Int?,
    readbackCompleted: Bool?,
    readbackAttemptCount: Int?
) -> NotificationForegroundOperationCounts {
    NotificationForegroundOperationCounts(
        pendingBefore: pendingBefore,
        pendingAfter: pendingAfter,
        deliveredBeforeCount: deliveredBeforeCount,
        deliveredRemovedCount: deliveredRemovedCount,
        plannedCount: plannedCount,
        attemptedCount: attemptedCount,
        acceptedCount: acceptedCount,
        readbackCompleted: readbackCompleted,
        readbackAttemptCount: readbackAttemptCount
    )
}

@MainActor
extension FlashcardsStore {
    func addNotificationForegroundOperationBreadcrumb(
        notificationKind: AppNotificationTapType,
        stage: String,
        phase: ForegroundOperationPhase,
        trigger: String,
        startedAt: Date?,
        authorizationStatus: ReviewNotificationPermissionStatus?,
        counts: NotificationForegroundOperationCounts,
        errorSummary: String?
    ) {
        let durationMilliseconds = startedAt.map { startDate in
            iosObservationDurationMilliseconds(startedAt: startDate, finishedAt: Date())
        }
        let scope = IOSObservationScope(
            feature: .notifications,
            userId: self.cloudSettings?.linkedUserId,
            workspaceId: self.workspace?.workspaceId,
            requestId: nil,
            clientRequestId: nil,
            sessionId: nil,
            runId: nil,
            cloudState: self.cloudSettings?.cloudState,
            configurationMode: try? self.currentCloudServiceConfiguration().mode
        )

        FlashcardsObservability.addBreadcrumb(
            .foregroundOperation(
                ForegroundOperationObservation(
                    scope: scope,
                    action: .notificationReconciliation,
                    phase: phase,
                    durationMilliseconds: durationMilliseconds,
                    operationStage: stage,
                    operationTrigger: trigger,
                    selectedTab: nil,
                    scenePhase: nil,
                    isStartupReady: nil,
                    isRecoveryGateActive: nil,
                    cardCount: nil,
                    deckCount: nil,
                    pendingOutboxOperationCount: nil,
                    reviewQueueCount: nil,
                    reviewDueCount: nil,
                    reviewNewCount: nil,
                    reviewPendingCount: nil,
                    reviewTotalCount: nil,
                    reviewFilterKind: nil,
                    reviewRefreshMode: nil,
                    reviewLoadKind: nil,
                    progressSummaryRefreshNeeded: nil,
                    progressSeriesRefreshNeeded: nil,
                    progressReviewScheduleRefreshNeeded: nil,
                    progressLeaderboardRefreshNeeded: nil,
                    progressStreakLeaderboardRefreshNeeded: nil,
                    cloudSyncBlocked: nil,
                    cloudSyncExtendsFastPolling: nil,
                    cloudSyncUsesImmediateStartDebounce: nil,
                    cloudSyncImmediateStartSkipped: nil,
                    cloudSyncSkipReason: nil,
                    cloudSyncHadActiveTask: nil,
                    cloudSyncPendingResync: nil,
                    cloudSyncWaitOutcome: nil,
                    cloudSyncAcknowledgedOperationCount: nil,
                    cloudSyncAppliedPullChangeCount: nil,
                    cloudSyncChangedEntityTypeCount: nil,
                    cloudSyncLocalIdRepairEntityTypeCount: nil,
                    cloudSyncReviewScheduleImpactingPullChangeCount: nil,
                    cloudSyncAcknowledgedReviewEventOperationCount: nil,
                    cloudSyncAcknowledgedReviewScheduleImpactingOperationCount: nil,
                    cloudSyncCleanedUpOperationCount: nil,
                    cloudSyncCleanedUpReviewScheduleImpactingOperationCount: nil,
                    cloudSyncCleanedUpReviewEventOperationCount: nil,
                    notificationKind: notificationKind.rawValue,
                    notificationAuthorizationStatus: authorizationStatus.map { status in
                        reviewNotificationPermissionStatusDiagnosticValue(status: status)
                    },
                    notificationPendingBeforeTotalCount: counts.pendingBefore?.totalCount,
                    notificationPendingBeforeReviewCount: counts.pendingBefore?.reviewCount,
                    notificationPendingBeforeStrictCount: counts.pendingBefore?.strictCount,
                    notificationPendingBeforeOtherCount: counts.pendingBefore?.otherCount,
                    notificationPendingAfterTotalCount: counts.pendingAfter?.totalCount,
                    notificationPendingAfterReviewCount: counts.pendingAfter?.reviewCount,
                    notificationPendingAfterStrictCount: counts.pendingAfter?.strictCount,
                    notificationPendingAfterOtherCount: counts.pendingAfter?.otherCount,
                    notificationDeliveredBeforeCount: counts.deliveredBeforeCount,
                    notificationDeliveredRemovedCount: counts.deliveredRemovedCount,
                    notificationPlannedCount: counts.plannedCount,
                    notificationAttemptedCount: counts.attemptedCount,
                    notificationAcceptedCount: counts.acceptedCount,
                    notificationReadbackCompleted: counts.readbackCompleted,
                    notificationReadbackAttemptCount: counts.readbackAttemptCount,
                    errorSummary: errorSummary
                )
            )
        )
    }
}

func appNotificationPendingRequestBreakdown(
    identifiers: [String]
) -> AppNotificationPendingRequestBreakdown {
    appNotificationRequestBreakdown(identifiers: identifiers)
}

func appNotificationRequestBreakdown(
    identifiers: [String]
) -> AppNotificationPendingRequestBreakdown {
    let reviewCount: Int = identifiers.filter(isReviewNotificationRequestIdentifier).count
    let strictCount: Int = identifiers.filter(isStrictReminderRequestIdentifier).count
    return AppNotificationPendingRequestBreakdown(
        totalCount: identifiers.count,
        reviewCount: reviewCount,
        strictCount: strictCount,
        otherCount: identifiers.count - reviewCount - strictCount
    )
}

func notificationScheduledAtMillisRange(
    scheduledAtMillisValues: [Int64]
) -> NotificationScheduledAtMillisRange {
    NotificationScheduledAtMillisRange(
        firstScheduledAtMillis: scheduledAtMillisValues.min(),
        lastScheduledAtMillis: scheduledAtMillisValues.max()
    )
}

func isFutureNotificationPayload(
    scheduledAtMillis: Int64,
    now: Date
) -> Bool {
    TimeInterval(scheduledAtMillis) / 1_000 > now.timeIntervalSince1970
}

func reviewNotificationScheduledAtMillisRange(
    payloads: [ScheduledReviewNotificationPayload]
) -> NotificationScheduledAtMillisRange {
    notificationScheduledAtMillisRange(
        scheduledAtMillisValues: payloads.map(\.scheduledAtMillis)
    )
}

func notificationSchedulingDelaySecondsRange(
    scheduledAtMillisValues: [Int64],
    now: Date
) -> NotificationSchedulingDelaySecondsRange {
    let delaySecondsValues: [Int] = scheduledAtMillisValues.map { scheduledAtMillis in
        let rawDelaySeconds: TimeInterval = TimeInterval(scheduledAtMillis) / 1_000 - now.timeIntervalSince1970
        return max(1, Int(rawDelaySeconds.rounded(.up)))
    }

    return NotificationSchedulingDelaySecondsRange(
        minDelaySeconds: delaySecondsValues.min(),
        maxDelaySeconds: delaySecondsValues.max()
    )
}

func reviewNotificationSchedulingDelaySecondsRange(
    payloads: [ScheduledReviewNotificationPayload],
    now: Date
) -> NotificationSchedulingDelaySecondsRange {
    notificationSchedulingDelaySecondsRange(
        scheduledAtMillisValues: payloads.map(\.scheduledAtMillis),
        now: now
    )
}

func appNotificationApplicationStateDiagnosticValue(
    applicationState: UIApplication.State
) -> String {
    switch applicationState {
    case .active:
        return "active"
    case .inactive:
        return "inactive"
    case .background:
        return "background"
    @unknown default:
        return "unknown"
    }
}

@MainActor
func currentAppNotificationApplicationStateDiagnosticValue() -> String {
    appNotificationApplicationStateDiagnosticValue(
        applicationState: UIApplication.shared.applicationState
    )
}

@MainActor
func pendingAppNotificationRequestIdentifiers(
    center: UNUserNotificationCenter
) async -> [String] {
    await withCheckedContinuation { continuation in
        center.getPendingNotificationRequests { requests in
            continuation.resume(returning: requests.map(\.identifier))
        }
    }
}

@MainActor
func deliveredAppNotificationRequestIdentifiers(
    center: UNUserNotificationCenter
) async -> [String] {
    await withCheckedContinuation { continuation in
        center.getDeliveredNotifications { notifications in
            continuation.resume(returning: notifications.map(\.request.identifier))
        }
    }
}

/// Returns the identifiers of pending review reminders queued by the app.
@MainActor
func pendingReviewNotificationRequestIdentifiers(
    center: UNUserNotificationCenter
) async -> [String] {
    await withCheckedContinuation { continuation in
        center.getPendingNotificationRequests { requests in
            continuation.resume(
                returning: filterReviewNotificationRequestIdentifiers(
                    identifiers: requests.map(\.identifier)
                )
            )
        }
    }
}

/// Returns the identifiers of delivered review reminders currently shown by Notification Center.
@MainActor
func deliveredReviewNotificationRequestIdentifiers(
    center: UNUserNotificationCenter
) async -> [String] {
    await withCheckedContinuation { continuation in
        center.getDeliveredNotifications { notifications in
            continuation.resume(
                returning: filterReviewNotificationRequestIdentifiers(
                    identifiers: notifications.map(\.request.identifier)
                )
            )
        }
    }
}

@MainActor
func deliveredReviewReminderAttentionStates(
    center: UNUserNotificationCenter
) async -> [ReviewReminderAttentionState] {
    await withCheckedContinuation { continuation in
        center.getDeliveredNotifications { notifications in
            continuation.resume(
                returning: notifications.compactMap { notification in
                    makeReviewReminderAttentionState(notification: notification)
                }
            )
        }
    }
}

/// Removes delivered review reminders from Notification Center.
@MainActor
@discardableResult
func removeDeliveredReviewNotifications(
    center: UNUserNotificationCenter
) async -> Int {
    let deliveredRequestIdentifiers = await deliveredReviewNotificationRequestIdentifiers(center: center)
    guard deliveredRequestIdentifiers.isEmpty == false else {
        return 0
    }

    center.removeDeliveredNotifications(withIdentifiers: deliveredRequestIdentifiers)
    return deliveredRequestIdentifiers.count
}

func makeDelayedNotificationSchedulingReadback(
    pendingRequestIdentifiers: [String],
    plannedRequestIdentifiers: [String]
) -> DelayedNotificationSchedulingReadback {
    return DelayedNotificationSchedulingReadback(
        pending: appNotificationPendingRequestBreakdown(identifiers: pendingRequestIdentifiers),
        recovered: isCompleteNotificationSchedulingReadback(
            pendingRequestIdentifiers: pendingRequestIdentifiers,
            plannedRequestIdentifiers: plannedRequestIdentifiers
        )
    )
}

func isCompleteNotificationSchedulingReadback(
    pendingRequestIdentifiers: [String],
    plannedRequestIdentifiers: [String]
) -> Bool {
    let pendingRequestIdentifierSet: Set<String> = Set(pendingRequestIdentifiers)
    return plannedRequestIdentifiers.allSatisfy { requestIdentifier in
        pendingRequestIdentifierSet.contains(requestIdentifier)
    }
}

@MainActor
func notificationSchedulingReadback(
    center: UNUserNotificationCenter,
    plannedRequestIdentifiers: [String],
    retryDelayNanoseconds: [UInt64]
) async throws -> NotificationSchedulingReadbackResult {
    var pendingRequestIdentifiers: [String] = await pendingAppNotificationRequestIdentifiers(center: center)
    var isComplete: Bool = isCompleteNotificationSchedulingReadback(
        pendingRequestIdentifiers: pendingRequestIdentifiers,
        plannedRequestIdentifiers: plannedRequestIdentifiers
    )
    var attemptCount: Int = 1
    var delayedReadback: DelayedNotificationSchedulingReadback?

    for delayNanoseconds in retryDelayNanoseconds {
        guard isComplete == false else {
            break
        }

        try await Task.sleep(nanoseconds: delayNanoseconds)
        pendingRequestIdentifiers = await pendingAppNotificationRequestIdentifiers(center: center)
        attemptCount += 1
        isComplete = isCompleteNotificationSchedulingReadback(
            pendingRequestIdentifiers: pendingRequestIdentifiers,
            plannedRequestIdentifiers: plannedRequestIdentifiers
        )
        delayedReadback = makeDelayedNotificationSchedulingReadback(
            pendingRequestIdentifiers: pendingRequestIdentifiers,
            plannedRequestIdentifiers: plannedRequestIdentifiers
        )
    }

    return NotificationSchedulingReadbackResult(
        pendingRequestIdentifiers: pendingRequestIdentifiers,
        delayedReadback: delayedReadback,
        isComplete: isComplete,
        attemptCount: attemptCount
    )
}

@MainActor
func delayedNotificationSchedulingReadback(
    center: UNUserNotificationCenter,
    plannedRequestIdentifiers: [String],
    delayNanoseconds: UInt64
) async throws -> DelayedNotificationSchedulingReadback {
    try await Task.sleep(nanoseconds: delayNanoseconds)
    let pendingRequestIdentifiers: [String] = await pendingAppNotificationRequestIdentifiers(center: center)
    return makeDelayedNotificationSchedulingReadback(
        pendingRequestIdentifiers: pendingRequestIdentifiers,
        plannedRequestIdentifiers: plannedRequestIdentifiers
    )
}

func makeNotificationSchedulingDiagnostics(
    trigger: String,
    scheduledAtMillisRange: NotificationScheduledAtMillisRange,
    delaySecondsRange: NotificationSchedulingDelaySecondsRange,
    pendingBeforeRequestIdentifiers: [String],
    pendingAfterRequestIdentifiers: [String],
    permissionStatusBefore: ReviewNotificationPermissionStatus,
    permissionStatusAfter: ReviewNotificationPermissionStatus,
    appStateBeforeAdd: String,
    appStateAfterReadback: String,
    delayedReadback: DelayedNotificationSchedulingReadback?
) -> NotificationSchedulingDiagnostics {
    NotificationSchedulingDiagnostics(
        trigger: trigger,
        pendingBefore: appNotificationPendingRequestBreakdown(
            identifiers: pendingBeforeRequestIdentifiers
        ),
        pendingAfter: appNotificationPendingRequestBreakdown(
            identifiers: pendingAfterRequestIdentifiers
        ),
        permissionStatusBefore: reviewNotificationPermissionStatusDiagnosticValue(
            status: permissionStatusBefore
        ),
        permissionStatusAfter: reviewNotificationPermissionStatusDiagnosticValue(
            status: permissionStatusAfter
        ),
        appStateBeforeAdd: appStateBeforeAdd,
        appStateAfterReadback: appStateAfterReadback,
        scheduledAtMillisRange: scheduledAtMillisRange,
        delaySecondsRange: delaySecondsRange,
        delayedReadback: delayedReadback
    )
}

func makeNotificationSchedulingFailureWarning(
    action: String,
    scope: IOSObservationScope,
    notificationKind: AppNotificationTapType,
    workspaceId: String?,
    requestId: String?,
    stage: String,
    plannedCount: Int,
    acceptedCount: Int,
    diagnostics: NotificationSchedulingDiagnostics,
    error: Error?,
    messageSummary: String?
) -> NotificationSchedulingFailureWarning {
    let nsError: NSError? = error.map { value in value as NSError }
    let safeErrorDomain: String?
    if let rawDomain = nsError?.domain {
        let candidateDomain = safeDiagnosticIdentifier(rawDomain)
        safeErrorDomain = candidateDomain == filteredDiagnosticValue ? nil : candidateDomain
    } else {
        safeErrorDomain = nil
    }

    return NotificationSchedulingFailureWarning(
        action: action,
        scope: scope,
        notificationKind: notificationKind.rawValue,
        workspaceId: workspaceId,
        requestId: requestId,
        stage: stage,
        plannedCount: plannedCount,
        acceptedCount: acceptedCount,
        pendingBeforeCount: diagnostics.pendingBefore.totalCount,
        pendingAfterCount: diagnostics.pendingAfter.totalCount,
        errorDomain: safeErrorDomain,
        errorCode: nsError?.code,
        messageSummary: error.map { value in Flashcards.errorMessage(error: value) } ?? messageSummary,
        diagnostics: diagnostics
    )
}
