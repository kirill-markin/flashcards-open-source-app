import Foundation

private let cloudAuthResponseDecodingFailedCode: String = "RESPONSE_DECODING_FAILED"
private let cloudAuthResponseContractFailedCode: String = "RESPONSE_CONTRACT_FAILED"
private let cloudAuthResponseDecodingFailedMessage: String = "Failed to decode cloud auth response"

enum CloudAuthError: LocalizedError {
    case invalidBaseUrl(String)
    case invalidResponse(CloudApiErrorDetails, Int)
    case invalidResponseBody(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseUrl:
            return String(
                localized: "cloud_auth.error.invalid_base_url",
                table: "Foundation",
                comment: "Cloud auth error when the auth base URL is invalid"
            )
        case .invalidResponse(let details, _):
            switch details.code {
            case "INVALID_EMAIL":
                return String(
                    localized: "cloud_auth.error.invalid_email",
                    table: "Foundation",
                    comment: "Cloud auth error when the email address is invalid"
                )
            case "OTP_SESSION_EXPIRED":
                return String(
                    localized: "cloud_auth.error.otp_session_expired",
                    table: "Foundation",
                    comment: "Cloud auth error when the OTP session expired"
                )
            case "OTP_CHALLENGE_CONSUMED":
                return String(
                    localized: "cloud_auth.error.otp_challenge_consumed",
                    table: "Foundation",
                    comment: "Cloud auth error when the OTP challenge was already used"
                )
            case "OTP_CODE_INVALID":
                return String(
                    localized: "cloud_auth.error.otp_code_invalid",
                    table: "Foundation",
                    comment: "Cloud auth error when the OTP code is invalid"
                )
            case "OTP_SEND_FAILED":
                return appendCloudRequestIdReference(
                    message: String(
                        localized: "cloud_auth.error.otp_send_failed",
                        table: "Foundation",
                        comment: "Cloud auth error when sending the OTP code failed"
                    ),
                    requestId: details.requestId
                )
            case "OTP_VERIFY_FAILED":
                return appendCloudRequestIdReference(
                    message: String(
                        localized: "cloud_auth.error.otp_verify_failed",
                        table: "Foundation",
                        comment: "Cloud auth error when verifying the OTP code failed"
                    ),
                    requestId: details.requestId
                )
            default:
                return appendCloudRequestIdReference(
                    message: String(
                        localized: "cloud_auth.error.sign_in_failed",
                        table: "Foundation",
                        comment: "Cloud auth error for an unknown sign-in failure"
                    ),
                    requestId: details.requestId
                )
            }
        case .invalidResponseBody:
            return String(
                localized: "cloud_auth.error.sign_in_failed",
                table: "Foundation",
                comment: "Cloud auth error for an unknown sign-in failure"
            )
        }
    }

    var statusCode: Int? {
        switch self {
        case .invalidResponse(_, let statusCode):
            return statusCode
        case .invalidBaseUrl, .invalidResponseBody:
            return nil
        }
    }
}

private struct SendCodeRequest: Encodable {
    let email: String
}

private struct SendCodeResponse: Decodable {
    let ok: Bool
    let csrfToken: String?
    // Native clients cannot safely depend on browser-style cookie replay across
    // OTP requests, so the signed OTP session is returned explicitly as well.
    let otpSessionToken: String?
    let idToken: String?
    let refreshToken: String?
    let expiresIn: Int?
}

private struct VerifyCodeRequest: Encodable {
    let code: String
    let csrfToken: String
    // iOS sends the signed OTP session back in the body instead of relying on
    // cookie persistence between send-code and verify-code.
    let otpSessionToken: String
}

private struct AuthSuccessResponse: Decodable {
    let ok: Bool
    let idToken: String
    let refreshToken: String
    let expiresIn: Int
}

private struct RefreshTokenRequest: Encodable {
    let refreshToken: String
}

private struct RefreshTokenResponse: Decodable {
    let ok: Bool
    let idToken: String
    let expiresIn: Int
}

private struct CloudAuthResponseDiagnostics {
    let statusCode: Int
    let requestId: String?
    let backendCode: String?
}

private struct CloudAuthResponseEnvelope<Response> {
    let value: Response
    let diagnostics: CloudAuthResponseDiagnostics
}

@MainActor
final class CloudAuthService {
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let session: URLSession
    private let cookieStorage: HTTPCookieStorage

