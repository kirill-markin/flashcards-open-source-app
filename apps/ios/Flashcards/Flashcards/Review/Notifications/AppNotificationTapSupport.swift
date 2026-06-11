import Foundation

let appNotificationTapTypeUserInfoKey: String = "appNotificationTapType"
let pendingAppNotificationTapUserDefaultsKey: String = "pending-app-notification-tap"
let pendingAppNotificationTapSchemaVersion: Int = 1

enum AppNotificationTapType: String, Codable, Hashable, Sendable {
    case reviewReminder
    case strictReminder
}

enum AppNotificationTapSource: String, Codable, Hashable, Sendable {
    case notificationResponse = "notification_response"
    case uiTestEnvironment = "ui_test_environment"
}

struct AppNotificationTapFallback: Codable, Hashable, Sendable {
    let stage: String
    let reason: String
    let notificationType: String?
    let details: String?
}

enum AppNotificationTapRequest: Codable, Hashable, Sendable {
    case openReviewReminder
    case openStrictReminder
    case fallback(AppNotificationTapFallback)
}

struct PendingAppNotificationTapEnvelope: Codable, Hashable, Sendable {
    let schemaVersion: Int
    let request: AppNotificationTapRequest
    let receivedAtMillis: Int64
    let source: AppNotificationTapSource
}

func buildAppNotificationUserInfo(notificationType: AppNotificationTapType) -> [AnyHashable: Any] {
    return [
        appNotificationTapTypeUserInfoKey: notificationType.rawValue
    ]
}

func appNotificationTapType(request: AppNotificationTapRequest) -> String {
    switch request {
    case .openReviewReminder:
        return AppNotificationTapType.reviewReminder.rawValue
    case .openStrictReminder:
        return AppNotificationTapType.strictReminder.rawValue
    case .fallback(let fallback):
        return fallback.notificationType ?? "fallback"
    }
}

func savePendingAppNotificationTap(
    envelope: PendingAppNotificationTapEnvelope,
    userDefaults: UserDefaults,
    encoder: JSONEncoder
) throws {
    do {
        let data = try encoder.encode(envelope)
        userDefaults.set(data, forKey: pendingAppNotificationTapUserDefaultsKey)
    } catch {
        throw LocalStoreError.validation(
            "Pending app notification tap could not be saved: \(Flashcards.errorMessage(error: error))"
        )
    }
}

func loadPendingAppNotificationTap(
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) throws -> PendingAppNotificationTapEnvelope? {
    guard let data = userDefaults.data(forKey: pendingAppNotificationTapUserDefaultsKey) else {
        return nil
    }

    do {
        let envelope = try decoder.decode(PendingAppNotificationTapEnvelope.self, from: data)
        guard envelope.schemaVersion == pendingAppNotificationTapSchemaVersion else {
            throw LocalStoreError.validation(
                "Pending app notification tap schema is unsupported: \(envelope.schemaVersion)"
            )
        }
        return envelope
    } catch {
        throw LocalStoreError.validation(
            "Pending app notification tap is invalid: \(Flashcards.errorMessage(error: error))"
        )
    }
}

func clearPendingAppNotificationTap(userDefaults: UserDefaults) {
    userDefaults.removeObject(forKey: pendingAppNotificationTapUserDefaultsKey)
}

func logAppNotificationTapEvent(action: String, metadata: [String: String]) {
    let observation = NotificationTapObservation(
        action: NotificationTapAction(rawValue: action) ?? .fallback,
        notificationType: metadata["notificationType"] ?? "unknown",
        source: metadata["source"].flatMap(AppNotificationTapSource.init(rawValue:)),
        appState: metadata["appState"],
        scenePhaseAtConsume: metadata["scenePhaseAtConsume"],
        receivedAtMillis: metadata["receivedAt"].flatMap(Int64.init),
        stage: metadata["stage"]
    )
    if action == NotificationTapAction.dropped.rawValue || action == NotificationTapAction.fallback.rawValue {
        FlashcardsObservability.captureWarning(
            .notificationTapDropped(
                NotificationTapDroppedWarning(
                    observation: observation,
                    reason: metadata["reason"] ?? "unspecified",
                    detailSummary: metadata["details"]
                )
            )
        )
        return
    }

    FlashcardsObservability.addBreadcrumb(.notificationTap(observation))
}

func makeAppNotificationTapLogMetadata(
    request: AppNotificationTapRequest,
    source: AppNotificationTapSource?,
    appState: String?,
    scenePhase: String?,
    receivedAtMillis: Int64?,
    stage: String?,
    reason: String?,
    details: String?
) -> [String: String] {
    var metadata: [String: String] = [
        "build": appBuildNumber(),
        "notificationType": appNotificationTapType(request: request)
    ]
    if let source {
        metadata["source"] = source.rawValue
    }
    if let appState {
        metadata["appState"] = appState
    }
    if let scenePhase {
        metadata["scenePhaseAtConsume"] = scenePhase
    }
    if let receivedAtMillis {
        metadata["receivedAt"] = String(receivedAtMillis)
    }
    if let stage {
        metadata["stage"] = stage
    }
    if let reason {
        metadata["reason"] = reason
    }
    if let details {
        metadata["details"] = details
    }
    return metadata
}

func parseAppNotificationTapRequest(userInfo: [AnyHashable: Any]) -> AppNotificationTapRequest? {
    guard let rawNotificationType = userInfo[appNotificationTapTypeUserInfoKey] as? String else {
        return nil
    }
    guard let notificationType = AppNotificationTapType(rawValue: rawNotificationType) else {
        return .fallback(
            AppNotificationTapFallback(
                stage: "parse",
                reason: "unsupported_notification_type",
                notificationType: rawNotificationType,
                details: nil
            )
        )
    }

    switch notificationType {
    case .reviewReminder:
        return .openReviewReminder
    case .strictReminder:
        return .openStrictReminder
    }
}

func logAppNotificationTapFallback(fallback: AppNotificationTapFallback) {
    let request = AppNotificationTapRequest.fallback(fallback)
    let metadata = makeAppNotificationTapLogMetadata(
        request: request,
        source: nil,
        appState: nil,
        scenePhase: nil,
        receivedAtMillis: nil,
        stage: fallback.stage,
        reason: fallback.reason,
        details: fallback.details
    )
    logAppNotificationTapEvent(action: "notification_tap_fallback", metadata: metadata)
}
