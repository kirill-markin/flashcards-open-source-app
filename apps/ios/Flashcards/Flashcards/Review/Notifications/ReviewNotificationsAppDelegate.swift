import Foundation
import UIKit
import UserNotifications

final class ReviewNotificationsAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        self.observeAppLifecycleForAnalytics()
        return true
    }

    /**
     * Subscribes the process-wide app lifecycle signals every analytics reaction to leaving and
     * returning to the foreground is built on: the warm `app_opened` and the backgrounded flush.
     *
     * `didFinishLaunchingWithOptions` runs exactly once per process, which is the whole point of doing
     * it here. Both notifications are application-level and posted once, so a subscription attached to
     * a view inside the `WindowGroup` would be built per scene and a user with two iPad windows open
     * would record two opens per foreground return — `UIApplicationSupportsMultipleScenes` is on and
     * the target is universal. `ScenePhase` is per scene for the same reason and is not usable for any
     * of this. The delegate's own `applicationWillEnterForeground` is not usable either: UIKit
     * does not call it in a scene-based app, which this is.
     *
     * The observers are never removed because the delegate lives as long as the process, and they
     * capture nothing, so they stay usable from a `@Sendable` context.
     */
    private func observeAppLifecycleForAnalytics() {
        _ = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: nil
        ) { _ in
            Analytics.recordAppBackgrounded()
            runAnalyticsAppLifecycleWork {
                // Held open by a background task: without one the process is suspended before the
                // batch leaves, and the events wait for the next launch instead.
                runAppBackgroundTask(name: "AppBackgroundAnalyticsFlush") {
                    await Analytics.flushAndWait()
                }
            }
        }
        _ = NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: nil
        ) { _ in
            runAnalyticsAppLifecycleWork {
                Analytics.trackAppForegrounded()
            }
        }
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
            if reviewReminderWorkspaceId(request: request) != nil {
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
        if reviewReminderWorkspaceId(request: request) != nil {
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

/**
 * Runs an app lifecycle notification's main-actor analytics work inline, on the notification's own
 * thread.
 *
 * UIKit posts those notifications on the main thread and `queue: nil` delivers on the posting thread,
 * so `assumeIsolated` holds and the work runs before the process can be suspended. Running it inline
 * is the point on the way out: a scheduled hop would let the suspension beat the background task
 * placed to hold the process awake for the flush.
 *
 * The thread check keeps the case that should not happen from becoming a crash. Nothing in the
 * analytics module may fail a user's app, and a deferred batch is a far smaller loss than a
 * termination.
 */
private func runAnalyticsAppLifecycleWork(_ operation: @escaping @MainActor @Sendable () -> Void) {
    guard Thread.isMainThread else {
        Task { @MainActor in
            operation()
        }
        return
    }

    MainActor.assumeIsolated {
        operation()
    }
}
