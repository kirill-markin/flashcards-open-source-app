import Foundation
import Observation

@MainActor
@Observable
final class AppNotificationTapCoordinator {
    static let shared = AppNotificationTapCoordinator()

    private(set) var pendingRequest: AppNotificationTapRequest?

    func request(request: AppNotificationTapRequest) {
        self.pendingRequest = request
    }

    func consumePendingRequest() -> AppNotificationTapRequest? {
        let request = self.pendingRequest
        self.pendingRequest = nil
        return request
    }
}
