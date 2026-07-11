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
        let decision: AppNotificationOwnershipDecision
        do {
            decision = try resolveAppNotificationOwnership(
                userInfo: notification.request.content.userInfo,
                requestIdentifier: notification.request.identifier,
                userDefaults: .standard,
                decoder: JSONDecoder()
            )
        } catch {
            let fallback = Self.invalidPresentationOwnershipFallback(
                userInfo: notification.request.content.userInfo,
                error: error
            )
            logAppNotificationSuppression(
                fallback: fallback,
                source: nil,
                appState: Self.currentApplicationStateString()
            )
            return []
        }

        switch decision {
        case .unrelated:
            return [.banner, .sound]
        case .owned(let request):
            if case .openReviewReminder = request {
                persistReviewReminderAttentionState(
                    notification: notification,
                    userDefaults: .standard,
                    encoder: JSONEncoder()
                )
            }
            return [.banner, .sound]
        case .suppressed(let fallback):
            logAppNotificationSuppression(
                fallback: fallback,
                source: nil,
                appState: Self.currentApplicationStateString()
            )
            return []
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let decision: AppNotificationOwnershipDecision
        do {
            decision = try resolveAppNotificationOwnership(
                userInfo: userInfo,
                requestIdentifier: response.notification.request.identifier,
                userDefaults: .standard,
                decoder: JSONDecoder()
            )
        } catch {
            logAppNotificationSuppression(
                fallback: Self.invalidPresentationOwnershipFallback(userInfo: userInfo, error: error),
                source: .notificationResponse,
                appState: Self.currentApplicationStateString()
            )
            completionHandler()
            return
        }

        let appState = Self.currentApplicationStateString()
        let request: AppNotificationTapRequest
        switch decision {
        case .unrelated:
            completionHandler()
            return
        case .owned(let ownedRequest):
            request = ownedRequest
        case .suppressed(let fallback):
            logAppNotificationSuppression(
                fallback: fallback,
                source: .notificationResponse,
                appState: appState
            )
            completionHandler()
            return
        }
        if case .openReviewReminder = request {
            persistReviewReminderAttentionState(
                notification: response.notification,
                userDefaults: .standard,
                encoder: JSONEncoder()
            )
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

    private nonisolated static func invalidPresentationOwnershipFallback(
        userInfo: [AnyHashable: Any],
        error: Error
    ) -> AppNotificationTapFallback {
        AppNotificationTapFallback(
            stage: "ownership",
            reason: "invalid_presentation_ownership",
            notificationType: userInfo[appNotificationTapTypeUserInfoKey] as? String,
            details: Flashcards.errorMessage(error: error)
        )
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
