import Foundation
import XCTest
@testable import Flashcards

final class CloudSupportTests: XCTestCase {
    override func tearDown() {
        CloudSupportMockUrlProtocol.requestHandler = nil
        super.tearDown()
    }

    func testLoadCloudServiceConfigurationReadsUrlsFromBundleInfoDictionary() throws {
        let bundle = try self.makeBundle(
            infoDictionary: [
                "FLASHCARDS_API_BASE_URL": "https://api.example.com/v1/",
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.example.com/"
            ]
        )
        let userDefaults = try self.makeUserDefaults()

        let configuration = try loadCloudServiceConfiguration(
            bundle: bundle,
            userDefaults: userDefaults,
            decoder: JSONDecoder()
        )

        XCTAssertEqual(configuration.mode, .official)
        XCTAssertNil(configuration.customOrigin)
        XCTAssertEqual(configuration.apiBaseUrl, "https://api.example.com/v1")
        XCTAssertEqual(configuration.authBaseUrl, "https://auth.example.com")
    }

    func testLoadFlashcardsLegalSupportConfigurationReadsValuesFromBundleInfoDictionary() throws {
        let bundle = try self.makeBundle(
            infoDictionary: [
                "FLASHCARDS_PRIVACY_POLICY_URL": "https://flashcards.example.com/privacy/",
                "FLASHCARDS_TERMS_OF_SERVICE_URL": "https://flashcards.example.com/terms/",
                "FLASHCARDS_SUPPORT_URL": "https://flashcards.example.com/support/",
                "FLASHCARDS_SUPPORT_EMAIL_ADDRESS": "support@example.com"
            ]
        )

        let configuration = try loadFlashcardsLegalSupportConfiguration(bundle: bundle)

        XCTAssertEqual(
            configuration,
            FlashcardsLegalSupportConfiguration(
                privacyPolicyUrl: "https://flashcards.example.com/privacy/",
                termsOfServiceUrl: "https://flashcards.example.com/terms/",
                supportUrl: "https://flashcards.example.com/support/",
                supportEmailAddress: "support@example.com"
            )
        )
    }

    func testLoadCloudServiceConfigurationUsesStoredCustomServerOverrideWhenPresent() throws {
        let bundle = try self.makeBundle(
            infoDictionary: [
                "FLASHCARDS_API_BASE_URL": "https://api.flashcards-open-source-app.com/v1",
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.flashcards-open-source-app.com"
            ]
        )
        let suiteName = "cloud-support-tests-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        userDefaults.removePersistentDomain(forName: suiteName)
        self.addTeardownBlock { [suiteName] in
            UserDefaults(suiteName: suiteName)?.removePersistentDomain(forName: suiteName)
        }
        try saveCloudServerOverride(
            override: CloudServerOverride(customOrigin: "https://self-hosted.example.com"),
            userDefaults: userDefaults,
            encoder: JSONEncoder()
        )

        let configuration = try loadCloudServiceConfiguration(
            bundle: bundle,
            userDefaults: userDefaults,
            decoder: JSONDecoder()
        )

        XCTAssertEqual(configuration.mode, .custom)
        XCTAssertEqual(configuration.customOrigin, "https://self-hosted.example.com")
        XCTAssertEqual(configuration.apiBaseUrl, "https://api.self-hosted.example.com/v1")
        XCTAssertEqual(configuration.authBaseUrl, "https://auth.self-hosted.example.com")
    }

