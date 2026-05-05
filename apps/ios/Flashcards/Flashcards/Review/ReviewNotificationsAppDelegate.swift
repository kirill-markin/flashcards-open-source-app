import Foundation
import UIKit
import UserNotifications

final class ReviewNotificationsAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        guard let request = parseAppNotificationTapRequest(userInfo: userInfo) else {
            completionHandler()
            return
        }

        // Clear the app icon badge as soon as the user taps the notification — even
        // before the app finishes foregrounding — so the icon stops nagging the
        // user the moment they react to it.
        Task { @MainActor in
            try? await UNUserNotificationCenter.current().setBadgeCount(0)
        }

        let appState = Self.currentApplicationStateString()
        if request == .openStrictReminder
            && isCurrentStrictReminderNotification(userInfo: userInfo, userDefaults: .standard) == false {
            let droppedMetadata = makeAppNotificationTapLogMetadata(
                request: request,
                source: .notificationResponse,
                appState: appState,
                scenePhase: nil,
                receivedAtMillis: nil,
                stage: "receive",
                reason: "stale_strict_reminder_scope",
                details: nil
            )
            logAppNotificationTapEvent(action: "notification_tap_dropped", metadata: droppedMetadata)
            completionHandler()
            return
        }

        let receivedMetadata = makeAppNotificationTapLogMetadata(
            request: request,
            source: .notificationResponse,
            appState: appState,
            scenePhase: nil,
            receivedAtMillis: nil,
            stage: "receive",
            reason: nil,
            details: nil
        )
        logAppNotificationTapEvent(action: "notification_tap_received", metadata: receivedMetadata)

        do {
            let envelope = try AppNotificationTapCoordinator.persist(
                request: request,
                source: .notificationResponse,
                userDefaults: .standard
            )
            let persistedMetadata = makeAppNotificationTapLogMetadata(
                request: request,
                source: envelope.source,
                appState: appState,
                scenePhase: nil,
                receivedAtMillis: envelope.receivedAtMillis,
                stage: "persist",
                reason: nil,
                details: nil
            )
            logAppNotificationTapEvent(action: "notification_tap_persisted", metadata: persistedMetadata)
        } catch {
            let droppedMetadata = makeAppNotificationTapLogMetadata(
                request: request,
                source: .notificationResponse,
                appState: appState,
                scenePhase: nil,
                receivedAtMillis: nil,
                stage: "persist",
                reason: "persistence_failed",
                details: Flashcards.errorMessage(error: error)
            )
            logAppNotificationTapEvent(action: "notification_tap_dropped", metadata: droppedMetadata)
        }

        completionHandler()
    }

    private nonisolated static func currentApplicationStateString() -> String {
        guard Thread.isMainThread else {
            return "unknown"
        }

        let applicationState = MainActor.assumeIsolated {
            UIApplication.shared.applicationState
        }
        return self.serializeApplicationState(applicationState: applicationState)
    }

    private nonisolated static func serializeApplicationState(applicationState: UIApplication.State) -> String {
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
}
