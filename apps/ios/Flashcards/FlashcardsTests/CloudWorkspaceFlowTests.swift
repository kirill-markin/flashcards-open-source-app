import Foundation
import XCTest
@testable import Flashcards

final class CloudWorkspaceFlowTests: XCTestCase, @unchecked Sendable {
    override func tearDown() {
        CloudSupportTestSupport.clearRequestHandler()
        super.tearDown()
    }

    @MainActor
    func testRenameWorkspaceCallsRenameEndpointAndDecodesWorkspaceSummary() async throws {
        let (_, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        CloudSupportTestSupport.setRequestHandler { request in
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

        let service = CloudSyncService(database: database, session: CloudSupportTestSupport.makeSession())
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
        let (_, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        CloudSupportTestSupport.setRequestHandler { request in
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

        let service = CloudSyncService(database: database, session: CloudSupportTestSupport.makeSession())
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
        let (_, database) = try CloudSupportTestSupport.makeDatabaseWithURL()
        CloudSupportTestSupport.setRequestHandler { request in
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

        let service = CloudSyncService(database: database, session: CloudSupportTestSupport.makeSession())
        let response = try await service.deleteWorkspace(
            apiBaseUrl: "https://api.example.com/v1",
            bearerToken: "id-token",
            workspaceId: "workspace-1",
            confirmationText: "delete workspace"
        )

        XCTAssertEqual(response.deletedWorkspaceId, "workspace-1")
        XCTAssertEqual(response.workspace.workspaceId, "workspace-2")
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
                CloudSupportTestSupport.makeCloudWorkspaceSummary(workspaceId: "workspace-1")
            ]),
            .autoLink(.existing(workspaceId: "workspace-1"))
        )
    }

    func testMakeCloudWorkspacePostAuthRouteShowsChooserForSeveralWorkspaces() {
        XCTAssertEqual(
            makeCloudWorkspacePostAuthRoute(workspaces: [
                CloudSupportTestSupport.makeCloudWorkspaceSummary(workspaceId: "workspace-1"),
                CloudSupportTestSupport.makeCloudWorkspaceSummary(workspaceId: "workspace-2")
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
        let linkContext = CloudSupportTestSupport.makeCloudWorkspaceLinkContext(workspaces: [
            CloudSupportTestSupport.makeCloudWorkspaceSummary(workspaceId: "workspace-1")
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
        let linkContext = CloudSupportTestSupport.makeCloudWorkspaceLinkContext(workspaces: [
            CloudSupportTestSupport.makeCloudWorkspaceSummary(workspaceId: "workspace-1")
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
}
