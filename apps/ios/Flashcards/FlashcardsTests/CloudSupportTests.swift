import Foundation
import XCTest
@testable import Flashcards

final class CloudSupportTests: XCTestCase, @unchecked Sendable {
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
                idTokenExpiresAt: "2026-03-08T00:38:19.000Z",
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

    /// Guards the first bootstrap request contract used by
    /// `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`.
    ///
    /// The backend validator in `apps/backend/src/sync.ts` requires the
    /// `cursor` key to be present, so the first page must send JSON `null`
    /// instead of omitting the field.
    @MainActor
    func testRunLinkedSyncBootstrapRequestIncludesNullCursorOnFirstPage() async throws {
        let (_, database) = try self.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        let recorder = CloudSupportRequestRecorder()
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/bootstrap") {
                let bodyData = try XCTUnwrap(request.httpBody)
                let bodyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
                XCTAssertTrue(bodyObject.keys.contains("cursor"))
                XCTAssertTrue(bodyObject["cursor"] is NSNull)

                let data = """
                {"mode":"pull","entries":[],"nextCursor":null,"hasMore":false,"bootstrapHotChangeId":0,"remoteIsEmpty":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            if url.path.hasSuffix("/sync/pull") {
                let data = """
                {"changes":[],"nextHotChangeId":0,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            XCTAssertTrue(url.path.hasSuffix("/sync/review-history/pull"))
            let data = """
            {"reviewEvents":[],"nextReviewSequenceId":0,"hasMore":false}
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

        XCTAssertEqual(
            recorder.requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
            ]
        )
    }

    /// Guards follow-up bootstrap pages so the runtime sender and backend parser
    /// stay aligned on cursor pagination semantics.
    ///
    /// If you change request encoding in
    /// `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`, update this test
    /// and `apps/backend/src/sync.ts` together.
    @MainActor
    func testRunLinkedSyncBootstrapRequestIncludesCursorOnFollowUpPages() async throws {
        let (_, database) = try self.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        let recorder = CloudSupportRequestRecorder()
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/bootstrap") {
                let bootstrapRequestCount = recorder.requestPaths.filter { $0.hasSuffix("/sync/bootstrap") }.count
                let bodyData = try XCTUnwrap(request.httpBody)
                let bodyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])

                if bootstrapRequestCount == 1 {
                    XCTAssertTrue(bodyObject["cursor"] is NSNull)
                    let data = """
                    {"mode":"pull","entries":[],"nextCursor":"cursor-1","hasMore":true,"bootstrapHotChangeId":7,"remoteIsEmpty":false}
                    """.data(using: .utf8)!
                    return (response, data)
                }

                XCTAssertEqual(bodyObject["cursor"] as? String, "cursor-1")
                let data = """
                {"mode":"pull","entries":[],"nextCursor":null,"hasMore":false,"bootstrapHotChangeId":7,"remoteIsEmpty":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            if url.path.hasSuffix("/sync/pull") {
                let data = """
                {"changes":[],"nextHotChangeId":7,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            XCTAssertTrue(url.path.hasSuffix("/sync/review-history/pull"))
            let data = """
            {"reviewEvents":[],"nextReviewSequenceId":0,"hasMore":false}
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

        XCTAssertEqual(
            recorder.requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
            ]
        )
    }

    /// Guards the `/sync/bootstrap` pull response shape consumed by
    /// `apps/ios/Flashcards/Flashcards/CloudSyncService.swift`.
    @MainActor
    func testRunLinkedSyncBootstrapPullAppliesBackendEntryEnvelopeShape() async throws {
        let (_, database) = try self.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        let recorder = CloudSupportRequestRecorder()
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/bootstrap") {
                let data = """
                {"mode":"pull","entries":[{"entityType":"card","entityId":"remote-card-1","action":"upsert","payload":{"cardId":"remote-card-1","frontText":"Remote front","backText":"Remote back","tags":["remote"],"effortLevel":"medium","dueAt":null,"createdAt":"2026-03-09T10:00:00.000Z","reps":0,"lapses":0,"fsrsCardState":"new","fsrsStepIndex":null,"fsrsStability":null,"fsrsDifficulty":null,"fsrsLastReviewedAt":null,"fsrsScheduledDays":null,"clientUpdatedAt":"2026-03-09T10:00:00.000Z","lastModifiedByDeviceId":"remote-device","lastOperationId":"remote-operation","updatedAt":"2026-03-09T10:00:00.000Z","deletedAt":null}}],"nextCursor":null,"hasMore":false,"bootstrapHotChangeId":9,"remoteIsEmpty":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            if url.path.hasSuffix("/sync/pull") {
                let data = """
                {"changes":[],"nextHotChangeId":9,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            let data = """
            {"reviewEvents":[],"nextReviewSequenceId":0,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())

        _ = try await service.runLinkedSync(linkedSession: self.makeLinkedSession(workspaceId: workspaceId))

        let cards = try testActiveCards(database: database)
        XCTAssertEqual(cards.count, 1)
        XCTAssertEqual(cards[0].cardId, "remote-card-1")
        XCTAssertEqual(cards[0].frontText, "Remote front")
        XCTAssertEqual(try database.loadLastAppliedHotChangeId(workspaceId: workspaceId), 9)
        XCTAssertEqual(
            recorder.requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
            ]
        )
    }

    /// Guards the `/sync/push` wire format used by the iOS outbox sender.
    ///
    /// Keep this test aligned with `apps/backend/src/sync.ts`
    /// `syncPushInputSchema`.
    @MainActor
    func testRunLinkedSyncPushRequestIncludesSharedEnvelopeFields() async throws {
        let (_, database) = try self.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)
        _ = try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )

        let expectedDeviceId = try database.loadBootstrapSnapshot().cloudSettings.deviceId
        let recorder = CloudSupportRequestRecorder()
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/push") {
                let bodyObject = try self.requestBodyObject(request: request)
                XCTAssertEqual(bodyObject["deviceId"] as? String, expectedDeviceId)
                XCTAssertEqual(bodyObject["platform"] as? String, "ios")
                XCTAssertEqual(bodyObject["appVersion"] as? String, "1.0.0")

                let operations = try XCTUnwrap(bodyObject["operations"] as? [[String: Any]])
                XCTAssertEqual(operations.count, 1)
                XCTAssertEqual(operations[0]["entityType"] as? String, "card")
                XCTAssertEqual(operations[0]["action"] as? String, "upsert")
                let payload = try XCTUnwrap(operations[0]["payload"] as? [String: Any])
                XCTAssertEqual(payload["frontText"] as? String, "Front")
                XCTAssertEqual(payload["backText"] as? String, "Back")

                let data = try JSONSerialization.data(
                    withJSONObject: [
                        "operations": [
                            [
                                "operationId": try XCTUnwrap(operations[0]["operationId"] as? String),
                                "entityType": "card",
                                "entityId": try XCTUnwrap(operations[0]["entityId"] as? String),
                                "status": "applied",
                                "resultingHotChangeId": 1,
                                "error": NSNull()
                            ]
                        ]
                    ]
                )
                return (response, data)
            }

            if url.path.hasSuffix("/sync/pull") {
                let data = """
                {"changes":[],"nextHotChangeId":1,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            let data = """
            {"reviewEvents":[],"nextReviewSequenceId":0,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())
        try database.setHasHydratedHotState(workspaceId: workspaceId, hasHydratedHotState: true)
        try database.setHasHydratedReviewHistory(workspaceId: workspaceId, hasHydratedReviewHistory: true)

        _ = try await service.runLinkedSync(linkedSession: self.makeLinkedSession(workspaceId: workspaceId))

        XCTAssertEqual(
            recorder.requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/push",
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
            ]
        )
    }

    /// Guards the `/sync/pull` request and response envelopes together.
    @MainActor
    func testRunLinkedSyncPullRequestIncludesHotCursorAndAppliesBackendResponse() async throws {
        let (_, database) = try self.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        let expectedDeviceId = try database.loadBootstrapSnapshot().cloudSettings.deviceId
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/pull") {
                let bodyObject = try self.requestBodyObject(request: request)
                XCTAssertEqual(bodyObject["deviceId"] as? String, expectedDeviceId)
                XCTAssertEqual(bodyObject["platform"] as? String, "ios")
                XCTAssertEqual(bodyObject["afterHotChangeId"] as? Int64, 33)
                XCTAssertEqual(bodyObject["limit"] as? Int, 200)

                let data = """
                {"changes":[{"changeId":34,"entityType":"card","entityId":"remote-card-2","action":"upsert","payload":{"cardId":"remote-card-2","frontText":"Pulled front","backText":"Pulled back","tags":["pulled"],"effortLevel":"medium","dueAt":null,"createdAt":"2026-03-09T10:00:00.000Z","reps":0,"lapses":0,"fsrsCardState":"new","fsrsStepIndex":null,"fsrsStability":null,"fsrsDifficulty":null,"fsrsLastReviewedAt":null,"fsrsScheduledDays":null,"clientUpdatedAt":"2026-03-09T10:00:00.000Z","lastModifiedByDeviceId":"remote-device","lastOperationId":"remote-operation","updatedAt":"2026-03-09T10:00:00.000Z","deletedAt":null}}],"nextHotChangeId":34,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            let data = """
            {"reviewEvents":[],"nextReviewSequenceId":0,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())
        try database.setHasHydratedHotState(workspaceId: workspaceId, hasHydratedHotState: true)
        try database.setHasHydratedReviewHistory(workspaceId: workspaceId, hasHydratedReviewHistory: true)
        try database.setLastAppliedHotChangeId(workspaceId: workspaceId, changeId: 33)

        _ = try await service.runLinkedSync(linkedSession: self.makeLinkedSession(workspaceId: workspaceId))

        let cards = try testActiveCards(database: database)
        XCTAssertEqual(cards.count, 1)
        XCTAssertEqual(cards[0].cardId, "remote-card-2")
        XCTAssertEqual(cards[0].frontText, "Pulled front")
        XCTAssertEqual(try database.loadLastAppliedHotChangeId(workspaceId: workspaceId), 34)
    }

    /// Guards the dedicated `/sync/review-history/pull` lane request and response.
    @MainActor
    func testRunLinkedSyncReviewHistoryPullRequestIncludesCursorAndAppliesBackendResponse() async throws {
        let (_, database) = try self.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)
        let savedCard = try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        let existingEntries = try database.loadOutboxEntries(workspaceId: workspaceId, limit: 100)
        try database.deleteOutboxEntries(operationIds: existingEntries.map(\.operationId))

        let expectedDeviceId = try database.loadBootstrapSnapshot().cloudSettings.deviceId
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/pull") {
                let data = """
                {"changes":[],"nextHotChangeId":0,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            let bodyObject = try self.requestBodyObject(request: request)
            XCTAssertEqual(bodyObject["deviceId"] as? String, expectedDeviceId)
            XCTAssertEqual(bodyObject["platform"] as? String, "ios")
            XCTAssertEqual(bodyObject["afterReviewSequenceId"] as? Int64, 44)
            XCTAssertEqual(bodyObject["limit"] as? Int, 200)

            let data = """
            {"reviewEvents":[{"reviewEventId":"remote-review-1","workspaceId":"\(workspaceId)","cardId":"\(savedCard.cardId)","deviceId":"remote-device","clientEventId":"remote-client-event","rating":2,"reviewedAtClient":"2026-03-09T10:00:00.000Z","reviewedAtServer":"2026-03-09T10:00:01.000Z"}],"nextReviewSequenceId":45,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())
        try database.setHasHydratedHotState(workspaceId: workspaceId, hasHydratedHotState: true)
        try database.setHasHydratedReviewHistory(workspaceId: workspaceId, hasHydratedReviewHistory: true)
        try database.setLastAppliedReviewSequenceId(workspaceId: workspaceId, reviewSequenceId: 44)

        _ = try await service.runLinkedSync(linkedSession: self.makeLinkedSession(workspaceId: workspaceId))

        let reviewEvents = try database.loadReviewEvents(workspaceId: workspaceId)
        XCTAssertEqual(reviewEvents.count, 1)
        XCTAssertEqual(reviewEvents[0].reviewEventId, "remote-review-1")
        XCTAssertEqual(try database.loadLastAppliedReviewSequenceId(workspaceId: workspaceId), 45)
    }

    /// Guards the empty-remote bootstrap upload contracts for both hot state and
    /// review-history import.
    @MainActor
    func testRunLinkedSyncEmptyRemoteBootstrapEncodesBootstrapPushAndReviewHistoryImport() async throws {
        let (_, database) = try self.makeDatabaseWithURL()
        let workspaceId = try testWorkspaceId(database: database)

        let savedCard = try database.saveCard(
            workspaceId: workspaceId,
            input: self.makeCardInput(frontText: "Front", backText: "Back"),
            cardId: nil
        )
        _ = try database.createDeck(
            workspaceId: workspaceId,
            input: DeckEditorInput(
                name: "Deck",
                filterDefinition: buildDeckFilterDefinition(effortLevels: [], tags: [])
            )
        )
        _ = try database.submitReview(
            workspaceId: workspaceId,
            reviewSubmission: ReviewSubmission(
                cardId: savedCard.cardId,
                rating: .good,
                reviewedAtClient: "2026-03-08T10:00:00.000Z"
            )
        )

        let expectedDeviceId = try database.loadBootstrapSnapshot().cloudSettings.deviceId
        let recorder = CloudSupportRequestRecorder()
        CloudSupportMockUrlProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            recorder.appendPath(url.path)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!

            if url.path.hasSuffix("/sync/bootstrap") {
                let bodyObject = try self.requestBodyObject(request: request)
                let mode = bodyObject["mode"] as? String
                if mode == "pull" {
                    XCTAssertTrue(bodyObject["cursor"] is NSNull)
                    let data = """
                    {"mode":"pull","entries":[],"nextCursor":null,"hasMore":false,"bootstrapHotChangeId":0,"remoteIsEmpty":true}
                    """.data(using: .utf8)!
                    return (response, data)
                }

                XCTAssertEqual(bodyObject["deviceId"] as? String, expectedDeviceId)
                XCTAssertEqual(bodyObject["platform"] as? String, "ios")
                let entries = try XCTUnwrap(bodyObject["entries"] as? [[String: Any]])
                let entityTypes = Set(entries.compactMap { $0["entityType"] as? String })
                XCTAssertEqual(entityTypes, ["card", "deck", "workspace_scheduler_settings"])
                let data = """
                {"mode":"push","appliedEntriesCount":\(entries.count),"bootstrapHotChangeId":12}
                """.data(using: .utf8)!
                return (response, data)
            }

            if url.path.hasSuffix("/sync/review-history/import") {
                let bodyObject = try self.requestBodyObject(request: request)
                XCTAssertEqual(bodyObject["deviceId"] as? String, expectedDeviceId)
                XCTAssertEqual(bodyObject["platform"] as? String, "ios")
                let reviewEvents = try XCTUnwrap(bodyObject["reviewEvents"] as? [[String: Any]])
                XCTAssertEqual(reviewEvents.count, 1)
                XCTAssertEqual(reviewEvents[0]["cardId"] as? String, savedCard.cardId)
                let data = """
                {"importedCount":1,"duplicateCount":0,"nextReviewSequenceId":7}
                """.data(using: .utf8)!
                return (response, data)
            }

            if url.path.hasSuffix("/sync/pull") {
                let data = """
                {"changes":[],"nextHotChangeId":12,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            let data = """
            {"reviewEvents":[],"nextReviewSequenceId":7,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())

        _ = try await service.runLinkedSync(linkedSession: self.makeLinkedSession(workspaceId: workspaceId))

        XCTAssertEqual(
            recorder.requestPaths,
            [
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/bootstrap",
                "/v1/workspaces/\(workspaceId)/sync/review-history/import",
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
            ]
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
                        "resultingHotChangeId": 1,
                        "error": NSNull()
                    ]
                }
                let data = try JSONSerialization.data(withJSONObject: ["operations": results])
                return (response, data)
            }

            if url.path.hasSuffix("/sync/pull") {
                let response = HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!
                let data = """
                {"changes":[],"nextHotChangeId":0,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            XCTAssertTrue(url.path.hasSuffix("/sync/review-history/pull"))
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {"reviewEvents":[],"nextReviewSequenceId":0,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())
        try database.setHasHydratedHotState(workspaceId: workspaceId, hasHydratedHotState: true)
        try database.setHasHydratedReviewHistory(workspaceId: workspaceId, hasHydratedReviewHistory: true)

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
                "/v1/workspaces/\(workspaceId)/sync/pull",
                "/v1/workspaces/\(workspaceId)/sync/review-history/pull"
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

            if url.path.hasSuffix("/sync/pull") {
                let response = HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!
                let data = """
                {"changes":[],"nextHotChangeId":0,"hasMore":false}
                """.data(using: .utf8)!
                return (response, data)
            }

            XCTAssertTrue(url.path.hasSuffix("/sync/review-history/pull"))
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {"reviewEvents":[],"nextReviewSequenceId":0,"hasMore":false}
            """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())
        try database.setHasHydratedHotState(workspaceId: workspaceId, hasHydratedHotState: true)
        try database.setHasHydratedReviewHistory(workspaceId: workspaceId, hasHydratedReviewHistory: true)

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
        XCTAssertEqual(requestPaths, [
            "/v1/workspaces/\(workspaceId)/sync/pull",
            "/v1/workspaces/\(workspaceId)/sync/review-history/pull",
        ])
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
                        "resultingHotChangeId": 1,
                        "error": NSNull()
                    ]
                }

                let data = try JSONSerialization.data(withJSONObject: ["operations": results])
                return (response, data)
            }

            let data = url.path.hasSuffix("/sync/pull")
                ? """
                {"changes":[],"nextHotChangeId":0,"hasMore":false}
                """.data(using: .utf8)!
                : """
                {"reviewEvents":[],"nextReviewSequenceId":0,"hasMore":false}
                """.data(using: .utf8)!
            return (response, data)
        }

        let service = CloudSyncService(database: database, session: self.makeSession())
        try database.setHasHydratedHotState(workspaceId: workspaceId, hasHydratedHotState: true)
        try database.setHasHydratedReviewHistory(workspaceId: workspaceId, hasHydratedReviewHistory: true)

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

    private func makeLinkedSession(workspaceId: String) -> CloudLinkedSession {
        CloudLinkedSession(
            userId: "user-id",
            workspaceId: workspaceId,
            email: "user@example.com",
            configurationMode: .official,
            apiBaseUrl: "https://api.example.com/v1",
            bearerToken: "id-token"
        )
    }

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CloudSupportMockUrlProtocol.self]
        return URLSession(configuration: configuration)
    }

    private func requestBodyObject(request: URLRequest) throws -> [String: Any] {
        let bodyData = try XCTUnwrap(request.httpBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
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
