import Foundation

let appNotificationTapTypeUserInfoKey: String = "appNotificationTapType"
let pendingAppNotificationTapUserDefaultsKey: String = "pending-app-notification-tap"
let pendingAppNotificationTapSchemaVersion: Int = 2
let appNotificationPresentationOwnershipUserDefaultsKey: String = "app-notification-presentation-ownership"
let appNotificationPresentationOwnershipSchemaVersion: Int = 1

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
    case openReviewReminder(workspaceId: String)
    case openStrictReminder
    case fallback(AppNotificationTapFallback)
}

struct AppNotificationPresentationOwnership: Codable, Hashable, Sendable {
    let schemaVersion: Int
    let isMasterEnabled: Bool
    let workspaceId: String?
    let isStrictReminderEnabled: Bool
    let strictReminderScope: String
}

enum AppNotificationOwnershipDecision: Hashable, Sendable {
    case unrelated
    case owned(AppNotificationTapRequest)
    case suppressed(AppNotificationTapFallback)
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

func saveAppNotificationPresentationOwnership(
    ownership: AppNotificationPresentationOwnership,
    userDefaults: UserDefaults,
    encoder: JSONEncoder
) throws {
    do {
        userDefaults.set(
            try encoder.encode(ownership),
            forKey: appNotificationPresentationOwnershipUserDefaultsKey
        )
    } catch {
        throw LocalStoreError.validation(
            "App notification presentation ownership could not be saved: \(Flashcards.errorMessage(error: error))"
        )
    }
}

func loadAppNotificationPresentationOwnership(
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) throws -> AppNotificationPresentationOwnership? {
    guard let data = userDefaults.data(forKey: appNotificationPresentationOwnershipUserDefaultsKey) else {
        return nil
    }

    do {
        let ownership = try decoder.decode(AppNotificationPresentationOwnership.self, from: data)
        guard ownership.schemaVersion == appNotificationPresentationOwnershipSchemaVersion else {
            throw LocalStoreError.validation(
                "App notification presentation ownership schema is unsupported: \(ownership.schemaVersion)"
            )
        }
        return ownership
    } catch {
        throw LocalStoreError.validation(
            "App notification presentation ownership is invalid: \(Flashcards.errorMessage(error: error))"
        )
    }
}

func resolveAppNotificationOwnership(
    userInfo: [AnyHashable: Any],
    requestIdentifier: String,
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) throws -> AppNotificationOwnershipDecision {
    guard let request = parseAppNotificationTapRequest(
        userInfo: userInfo,
        requestIdentifier: requestIdentifier
    ) else {
        return .unrelated
    }
    if case .fallback(let fallback) = request {
        return .suppressed(fallback)
    }

    guard let ownership = try loadAppNotificationPresentationOwnership(
        userDefaults: userDefaults,
        decoder: decoder
    ) else {
        return .suppressed(
            AppNotificationTapFallback(
                stage: "ownership",
                reason: "missing_presentation_ownership",
                notificationType: appNotificationTapType(request: request),
                details: nil
            )
        )
    }
    guard ownership.isMasterEnabled else {
        return .suppressed(
            AppNotificationTapFallback(
                stage: "ownership",
                reason: "notifications_master_disabled",
                notificationType: appNotificationTapType(request: request),
                details: nil
            )
        )
    }

    switch request {
    case .openReviewReminder(let notificationWorkspaceId):
        guard notificationWorkspaceId == ownership.workspaceId else {
            return .suppressed(
                AppNotificationTapFallback(
                    stage: "ownership",
                    reason: "stale_review_reminder_workspace",
                    notificationType: AppNotificationTapType.reviewReminder.rawValue,
                    details: "notificationWorkspaceId=\(notificationWorkspaceId) currentWorkspaceId=\(ownership.workspaceId ?? "unavailable")"
                )
            )
        }
        return .owned(request)
    case .openStrictReminder:
        guard ownership.isStrictReminderEnabled else {
            return .suppressed(
                AppNotificationTapFallback(
                    stage: "ownership",
                    reason: "strict_reminders_disabled",
                    notificationType: AppNotificationTapType.strictReminder.rawValue,
                    details: nil
                )
            )
        }
        guard ownership.workspaceId?.isEmpty == false else {
            return .suppressed(
                AppNotificationTapFallback(
                    stage: "ownership",
                    reason: "missing_notification_workspace_ownership",
                    notificationType: AppNotificationTapType.strictReminder.rawValue,
                    details: nil
                )
            )
        }
        guard isStrictReminderRequestIdentifier(identifier: requestIdentifier) else {
            return .suppressed(
                AppNotificationTapFallback(
                    stage: "parse",
                    reason: "invalid_strict_reminder_identifier",
                    notificationType: AppNotificationTapType.strictReminder.rawValue,
                    details: requestIdentifier
                )
            )
        }
        guard let notificationScope = userInfo[strictReminderNotificationScopeUserInfoKey] as? String,
              notificationScope.isEmpty == false else {
            return .suppressed(
                AppNotificationTapFallback(
                    stage: "parse",
                    reason: "invalid_strict_reminder_scope",
                    notificationType: AppNotificationTapType.strictReminder.rawValue,
                    details: nil
                )
            )
        }
        guard notificationScope == ownership.strictReminderScope else {
            return .suppressed(
                AppNotificationTapFallback(
                    stage: "ownership",
                    reason: "stale_strict_reminder_scope",
                    notificationType: AppNotificationTapType.strictReminder.rawValue,
                    details: nil
                )
            )
        }
        return .owned(request)
    case .fallback(let fallback):
        return .suppressed(fallback)
    }
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

func parseAppNotificationTapRequest(
    userInfo: [AnyHashable: Any],
    requestIdentifier: String?
) -> AppNotificationTapRequest? {
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
        guard let requestIdentifier,
              let workspaceId = reviewNotificationRequestWorkspaceId(identifier: requestIdentifier) else {
            return .fallback(
                AppNotificationTapFallback(
                    stage: "parse",
                    reason: "invalid_review_reminder_identifier",
                    notificationType: notificationType.rawValue,
                    details: requestIdentifier
                )
            )
        }
        return .openReviewReminder(workspaceId: workspaceId)
    case .strictReminder:
        return .openStrictReminder
    }
}

func appNotificationTapWorkspaceOwnershipFallback(
    request: AppNotificationTapRequest,
    currentWorkspaceId: String?
) -> AppNotificationTapFallback? {
    guard case .openReviewReminder(let notificationWorkspaceId) = request else {
        return nil
    }
    guard notificationWorkspaceId == currentWorkspaceId else {
        return AppNotificationTapFallback(
            stage: "consume",
            reason: "stale_review_reminder_workspace",
            notificationType: AppNotificationTapType.reviewReminder.rawValue,
            details: "notificationWorkspaceId=\(notificationWorkspaceId) currentWorkspaceId=\(currentWorkspaceId ?? "unavailable")"
        )
    }

    return nil
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

func logAppNotificationSuppression(
    fallback: AppNotificationTapFallback,
    source: AppNotificationTapSource?,
    appState: String?
) {
    let metadata = makeAppNotificationTapLogMetadata(
        request: .fallback(fallback),
        source: source,
        appState: appState,
        scenePhase: nil,
        receivedAtMillis: nil,
        stage: fallback.stage,
        reason: fallback.reason,
        details: fallback.details
    )
    logAppNotificationTapEvent(action: "notification_tap_dropped", metadata: metadata)
}
