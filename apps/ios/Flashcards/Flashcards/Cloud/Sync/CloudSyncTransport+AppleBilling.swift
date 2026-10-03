import Foundation

private struct AppleBillingAccountResponse: Decodable {
    let appAccountToken: UUID
}

enum AppleBillingTransactionIntent: String, Encodable {
    case passive
    case explicit
}

private struct AppleBillingTransactionRequest: Encodable {
    let signedTransaction: String
    let intent: AppleBillingTransactionIntent
}

private struct AppleBillingTransactionResponse: Decodable {
    let attached: Bool
}

extension CloudSyncTransport {
    func appleBillingAccountToken(session: CloudLinkedSession) async throws -> UUID {
        let response: AppleBillingAccountResponse = try await self.request(
            apiBaseUrl: session.apiBaseUrl,
            authorizationHeader: session.authorizationHeaderValue,
            path: "/billing/apple/account",
            method: "GET",
            body: Optional<String>.none
        )
        return response.appAccountToken
    }

    func attachAppleBillingTransaction(
        signedTransaction: String,
        intent: AppleBillingTransactionIntent,
        session: CloudLinkedSession
    ) async throws {
        let response: AppleBillingTransactionResponse = try await self.request(
            apiBaseUrl: session.apiBaseUrl,
            authorizationHeader: session.authorizationHeaderValue,
            path: "/billing/apple/transactions",
            method: "POST",
            body: AppleBillingTransactionRequest(signedTransaction: signedTransaction, intent: intent)
        )
        guard response.attached else {
            throw AppleSubscriptionError.attachmentNotConfirmed
        }
    }
}
