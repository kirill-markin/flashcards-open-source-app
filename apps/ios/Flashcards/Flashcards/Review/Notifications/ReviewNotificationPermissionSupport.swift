import Foundation
import UserNotifications

enum ReviewNotificationPermissionStatus: Hashable, Sendable {
    case allowed
    case notRequested
    case blocked

    var title: String {
        switch self {
        case .allowed:
            return String(
                localized: "review_notification_permission.allowed",
                table: "Foundation",
                comment: "Notifications permission title for allowed"
            )
        case .notRequested:
            return String(
                localized: "review_notification_permission.not_requested",
                table: "Foundation",
                comment: "Notifications permission title for not requested"
            )
        case .blocked:
            return String(
                localized: "review_notification_permission.blocked",
                table: "Foundation",
                comment: "Notifications permission title for blocked"
            )
        }
    }

    var actionTitle: String {
        switch self {
        case .allowed, .blocked:
            return String(
                localized: "shared.action.open_settings",
                table: "Foundation",
                comment: "Notifications permission action title to open Settings"
            )
        case .notRequested:
            return String(
                localized: "review_notification_permission.allow_notifications",
                table: "Foundation",
                comment: "Notifications permission action title to allow notifications"
            )
        }
    }
}

func reviewNotificationPermissionStatusDiagnosticValue(
    status: ReviewNotificationPermissionStatus
) -> String {
    switch status {
    case .allowed:
        return "allowed"
    case .notRequested:
        return "not_requested"
    case .blocked:
        return "blocked"
    }
}

func reviewNotificationPermissionStatus(authorizationStatus: UNAuthorizationStatus) -> ReviewNotificationPermissionStatus {
    switch authorizationStatus {
    case .authorized, .provisional, .ephemeral:
        return .allowed
    case .notDetermined:
        return .notRequested
    case .denied:
        return .blocked
    @unknown default:
        return .blocked
    }
}

func resolveReviewNotificationPermissionStatus() async -> ReviewNotificationPermissionStatus {
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    return reviewNotificationPermissionStatus(authorizationStatus: settings.authorizationStatus)
}
