import Foundation
import UIKit
import UserNotifications

let appNotificationPendingRequestsLimit: Int = 64
let notificationSchedulingDelayedReadbackNanoseconds: UInt64 = 350_000_000

func appNotificationPendingRequestBreakdown(
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

func pendingAppNotificationRequestIdentifiers(
    center: UNUserNotificationCenter
) async -> [String] {
    await withCheckedContinuation { continuation in
        center.getPendingNotificationRequests { requests in
            continuation.resume(returning: requests.map(\.identifier))
        }
    }
}

/// Returns the identifiers of pending review reminders queued by the app.
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

/// Removes delivered review reminders from Notification Center.
func removeDeliveredReviewNotifications(
    center: UNUserNotificationCenter
) async {
    let deliveredRequestIdentifiers = await deliveredReviewNotificationRequestIdentifiers(center: center)
    guard deliveredRequestIdentifiers.isEmpty == false else {
        return
    }

    center.removeDeliveredNotifications(withIdentifiers: deliveredRequestIdentifiers)
}

func makeDelayedNotificationSchedulingReadback(
    pendingRequestIdentifiers: [String],
    plannedRequestIdentifiers: [String]
) -> DelayedNotificationSchedulingReadback {
    let pendingRequestIdentifierSet: Set<String> = Set(pendingRequestIdentifiers)
    return DelayedNotificationSchedulingReadback(
        pending: appNotificationPendingRequestBreakdown(identifiers: pendingRequestIdentifiers),
        recovered: plannedRequestIdentifiers.allSatisfy { requestIdentifier in
            pendingRequestIdentifierSet.contains(requestIdentifier)
        }
    )
}

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