    init(
        encoder: JSONEncoder = JSONEncoder(),
        decoder: JSONDecoder = makeFlashcardsRemoteJSONDecoder(),
        session: URLSession? = nil,
        cookieStorage: HTTPCookieStorage = HTTPCookieStorage()
    ) {
        self.encoder = encoder
        self.decoder = decoder
        self.cookieStorage = cookieStorage

        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpShouldSetCookies = true
            configuration.httpCookieAcceptPolicy = .always
            configuration.httpCookieStorage = cookieStorage
            self.session = URLSession(configuration: configuration)
        }
    }

    func sendCode(email: String, authBaseUrl: String) async throws -> CloudSendCodeResult {
        self.resetChallengeSession()

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let envelope: CloudAuthResponseEnvelope<SendCodeResponse> = try await self.request(
            authBaseUrl: authBaseUrl,
            path: "/api/send-code",
            method: "POST",
            body: SendCodeRequest(email: normalizedEmail)
        )
        let response: SendCodeResponse = envelope.value

        guard response.ok else {
            throw makeCloudAuthResponseContractError(
                phase: .authSendCode,
                message: "send-code did not return ok=true",
                diagnostics: envelope.diagnostics
            )
        }

        if
            let idToken = response.idToken,
            idToken.isEmpty == false,
            let refreshToken = response.refreshToken,
            refreshToken.isEmpty == false,
            let expiresIn = response.expiresIn
        {
            logCloudFlowPhase(
                phase: .authSendCode,
                outcome: "success",
                requestId: envelope.diagnostics.requestId
            )
            return .verifiedCredentials(
                self.makeStoredCloudCredentials(
                    refreshToken: refreshToken,
                    idToken: idToken,
                    expiresIn: expiresIn
                )
            )
        }

        guard let csrfToken = response.csrfToken, csrfToken.isEmpty == false else {
            throw makeCloudAuthResponseContractError(
                phase: .authSendCode,
                message: "send-code did not return csrfToken",
                diagnostics: envelope.diagnostics
            )
        }
        guard let otpSessionToken = response.otpSessionToken, otpSessionToken.isEmpty == false else {
            throw makeCloudAuthResponseContractError(
                phase: .authSendCode,
                message: "send-code did not return otpSessionToken",
                diagnostics: envelope.diagnostics
            )
        }

        logCloudFlowPhase(
            phase: .authSendCode,
            outcome: "success",
            requestId: envelope.diagnostics.requestId
        )
        return .otpChallenge(
            CloudOtpChallenge(
                email: normalizedEmail,
                csrfToken: csrfToken,
                otpSessionToken: otpSessionToken
            )
        )
    }

    func verifyCode(challenge: CloudOtpChallenge, code: String, authBaseUrl: String) async throws -> StoredCloudCredentials {
        let normalizedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        let envelope: CloudAuthResponseEnvelope<AuthSuccessResponse> = try await self.request(
            authBaseUrl: authBaseUrl,
            path: "/api/verify-code",
            method: "POST",
            body: VerifyCodeRequest(
                code: normalizedCode,
                csrfToken: challenge.csrfToken,
                otpSessionToken: challenge.otpSessionToken
            )
        )
        let response: AuthSuccessResponse = envelope.value

        guard response.ok else {
            throw makeCloudAuthResponseContractError(
                phase: .authVerifyCode,
                message: "verify-code did not return ok=true",
                diagnostics: envelope.diagnostics
            )
        }

        logCloudFlowPhase(
            phase: .authVerifyCode,
            outcome: "success",
            requestId: envelope.diagnostics.requestId
        )
        return makeStoredCloudCredentials(
            refreshToken: response.refreshToken,
            idToken: response.idToken,
            expiresIn: response.expiresIn
        )
    }

    func refreshIdToken(refreshToken: String, authBaseUrl: String) async throws -> CloudIdentityToken {
        let envelope: CloudAuthResponseEnvelope<RefreshTokenResponse> = try await self.request(
            authBaseUrl: authBaseUrl,
            path: "/api/refresh-token",
            method: "POST",
            body: RefreshTokenRequest(refreshToken: refreshToken)
        )
        let response: RefreshTokenResponse = envelope.value

        guard response.ok else {
            throw makeCloudAuthResponseContractError(
                phase: .authRefreshToken,
                message: "refresh-token did not return ok=true",
                diagnostics: envelope.diagnostics
            )
        }

        logCloudFlowPhase(
            phase: .authRefreshToken,
            outcome: "success",
            requestId: envelope.diagnostics.requestId
        )
        return CloudIdentityToken(
            idToken: response.idToken,
            idTokenExpiresAt: makeIdTokenExpiryTimestamp(now: Date(), expiresInSeconds: response.expiresIn)
        )
    }

    func resetChallengeSession() {
        if let cookies = self.cookieStorage.cookies {
            for cookie in cookies {
                self.cookieStorage.deleteCookie(cookie)
            }
        }
    }

    private func makeUrl(authBaseUrl: String, path: String) throws -> URL {
        let trimmedBaseUrl = authBaseUrl.hasSuffix("/") ? String(authBaseUrl.dropLast()) : authBaseUrl
        guard let url = URL(string: "\(trimmedBaseUrl)\(path)") else {
            throw CloudAuthError.invalidBaseUrl(authBaseUrl)
        }

        return url
    }

    private func phase(for path: String) -> CloudFlowPhase {
        switch path {
        case "/api/send-code":
            return .authSendCode
        case "/api/verify-code":
            return .authVerifyCode
        case "/api/refresh-token":
            return .authRefreshToken
        default:
            return .authRequest
        }
    }

    private func makeStoredCloudCredentials(
        refreshToken: String,
        idToken: String,
        expiresIn: Int
    ) -> StoredCloudCredentials {
        StoredCloudCredentials(
            refreshToken: refreshToken,
            idToken: idToken,
            idTokenExpiresAt: makeIdTokenExpiryTimestamp(now: Date(), expiresInSeconds: expiresIn)
        )
    }

    private func request<Response: Decodable, Body: Encodable>(
        authBaseUrl: String,
        path: String,
        method: String,
        body: Body
    ) async throws -> CloudAuthResponseEnvelope<Response> {
        var request = URLRequest(url: try self.makeUrl(authBaseUrl: authBaseUrl, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try self.encoder.encode(body)

        let phase = self.phase(for: path)
        logCloudFlowPhase(phase: phase, outcome: "start")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await self.session.data(for: request)
        } catch {
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                errorMessage: Flashcards.errorMessage(error: error)
            )
            throw error
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                errorMessage: "Cloud auth did not receive an HTTP response"
            )
            throw LocalStoreError.database("Cloud auth did not receive an HTTP response")
        }
        let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")

        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            let errorDetails = decodeCloudApiErrorDetails(data: data, requestId: requestId)
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                requestId: errorDetails.requestId,
                code: errorDetails.code,
                statusCode: httpResponse.statusCode
            )
            throw CloudAuthError.invalidResponse(errorDetails, httpResponse.statusCode)
        }

        do {
            let decodedResponse: Response = try self.decoder.decode(Response.self, from: data)
            let diagnostics: CloudAuthResponseDiagnostics = CloudAuthResponseDiagnostics(
                statusCode: httpResponse.statusCode,
                requestId: requestId,
                backendCode: nil
            )
            return CloudAuthResponseEnvelope(value: decodedResponse, diagnostics: diagnostics)
        } catch {
            let errorDetails: CloudApiErrorDetails = makeCloudAuthResponseDecodingErrorDetails(
                requestId: requestId
            )
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                requestId: errorDetails.requestId,
                code: errorDetails.code,
                statusCode: httpResponse.statusCode,
                errorMessage: errorDetails.message
            )
            throw CloudAuthError.invalidResponse(errorDetails, httpResponse.statusCode)
        }
    }
}

private func makeCloudAuthResponseContractError(
    phase: CloudFlowPhase,
    message: String,
    diagnostics: CloudAuthResponseDiagnostics
) -> CloudAuthError {
    let errorDetails: CloudApiErrorDetails = CloudApiErrorDetails(
        message: message,
        requestId: diagnostics.requestId,
        code: diagnostics.backendCode ?? cloudAuthResponseContractFailedCode,
        syncConflict: nil
    )
    logCloudFlowPhase(
        phase: phase,
        outcome: "failure",
        requestId: errorDetails.requestId,
        code: errorDetails.code,
        statusCode: diagnostics.statusCode,
        errorMessage: message
    )
    return CloudAuthError.invalidResponse(errorDetails, diagnostics.statusCode)
}

private func makeCloudAuthResponseDecodingErrorDetails(
    requestId: String?
) -> CloudApiErrorDetails {
    CloudApiErrorDetails(
        message: cloudAuthResponseDecodingFailedMessage,
        requestId: requestId,
        code: cloudAuthResponseDecodingFailedCode,
        syncConflict: nil
    )
}
