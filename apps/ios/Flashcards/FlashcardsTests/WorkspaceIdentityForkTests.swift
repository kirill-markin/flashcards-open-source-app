import Foundation
import XCTest
@testable import Flashcards

final class WorkspaceIdentityForkTests: XCTestCase {
    func testWorkspaceIdentityForkUsesStableBackendCompatibleUuidV5Inputs() {
        XCTAssertEqual(
            "6cab5f77-fe75-5774-a07e-965887d8c4bd",
            forkedCardIdForWorkspace(
                sourceWorkspaceId: "workspace-local",
                destinationWorkspaceId: "workspace-linked",
                sourceCardId: "card-source"
            )
        )
        XCTAssertEqual(
            "55b8435f-64d5-5381-8dbb-f5a736616156",
            forkedDeckIdForWorkspace(
                sourceWorkspaceId: "workspace-local",
                destinationWorkspaceId: "workspace-linked",
                sourceDeckId: "deck-source"
            )
        )
        XCTAssertEqual(
            "c2d996b4-d588-5afe-b062-300de5d03dd4",
            forkedReviewEventIdForWorkspace(
                sourceWorkspaceId: "workspace-local",
                destinationWorkspaceId: "workspace-linked",
                sourceReviewEventId: "review-source"
            )
        )
    }
}
