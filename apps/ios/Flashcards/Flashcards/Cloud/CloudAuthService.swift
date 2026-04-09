import Foundation

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
        logCloudFlowPhase(phase: .authSendCode, outcome: "start")
        let response: SendCodeResponse = try await self.request(
            authBaseUrl: authBaseUrl,
            path: "/api/send-code",
            method: "POST",
            body: SendCodeRequest(email: normalizedEmail)
        )

        guard response.ok else {
            throw CloudAuthError.invalidResponseBody("send-code did not return ok=true")
        }

        if
            let idToken = response.idToken,
            idToken.isEmpty == false,
            let refreshToken = response.refreshToken,
            refreshToken.isEmpty == false,
            let expiresIn = response.expiresIn
        {
            return .verifiedCredentials(
                self.makeStoredCloudCredentials(
                    refreshToken: refreshToken,
                    idToken: idToken,
                    expiresIn: expiresIn
                )
            )
        }

        guard let csrfToken = response.csrfToken, csrfToken.isEmpty == false else {
            throw CloudAuthError.invalidResponseBody("send-code did not return csrfToken")
        }
        guard let otpSessionToken = response.otpSessionToken, otpSessionToken.isEmpty == false else {
            throw CloudAuthError.invalidResponseBody("send-code did not return otpSessionToken")
        }

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
        logCloudFlowPhase(phase: .authVerifyCode, outcome: "start")
        let response: AuthSuccessResponse = try await self.request(
            authBaseUrl: authBaseUrl,
            path: "/api/verify-code",
            method: "POST",
            body: VerifyCodeRequest(
                code: normalizedCode,
                csrfToken: challenge.csrfToken,
                otpSessionToken: challenge.otpSessionToken
            )
        )

        guard response.ok else {
            throw CloudAuthError.invalidResponseBody("verify-code did not return ok=true")
        }

        return makeStoredCloudCredentials(
            refreshToken: response.refreshToken,
            idToken: response.idToken,
            expiresIn: response.expiresIn
        )
    }

    func refreshIdToken(refreshToken: String, authBaseUrl: String) async throws -> CloudIdentityToken {
        let response: RefreshTokenResponse = try await self.request(
            authBaseUrl: authBaseUrl,
            path: "/api/refresh-token",
            method: "POST",
            body: RefreshTokenRequest(refreshToken: refreshToken)
        )

        guard response.ok else {
            throw CloudAuthError.invalidResponseBody("refresh-token did not return ok=true")
        }

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
        default:
            return .authVerifyCode
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
    ) async throws -> Response {
        var request = URLRequest(url: try self.makeUrl(authBaseUrl: authBaseUrl, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try self.encoder.encode(body)

        let (data, response) = try await self.session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LocalStoreError.database("Cloud auth did not receive an HTTP response")
        }

        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id")
            let errorDetails = decodeCloudApiErrorDetails(data: data, requestId: requestId)
            let phase = self.phase(for: path)
            logCloudFlowPhase(
                phase: phase,
                outcome: "failure",
                requestId: errorDetails.requestId,
                code: errorDetails.code,
                statusCode: httpResponse.statusCode
            )
            throw CloudAuthError.invalidResponse(errorDetails, httpResponse.statusCode)
        }

        let phase = self.phase(for: path)
        logCloudFlowPhase(phase: phase, outcome: "success")

        return try self.decoder.decode(Response.self, from: data)
    }
}
