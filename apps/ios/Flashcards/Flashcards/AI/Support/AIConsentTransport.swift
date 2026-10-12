import Foundation

func registerAIConsent(
    evidence: AIConsentEvidence,
    session: CloudLinkedSession,
    urlSession: URLSession
) async throws -> AIConsentReceipt {
    let base = session.apiBaseUrl.hasSuffix("/") ? String(session.apiBaseUrl.dropLast()) : session.apiBaseUrl
    // The native smoke exercises a real transport failure without inventing a receipt.
    let endpoint = isFlashcardsUITestLaunch(processInfo: .processInfo)
        && ProcessInfo.processInfo.environment["FLASHCARDS_UI_TEST_AI_CONSENT_UNREACHABLE"] == "1"
        ? "https://ai-consent-unavailable.invalid/ai/consent" : "\(base)/ai/consent"
    guard let url = URL(string: endpoint) else {
        throw AIConsentError.invalidState
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 15
    request.setValue(session.authorization.headerValue, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(evidence)
    let (data, response) = try await urlSession.data(for: request)
    guard let response = response as? HTTPURLResponse else {
        throw AIConsentError.invalidReceipt
    }
    guard response.statusCode == 200 else {
        throw AIConsentError.responseNotOk(
            response.statusCode,
            decodeCloudApiErrorDetails(data: data, requestId: response.value(forHTTPHeaderField: "X-Request-Id"))
        )
    }
    let receipt = try JSONDecoder().decode(AIConsentReceipt.self, from: data)
    guard receipt.matches(evidence) else {
        throw AIConsentError.invalidReceipt
    }
    return receipt
}
