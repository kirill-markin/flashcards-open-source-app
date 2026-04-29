import Foundation
import XCTest
@testable import Flashcards

@MainActor
final class GuestCloudAuthServiceCapabilityTests: XCTestCase {
    override func tearDown() {
        GuestCloudAuthServiceTestURLProtocol.reset()
        super.tearDown()
    }

    func testCompleteGuestUpgradeSendsExplicitCapabilitiesAndDrainAssertion() async throws {
        GuestCloudAuthServiceTestURLProtocol.requestHandler = { request in
            let body = try guestCloudAuthServiceTestRequestBody(request: request)
            let requestBody = try JSONDecoder().decode(
                GuestUpgradeCompleteRequestBody.self,
                from: body
            )
            GuestCloudAuthServiceTestURLProtocol.supportsDroppedEntitiesValues.append(
                requestBody.supportsDroppedEntities
            )
            GuestCloudAuthServiceTestURLProtocol.guestWorkspaceSyncedAndOutboxDrainedValues.append(
                requestBody.guestWorkspaceSyncedAndOutboxDrained
            )
            GuestCloudAuthServiceTestURLProtocol.guestTokens.append(requestBody.guestToken)

            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )
            )
            let responseBody = Data(
                """
                {
                  "workspace": {
                    "workspaceId": "workspace-linked",
                    "name": "Personal",
                    "createdAt": "2026-04-01T00:00:00.000Z",
                    "isSelected": true
                  }
                }
                """.utf8
            )
            return (response, responseBody)
        }

        let service = GuestCloudAuthService(session: self.makeSession())
        _ = try await service.completeGuestUpgrade(
            apiBaseUrl: "https://api.example.test/v1",
            bearerToken: "id-token",
            guestToken: "guest-token",
            selection: .createNew,
            supportsDroppedEntities: false,
            guestWorkspaceSyncedAndOutboxDrained: true
        )
        _ = try await service.completeGuestUpgrade(
            apiBaseUrl: "https://api.example.test/v1",
            bearerToken: "id-token",
            guestToken: "guest-token",
            selection: .createNew,
            supportsDroppedEntities: true,
            guestWorkspaceSyncedAndOutboxDrained: true
        )

        XCTAssertEqual(
            [false, true],
            GuestCloudAuthServiceTestURLProtocol.supportsDroppedEntitiesValues
        )
        XCTAssertEqual(
            [true, true],
            GuestCloudAuthServiceTestURLProtocol.guestWorkspaceSyncedAndOutboxDrainedValues
        )
        XCTAssertEqual(
            ["guest-token", "guest-token"],
            GuestCloudAuthServiceTestURLProtocol.guestTokens
        )
    }

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GuestCloudAuthServiceTestURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}
