import Foundation
import UserNotifications

let reviewReminderAttentionStateUserDefaultsKey: String = "review-reminder-attention-state"
let reviewReminderAttentionStateDidChangeNotificationName: Notification.Name = Notification.Name(
    "reviewReminderAttentionStateDidChange"
)

struct ReviewReminderAttentionState: Codable, Hashable, Sendable {
    let workspaceId: String
    let requestId: String
    let deliveredAtMillis: Int64
}

func makeReviewReminderAttentionState(
    workspaceId: String,
    requestId: String,
    deliveredAtMillis: Int64
) -> ReviewReminderAttentionState {
    ReviewReminderAttentionState(
        workspaceId: workspaceId,
        requestId: requestId,
        deliveredAtMillis: deliveredAtMillis
    )
}

func isReviewReminderAttentionVisible(
    state: ReviewReminderAttentionState?,
    workspaceId: String?
) -> Bool {
    guard let state, let workspaceId else {
        return false
    }

    return state.workspaceId == workspaceId
}

func loadReviewReminderAttentionState(
    userDefaults: UserDefaults,
    decoder: JSONDecoder
) -> ReviewReminderAttentionState? {
    guard let data = userDefaults.data(forKey: reviewReminderAttentionStateUserDefaultsKey) else {
        return nil
    }

    do {
        return try decoder.decode(ReviewReminderAttentionState.self, from: data)
    } catch {
        captureReviewNotificationsSilentFailure(
            error: error,
            action: "review_reminder_attention_state_load",
            stage: "decode",
            cloudSettings: nil,
            workspaceId: nil,
            configurationMode: nil
        )
        userDefaults.removeObject(forKey: reviewReminderAttentionStateUserDefaultsKey)
        return nil
    }
}

func saveReviewReminderAttentionState(
    state: ReviewReminderAttentionState,
    userDefaults: UserDefaults,
    encoder: JSONEncoder
) {
    do {
        let data = try encoder.encode(state)
        userDefaults.set(data, forKey: reviewReminderAttentionStateUserDefaultsKey)
    } catch {
        captureReviewNotificationsSilentFailure(
            error: error,
            action: "review_reminder_attention_state_save",
            stage: "encode",
            cloudSettings: nil,
            workspaceId: state.workspaceId,
            configurationMode: nil
        )
        userDefaults.removeObject(forKey: reviewReminderAttentionStateUserDefaultsKey)
    }
}

func clearReviewReminderAttentionState(userDefaults: UserDefaults) {
    userDefaults.removeObject(forKey: reviewReminderAttentionStateUserDefaultsKey)
}

func makeReviewReminderAttentionState(
    notification: UNNotification
) -> ReviewReminderAttentionState? {
    guard parseAppNotificationTapRequest(userInfo: notification.request.content.userInfo) == .openReviewReminder else {
        return nil
    }

    let requestId = notification.request.identifier
    guard let workspaceId = reviewNotificationRequestWorkspaceId(identifier: requestId) else {
        return nil
    }

    return makeReviewReminderAttentionState(
        workspaceId: workspaceId,
        requestId: requestId,
        deliveredAtMillis: epochMillis(date: notification.date)
    )
}

@discardableResult
func persistReviewReminderAttentionState(
    notification: UNNotification,
    userDefaults: UserDefaults,
    encoder: JSONEncoder
) -> ReviewReminderAttentionState? {
    guard let state = makeReviewReminderAttentionState(
        notification: notification
    ) else {
        return nil
    }

    saveReviewReminderAttentionState(
        state: state,
        userDefaults: userDefaults,
        encoder: encoder
    )
    Task { @MainActor in
        NotificationCenter.default.post(
            name: reviewReminderAttentionStateDidChangeNotificationName,
            object: nil
        )
    }
    return state
}
