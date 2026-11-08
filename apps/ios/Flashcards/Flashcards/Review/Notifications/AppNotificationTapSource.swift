import Foundation

enum AppNotificationTapSource: String, Codable, Hashable, Sendable {
    case notificationResponse = "notification_response"
    case uiTestEnvironment = "ui_test_environment"
}
