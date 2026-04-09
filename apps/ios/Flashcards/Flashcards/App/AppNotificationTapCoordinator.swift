import Foundation

enum AppNotificationTapCoordinator {
    static func persist(
        request: AppNotificationTapRequest,
        source: AppNotificationTapSource,
        userDefaults: UserDefaults
    ) throws -> PendingAppNotificationTapEnvelope {
        let envelope = PendingAppNotificationTapEnvelope(
            schemaVersion: pendingAppNotificationTapSchemaVersion,
            request: request,
            receivedAtMillis: Int64(Date().timeIntervalSince1970 * 1_000),
            source: source
        )
        try savePendingAppNotificationTap(
            envelope: envelope,
            userDefaults: userDefaults,
            encoder: JSONEncoder()
        )
        return envelope
    }

    static func takePendingEnvelope(userDefaults: UserDefaults) throws -> PendingAppNotificationTapEnvelope? {
        do {
            let envelope = try loadPendingAppNotificationTap(
                userDefaults: userDefaults,
                decoder: JSONDecoder()
            )
            if envelope != nil {
                clearPendingAppNotificationTap(userDefaults: userDefaults)
            }
            return envelope
        } catch {
            clearPendingAppNotificationTap(userDefaults: userDefaults)
            throw error
        }
    }
}
