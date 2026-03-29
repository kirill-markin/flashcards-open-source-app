import Foundation
import XCTest
@testable import Flashcards

final class CloudAuthServiceTests: XCTestCase {
    override func tearDown() {
        MockUrlProtocol.requestHandler = nil
        super.tearDown()
    }

    @MainActor
    func testSendCodeReturnsOtpSessionTokenFromResponse() async throws {
        MockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://auth.example.com/api/send-code")
            XCTAssertEqual(request.httpMethod, "POST")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {"ok":true,"csrfToken":"csrf-token","otpSessionToken":"signed-otp-session"}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = self.makeService(session: self.makeSession())

        let result = try await service.sendCode(
            email: " User@Example.com ",
            authBaseUrl: "https://auth.example.com"
        )

        switch result {
        case .otpChallenge(let challenge):
            XCTAssertEqual(challenge.email, "user@example.com")
            XCTAssertEqual(challenge.csrfToken, "csrf-token")
            XCTAssertEqual(challenge.otpSessionToken, "signed-otp-session")
        case .verifiedCredentials:
            XCTFail("Expected an OTP challenge result")
        }
    }

    @MainActor
    func testSendCodeReturnsVerifiedCredentialsForDemoResponse() async throws {
        MockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://auth.example.com/api/send-code")
            XCTAssertEqual(request.httpMethod, "POST")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {"ok":true,"idToken":"id-token","refreshToken":"refresh-token","expiresIn":3600}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = self.makeService(session: self.makeSession())

        let result = try await service.sendCode(
            email: "demo-review@example.com",
            authBaseUrl: "https://auth.example.com"
        )

        switch result {
        case .otpChallenge:
            XCTFail("Expected an immediate verified credentials result")
        case .verifiedCredentials(let credentials):
            XCTAssertEqual(credentials.idToken, "id-token")
            XCTAssertEqual(credentials.refreshToken, "refresh-token")
        }
    }

    @MainActor
    func testVerifyCodeSendsOtpSessionTokenInRequestBody() async throws {
        MockUrlProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://auth.example.com/api/verify-code")
            XCTAssertEqual(request.httpMethod, "POST")

            let bodyData = try XCTUnwrap(request.httpBody)
            let bodyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: String])
            XCTAssertEqual(bodyObject["code"], "12345678")
            XCTAssertEqual(bodyObject["csrfToken"], "csrf-token")
            XCTAssertEqual(bodyObject["otpSessionToken"], "signed-otp-session")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {"ok":true,"idToken":"id-token","refreshToken":"refresh-token","expiresIn":3600}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = self.makeService(session: self.makeSession())
        let challenge = CloudOtpChallenge(
            email: "user@example.com",
            csrfToken: "csrf-token",
            otpSessionToken: "signed-otp-session"
        )

        let credentials = try await service.verifyCode(
            challenge: challenge,
            code: "12345678",
            authBaseUrl: "https://auth.example.com"
        )

        XCTAssertEqual(credentials.refreshToken, "refresh-token")
        XCTAssertEqual(credentials.idToken, "id-token")
    }

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockUrlProtocol.self]
        return URLSession(configuration: configuration)
    }

    @MainActor
    private func makeService(session: URLSession) -> CloudAuthService {
        CloudAuthService(session: session)
    }
}

private final class MockUrlProtocol: URLProtocol {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = MockUrlProtocol.requestHandler else {
            XCTFail("MockUrlProtocol.requestHandler is not set")
            return
        }

        do {
            let (response, data) = try handler(materializedRequest(self.request))
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        } catch {
            self.client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
