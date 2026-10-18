import Foundation

extension CloudSyncTransport {
    func loadPaywallState(session: CloudLinkedSession) async throws -> PaywallState {
        let state: PaywallState = try await self.request(
            apiBaseUrl: session.apiBaseUrl,
            authorizationHeader: session.authorizationHeaderValue,
            path: "/me/paywall-state",
            method: "GET",
            body: Optional<String>.none
        )
        return try state.validated()
    }

    func recordPaywallShown(request: PaywallShownRequest, session: CloudLinkedSession) async throws -> PaywallState {
        let state: PaywallState = try await self.request(
            apiBaseUrl: session.apiBaseUrl,
            authorizationHeader: session.authorizationHeaderValue,
            path: "/me/paywall-shown",
            method: "POST",
            body: request
        )
        return try state.validated()
    }
}