    func testLoadCloudServiceConfigurationThrowsMissingValueWhenApiBaseUrlIsAbsent() throws {
        let bundle = try self.makeBundle(
            infoDictionary: [
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.example.com"
            ]
        )
        let userDefaults = try self.makeUserDefaults()

        XCTAssertThrowsError(try loadCloudServiceConfiguration(bundle: bundle, userDefaults: userDefaults, decoder: JSONDecoder())) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .missingValue("FLASHCARDS_API_BASE_URL")
            )
        }
    }

    func testLoadCloudServiceConfigurationThrowsInvalidUrlWhenApiBaseUrlIsMalformed() throws {
        let bundle = try self.makeBundle(
            infoDictionary: [
                "FLASHCARDS_API_BASE_URL": "not a url",
                "FLASHCARDS_AUTH_BASE_URL": "https://auth.example.com"
            ]
        )
        let userDefaults = try self.makeUserDefaults()

        XCTAssertThrowsError(try loadCloudServiceConfiguration(bundle: bundle, userDefaults: userDefaults, decoder: JSONDecoder())) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .invalidUrl("FLASHCARDS_API_BASE_URL", "not a url")
            )
        }
    }

    func testLoadFlashcardsLegalSupportConfigurationThrowsMissingValueWhenPrivacyUrlIsEmpty() throws {
        let bundle = try self.makeBundle(
            infoDictionary: [
                "FLASHCARDS_PRIVACY_POLICY_URL": "   ",
                "FLASHCARDS_TERMS_OF_SERVICE_URL": "https://flashcards.example.com/terms/",
                "FLASHCARDS_SUPPORT_URL": "https://flashcards.example.com/support/",
                "FLASHCARDS_SUPPORT_EMAIL_ADDRESS": "support@example.com"
            ]
        )

        XCTAssertThrowsError(try loadFlashcardsLegalSupportConfiguration(bundle: bundle)) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .missingValue("FLASHCARDS_PRIVACY_POLICY_URL")
            )
        }
    }

    func testLoadFlashcardsLegalSupportConfigurationThrowsInvalidUrlWhenSupportUrlIsMalformed() throws {
        let bundle = try self.makeBundle(
            infoDictionary: [
                "FLASHCARDS_PRIVACY_POLICY_URL": "https://flashcards.example.com/privacy/",
                "FLASHCARDS_TERMS_OF_SERVICE_URL": "https://flashcards.example.com/terms/",
                "FLASHCARDS_SUPPORT_URL": "not a url",
                "FLASHCARDS_SUPPORT_EMAIL_ADDRESS": "support@example.com"
            ]
        )

        XCTAssertThrowsError(try loadFlashcardsLegalSupportConfiguration(bundle: bundle)) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .invalidUrl("FLASHCARDS_SUPPORT_URL", "not a url")
            )
        }
    }

    func testMakeCustomCloudServiceConfigurationRejectsInvalidOrigin() {
        XCTAssertThrowsError(try makeCustomCloudServiceConfiguration(customOrigin: "http://example.com/path")) { error in
            XCTAssertEqual(
                error as? CloudConfigurationError,
                .invalidCustomOrigin("http://example.com/path")
            )
        }
    }

    @MainActor
    func testCloudServiceConfigurationValidatorChecksExpectedHealthEndpoints() async throws {
        let recorder = CloudSupportRequestRecorder()
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.absoluteString)

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data())
        }

        let validator = CloudServiceConfigurationValidator(session: self.makeSession())

        try await validator.validate(
            configuration: CloudServiceConfiguration(
                mode: .custom,
                customOrigin: "https://example.com",
                apiBaseUrl: "https://api.example.com/v1",
                authBaseUrl: "https://auth.example.com"
            )
        )

        XCTAssertEqual(
            Set(recorder.requestPaths),
            [
                "https://api.example.com/v1/health",
                "https://auth.example.com/health"
            ]
        )
    }

    @MainActor
    func testCloudServiceConfigurationValidatorFailsWhenHealthCheckReturnsNonSuccessStatus() async throws {
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            let response = HTTPURLResponse(
                url: url,
                statusCode: url.absoluteString.contains("auth.") ? 503 : 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data())
        }

        let validator = CloudServiceConfigurationValidator(session: self.makeSession())

        do {
            try await validator.validate(
                configuration: CloudServiceConfiguration(
                    mode: .custom,
                    customOrigin: "https://example.com",
                    apiBaseUrl: "https://api.example.com/v1",
                    authBaseUrl: "https://auth.example.com"
                )
            )
            XCTFail("Expected health-check validation to fail")
        } catch {
            XCTAssertEqual(
                Flashcards.errorMessage(error: error),
                "Auth service health check returned status 503 for https://auth.example.com/health"
            )
        }
    }

    @MainActor
    func testRenameWorkspaceCallsRenameEndpointAndDecodesWorkspaceSummary() async throws {
        let (_, database) = try self.makeDatabaseWithURL()
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            XCTAssertEqual(url.path, "/v1/workspaces/workspace-1/rename")
            XCTAssertEqual(request.httpMethod, "POST")

            let bodyData = try XCTUnwrap(request.httpBody)
            let bodyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: String])
            XCTAssertEqual(bodyObject["name"], "Renamed workspace")

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {"workspace":{"workspaceId":"workspace-1","name":"Renamed workspace","createdAt":"2026-03-16T10:00:00.000Z","isSelected":true}}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())
        let workspace = try await service.renameWorkspace(
            apiBaseUrl: "https://api.example.com/v1",
            bearerToken: "id-token",
            workspaceId: "workspace-1",
            name: "Renamed workspace"
        )

        XCTAssertEqual(workspace.name, "Renamed workspace")
        XCTAssertTrue(workspace.isSelected)
    }

    @MainActor
    func testLoadWorkspaceDeletePreviewCallsPreviewEndpoint() async throws {
        let (_, database) = try self.makeDatabaseWithURL()
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            XCTAssertEqual(url.path, "/v1/workspaces/workspace-1/delete-preview")
            XCTAssertEqual(request.httpMethod, "GET")

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {"workspaceId":"workspace-1","workspaceName":"Primary","activeCardCount":8,"confirmationText":"delete workspace","isLastAccessibleWorkspace":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())
        let preview = try await service.loadWorkspaceDeletePreview(
            apiBaseUrl: "https://api.example.com/v1",
            bearerToken: "id-token",
            workspaceId: "workspace-1"
        )

        XCTAssertEqual(preview.activeCardCount, 8)
        XCTAssertEqual(preview.confirmationText, "delete workspace")
    }

    @MainActor
    func testDeleteWorkspaceCallsDeleteEndpointAndDecodesReplacementWorkspace() async throws {
        let (_, database) = try self.makeDatabaseWithURL()
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            XCTAssertEqual(url.path, "/v1/workspaces/workspace-1/delete")
            XCTAssertEqual(request.httpMethod, "POST")

            let bodyData = try XCTUnwrap(request.httpBody)
            let bodyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: String])
            XCTAssertEqual(bodyObject["confirmationText"], "delete workspace")

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {"ok":true,"deletedWorkspaceId":"workspace-1","deletedCardsCount":3,"workspace":{"workspaceId":"workspace-2","name":"Replacement","createdAt":"2026-03-16T10:00:00.000Z","isSelected":true}}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())
        let response = try await service.deleteWorkspace(
            apiBaseUrl: "https://api.example.com/v1",
            bearerToken: "id-token",
            workspaceId: "workspace-1",
            confirmationText: "delete workspace"
        )

        XCTAssertEqual(response.deletedWorkspaceId, "workspace-1")
        XCTAssertEqual(response.workspace.workspaceId, "workspace-2")
    }

    func testIsValidCloudEmailReturnsTrueForExpectedEmail() {
        XCTAssertTrue(isValidCloudEmail("user@example.com"))
    }

    func testIsValidCloudEmailReturnsFalseForEmptyValue() {
        XCTAssertFalse(isValidCloudEmail(""))
    }

    func testIsValidCloudEmailReturnsFalseForMissingDomain() {
        XCTAssertFalse(isValidCloudEmail("user@"))
    }

    func testIsValidCloudEmailReturnsFalseForMissingTopLevelDomain() {
        XCTAssertFalse(isValidCloudEmail("user@example"))
    }

    func testIsValidCloudEmailReturnsFalseForWhitespaceInsideAddress() {
        XCTAssertFalse(isValidCloudEmail("user example.com"))
    }

    func testIsValidCloudEmailNormalizesCaseAndOuterWhitespace() {
        XCTAssertEqual(normalizedCloudEmail(" User@Example.com "), "user@example.com")
        XCTAssertTrue(isValidCloudEmail(" User@Example.com "))
    }

    func testMakeSyncStatusPresentationReturnsSuccessForLinkedIdleState() {
        XCTAssertEqual(
            makeSyncStatusPresentation(status: .idle, cloudState: .linked),
            SyncStatusPresentation(title: "Successfully synced", tone: .success)
        )
    }

    func testMakeSyncStatusPresentationReturnsInProgressForSyncingState() {
        XCTAssertEqual(
            makeSyncStatusPresentation(status: .syncing, cloudState: .linked),
            SyncStatusPresentation(title: "Syncing", tone: .inProgress)
        )
    }

    func testMakeSyncStatusPresentationReturnsFailureForFailedState() {
        XCTAssertEqual(
            makeSyncStatusPresentation(
                status: .failed(message: "Network timeout"),
                cloudState: .linked
            ),
            SyncStatusPresentation(title: "Sync failed: Network timeout", tone: .failure)
        )
    }

    func testMakeSyncStatusPresentationReturnsNeutralForDisconnectedIdleState() {
        XCTAssertEqual(
            makeSyncStatusPresentation(status: .idle, cloudState: .disconnected),
            SyncStatusPresentation(title: "Not syncing", tone: .neutral)
        )
    }

    func testMakeSyncStatusPresentationReturnsNeutralForLinkingReadyIdleState() {
        XCTAssertEqual(
            makeSyncStatusPresentation(status: .idle, cloudState: .linkingReady),
            SyncStatusPresentation(title: "Not syncing", tone: .neutral)
        )
    }

    func testMakeCloudWorkspacePostAuthRouteAutoLinksByCreatingWorkspaceWhenListIsEmpty() {
        XCTAssertEqual(
            makeCloudWorkspacePostAuthRoute(workspaces: []),
            .autoLink(.createNew)
        )
    }

    func testMakeCloudWorkspacePostAuthRouteAutoLinksSingleWorkspace() {
        XCTAssertEqual(
            makeCloudWorkspacePostAuthRoute(workspaces: [
                self.makeCloudWorkspaceSummary(workspaceId: "workspace-1")
            ]),
            .autoLink(.existing(workspaceId: "workspace-1"))
        )
    }

    func testMakeCloudWorkspacePostAuthRouteShowsChooserForSeveralWorkspaces() {
        XCTAssertEqual(
            makeCloudWorkspacePostAuthRoute(workspaces: [
                self.makeCloudWorkspaceSummary(workspaceId: "workspace-1"),
                self.makeCloudWorkspaceSummary(workspaceId: "workspace-2")
            ]),
            .chooseWorkspace
        )
    }

    func testMakeCloudPostAuthSyncPresentationReturnsExpectedCopy() {
        XCTAssertEqual(
            makeCloudPostAuthSyncPresentation(),
            CloudPostAuthSyncPresentation(
                title: "Your account is syncing with the cloud.",
                message: "Please do not turn off your phone. This usually takes a few minutes."
            )
        )
    }

    func testMakeCloudPostAuthFailurePresentationKeepsCompleteLinkRetryWhenAccountIsNotLinked() {
        let linkContext = self.makeCloudWorkspaceLinkContext(workspaces: [
            self.makeCloudWorkspaceSummary(workspaceId: "workspace-1")
        ])
        let operation = CloudPostAuthSyncOperation.completeLink(
            linkContext: linkContext,
            selection: .existing(workspaceId: "workspace-1")
        )

        XCTAssertEqual(
            makeCloudPostAuthFailurePresentation(
                operation: operation,
                cloudState: .disconnected
            ),
            CloudPostAuthFailurePresentation(
                title: "Signed in, but cloud setup failed.",
                retryAction: .completeLink(
                    linkContext: linkContext,
                    selection: .existing(workspaceId: "workspace-1")
                )
            )
        )
    }

    func testMakeCloudPostAuthFailurePresentationUsesSyncRetryWhenAccountIsAlreadyLinked() {
        let linkContext = self.makeCloudWorkspaceLinkContext(workspaces: [
            self.makeCloudWorkspaceSummary(workspaceId: "workspace-1")
        ])

        XCTAssertEqual(
            makeCloudPostAuthFailurePresentation(
                operation: .completeLink(
                    linkContext: linkContext,
                    selection: .existing(workspaceId: "workspace-1")
                ),
                cloudState: .linked
            ),
            CloudPostAuthFailurePresentation(
                title: "Signed in, but initial sync failed.",
                retryAction: .syncOnly
            )
        )
    }

    func testMakeCloudPostAuthFailurePresentationKeepsSyncRetryForSyncOnlyOperation() {
        XCTAssertEqual(
            makeCloudPostAuthFailurePresentation(
                operation: .syncOnly,
                cloudState: .linked
            ),
            CloudPostAuthFailurePresentation(
                title: "Signed in, but initial sync failed.",
                retryAction: .syncOnly
            )
        )
    }

    func testMakeCloudWorkspaceSelectionItemsPreservesWorkspaceOrderAndAppendsCreateAction() {
        let workspaces = [
            CloudWorkspaceSummary(
                workspaceId: "workspace-2",
                name: "Spanish",
                createdAt: "2026-03-12T09:00:00.000Z",
                isSelected: false
            ),
            CloudWorkspaceSummary(
                workspaceId: "workspace-1",
                name: "Personal",
                createdAt: "2026-03-12T08:00:00.000Z",
                isSelected: true
            )
        ]

        let items = makeCloudWorkspaceSelectionItems(
            workspaces: workspaces,
            localWorkspaceName: "Local deck"
        )

        XCTAssertEqual(items.map(\.id), ["workspace-2", "workspace-1", "create-new-workspace"])
        XCTAssertEqual(items.map(\.selection), [
            .existing(workspaceId: "workspace-2"),
            .existing(workspaceId: "workspace-1"),
            .createNew
        ])
        XCTAssertEqual(items.last?.title, "Create new workspace from \"Local deck\"")
    }

    func testMakeCloudWorkspaceSelectionItemsMarksSelectedWorkspaceIndicatorOnlyForSelectedWorkspace() {
        let workspaces = [
            CloudWorkspaceSummary(
                workspaceId: "workspace-1",
                name: "Personal",
                createdAt: "2026-03-12T08:00:00.000Z",
                isSelected: true
            ),
            CloudWorkspaceSummary(
                workspaceId: "workspace-2",
                name: "Work",
                createdAt: "2026-03-12T09:00:00.000Z",
                isSelected: false
            )
        ]

        let items = makeCloudWorkspaceSelectionItems(
            workspaces: workspaces,
            localWorkspaceName: "Local deck"
        )

        XCTAssertEqual(items.map(\.showsSelectedIndicator), [true, false, false])
    }

    func testMakeCreateWorkspaceSelectionTitleFallsBackWhenLocalWorkspaceNameIsMissing() {
        XCTAssertEqual(
            makeCreateWorkspaceSelectionTitle(localWorkspaceName: nil),
            "Create new workspace"
        )
        XCTAssertEqual(
            makeCreateWorkspaceSelectionTitle(localWorkspaceName: ""),
            "Create new workspace"
        )
        XCTAssertEqual(
            makeCreateWorkspaceSelectionTitle(localWorkspaceName: "Inbox"),
            "Create new workspace from \"Inbox\""
        )
    }

    func testMakeIdTokenExpiryTimestampProducesFutureIsoTimestamp() throws {
        let now = try XCTUnwrap(parseIsoTimestamp(value: "2026-03-08T10:00:00.000Z"))

        let expiresAt = makeIdTokenExpiryTimestamp(now: now, expiresInSeconds: 120)
        let parsedDate = try XCTUnwrap(parseIsoTimestamp(value: expiresAt))

        XCTAssertEqual(expiresAt, "2026-03-08T10:02:00.000Z")
        XCTAssertEqual(parsedDate.timeIntervalSince(now), 120, accuracy: 0.001)
    }

    func testShouldRefreshCloudIdTokenReturnsFalseForFarFutureExpiry() {
        XCTAssertFalse(
            shouldRefreshCloudIdToken(
                idTokenExpiresAt: "2026-03-08T10:10:00.000Z",
                now: Date(timeIntervalSince1970: 1_772_930_000)
            )
        )
    }

    func testShouldRefreshCloudIdTokenReturnsTrueForNearExpiry() {
        XCTAssertTrue(
            shouldRefreshCloudIdToken(
                idTokenExpiresAt: "2026-03-08T10:04:59.000Z",
                now: Date(timeIntervalSince1970: 1_772_930_000)
            )
        )
    }

    func testShouldRefreshCloudIdTokenReturnsTrueForInvalidTimestamp() {
        XCTAssertTrue(
            shouldRefreshCloudIdToken(
                idTokenExpiresAt: "not-a-timestamp",
                now: Date(timeIntervalSince1970: 1_772_930_000)
            )
        )
    }

    @MainActor
    func testRunLinkedSyncDropsStaleReviewEventOperationsBeforePush() async throws {
        let (databaseURL, database) = try self.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let cardId = try testFirstActiveCard(database: database).cardId
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )
        try self.updateStoredDeviceId(
            databaseURL: databaseURL,
            deviceId: "replacement-device-id"
        )

        let recorder = CloudSupportRequestRecorder()
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            if url.path.hasSuffix("/sync/push") {
                let bodyData = try XCTUnwrap(request.httpBody)
                let bodyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
                XCTAssertEqual(bodyObject["deviceId"] as? String, "replacement-device-id")
                let operations = try XCTUnwrap(bodyObject["operations"] as? [[String: Any]])
                let entityTypes = operations.compactMap { operation in
                    operation["entityType"] as? String
                }
                recorder.setPushedEntityTypes(entityTypes)

                let response = HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!
                let results = operations.compactMap { operation -> [String: Any]? in
                    guard
                        let operationId = operation["operationId"] as? String,
                        let entityType = operation["entityType"] as? String,
                        let entityId = operation["entityId"] as? String
                    else {
                        return nil
                    }

                    return [
                        "operationId": operationId,
                        "entityType": entityType,
                        "entityId": entityId,
                        "status": "applied",
                        "resultingChangeId": 1
                    ]
                }
                let data = try JSONSerialization.data(withJSONObject: ["operations": results])
                return (response, data)
            }

            XCTAssertTrue(url.path.hasSuffix("/sync/pull"))
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {"changes":[],"nextChangeId":0,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())

        _ = try await service.runLinkedSync(
            linkedSession: CloudLinkedSession(
                userId: "user-id",
                workspaceId: workspaceId,
                email: "user@example.com",
                configurationMode: .official,
                apiBaseUrl: "https://api.example.com/v1",
                bearerToken: "id-token"
            )
        )

        let requestPaths = recorder.requestPaths
        let pushedEntityTypes = recorder.pushedEntityTypes
        XCTAssertEqual(
            requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/push",
                "/v1/workspaces/\(workspaceId)/sync/pull"
            ]
        )
        XCTAssertEqual(pushedEntityTypes.filter { $0 == "review_event" }.count, 0)
        XCTAssertEqual(pushedEntityTypes.count, 2)
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100).count, 0)
        XCTAssertEqual(try database.loadReviewEvents(workspaceId: workspaceId).count, 1)
    }

    @MainActor
    func testRunLinkedSyncSkipsPushWhenCleanupRemovesEntireOutboxBatch() async throws {
        let (databaseURL, database) = try self.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let cardId = try testFirstActiveCard(database: database).cardId
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        let existingEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        try database.deleteOutboxEntries(operationIds: existingEntries.compactMap { entry in
            entry.operation.entityType == .reviewEvent ? nil : entry.operationId
        })
        try self.updateStoredDeviceId(
            databaseURL: databaseURL,
            deviceId: "replacement-device-id"
        )

        let recorder = CloudSupportRequestRecorder()
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            XCTAssertTrue(url.path.hasSuffix("/sync/pull"))
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {"changes":[],"nextChangeId":0,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())

        _ = try await service.runLinkedSync(
            linkedSession: CloudLinkedSession(
                userId: "user-id",
                workspaceId: workspaceId,
                email: "user@example.com",
                configurationMode: .official,
                apiBaseUrl: "https://api.example.com/v1",
                bearerToken: "id-token"
            )
        )

        let requestPaths = recorder.requestPaths
        XCTAssertEqual(requestPaths, ["/v1/workspaces/\(workspaceId)/sync/pull"])
        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100).count, 0)
        XCTAssertEqual(try database.loadReviewEvents(workspaceId: workspaceId).count, 1)
    }

    func testRunLinkedSyncCanExecuteOffMainActor() async throws {
        let (_, database) = try self.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )

        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/push") {
                let bodyData = try XCTUnwrap(request.httpBody)
                let bodyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
                let operations = try XCTUnwrap(bodyObject["operations"] as? [[String: Any]])
                let results = operations.compactMap { operation -> [String: Any]? in
                    guard
                        let operationId = operation["operationId"] as? String,
                        let entityType = operation["entityType"] as? String,
                        let entityId = operation["entityId"] as? String
                    else {
                        return nil
                    }

                    return [
                        "operationId": operationId,
                        "entityType": entityType,
                        "entityId": entityId,
                        "status": "applied",
                        "resultingChangeId": 1
                    ]
                }

                let data = try JSONSerialization.data(withJSONObject: ["operations": results])
                return (response, data)
            }

            let data = """
            {"changes":[],"nextChangeId":0,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())

        _ = try await Task.detached {
            try await service.runLinkedSync(
                linkedSession: CloudLinkedSession(
                    userId: "user-id",
                    workspaceId: workspaceId,
                    email: "user@example.com",
                    configurationMode: .official,
                    apiBaseUrl: "https://api.example.com/v1",
                    bearerToken: "id-token"
                )
            )
        }.value

        XCTAssertEqual(try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100).count, 0)
    }

    private func makeBundle(infoDictionary: [String: String]) throws -> Bundle {
        let rootUrl = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let bundleUrl = rootUrl.appendingPathExtension("bundle")

        try FileManager.default.createDirectory(at: bundleUrl, withIntermediateDirectories: true)
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: rootUrl)
        }

        let infoPlistUrl = bundleUrl.appendingPathComponent("Info.plist")
        let infoPlistData = try PropertyListSerialization.data(
            fromPropertyList: infoDictionary,
            format: .xml,
            options: 0
        )
        try infoPlistData.write(to: infoPlistUrl)

        return try XCTUnwrap(Bundle(url: bundleUrl))
    }

    private func makeUserDefaults() throws -> UserDefaults {
        let suiteName = "cloud-support-tests-\(UUID().uuidString)"
        let userDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        userDefaults.removePersistentDomain(forName: suiteName)
        self.addTeardownBlock { [suiteName] in
            UserDefaults(suiteName: suiteName)?.removePersistentDomain(forName: suiteName)
        }
        return userDefaults
    }

    private func makeDatabaseWithURL() throws -> (URL, LocalDatabase) {
        let databaseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)
        self.addTeardownBlock {
            try? FileManager.default.removeItem(at: databaseDirectory)
        }

        let databaseURL = databaseDirectory.appendingPathComponent("flashcards.sqlite", isDirectory: false)
        return (databaseURL, try LocalDatabase(databaseURL: databaseURL))
    }

    private func makeCardInput(frontText: String, backText: String) -> CardEditorInput {
        CardEditorInput(
            frontText: frontText,
            backText: backText,
            tags: ["tag-a"],
            effortLevel: .medium
        )
    }

    private func makeCloudWorkspaceSummary(workspaceId: String) -> CloudWorkspaceSummary {
        CloudWorkspaceSummary(
            workspaceId: workspaceId,
            name: "Personal",
            createdAt: "2026-03-12T10:00:00.000Z",
            isSelected: false
        )
    }

    private func makeCloudWorkspaceLinkContext(workspaces: [CloudWorkspaceSummary]) -> CloudWorkspaceLinkContext {
        CloudWorkspaceLinkContext(
            userId: "user-id",
            email: "user@example.com",
            apiBaseUrl: "https://api.example.com/v1",
            credentials: StoredCloudCredentials(
                refreshToken: "refresh-token",
                idToken: "id-token",
                idTokenExpiresAt: "2026-03-12T12:00:00.000Z"
            ),
            workspaces: workspaces
        )
    }

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSupportMockUrlProtocol.self]
        return URLSession(configuration: configuration)
    }

    private func updateStoredDeviceId(databaseURL: URL, deviceId: String) throws {
        let core = try DatabaseCore(databaseURL: databaseURL)
        _ = try core.execute(
            sql: """
            UPDATE app_local_settings
            SET device_id = ?, updated_at = ?
            WHERE settings_id = 1
            """,
            values: [
                .text(deviceId),
                .text(nowIsoTimestamp())
            ]
        )
    }
}

private final class CloudSupportMockUrlProtocol: URLProtocol {
    nonisolated(unsafe) static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = CloudSupportMockUrlProtocol.requestHandler else {
            XCTFail("CloudSupportMockUrlProtocol.requestHandler is not set")
            return
        }

        do {
            let (response, data) = try handler(self.request)
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        } catch {
            self.client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private final class CloudSupportRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storedRequestPaths: [String] = []
    private var storedPushedEntityTypes: [String] = []

    var requestPaths: [String] {
        self.lock.lock()
        defer { self.lock.unlock() }
        return self.storedRequestPaths
    }

    var pushedEntityTypes: [String] {
        self.lock.lock()
        defer { self.lock.unlock() }
        return self.storedPushedEntityTypes
    }

    func appendPath(_ path: String) {
        self.lock.lock()
        self.storedRequestPaths.append(path)
        self.lock.unlock()
    }

    func setPushedEntityTypes(_ entityTypes: [String]) {
        self.lock.lock()
        self.storedPushedEntityTypes = entityTypes
        self.lock.unlock()
    }
}
