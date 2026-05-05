import Foundation
import XCTest
@testable import Flashcards

class LocalWorkspaceSyncTestCase: XCTestCase {
    private var databaseURL: URL?
    private var database: LocalDatabase?

    override func tearDownWithError() throws {
        if let database {
            try database.close()
        }
        if let databaseURL {
            try? FileManager.default.removeItem(at: databaseURL)
        }
        self.database = nil
        self.databaseURL = nil
        try super.tearDownWithError()
    }

    func makeDatabase() throws -> LocalDatabase {
        let databaseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
            .appendingPathComponent("flashcards.sqlite", isDirectory: false)
        let database = try LocalDatabase(databaseURL: databaseURL)
        self.databaseURL = databaseURL
        self.database = database
        return database
    }

    func makeLinkedSession(workspaceId: String) -> CloudLinkedSession {
        CloudLinkedSession(
            userId: "user-1",
            workspaceId: workspaceId,
            email: "user@example.com",
            configurationMode: .official,
            apiBaseUrl: "https://api.flashcards-open-source-app.com/v1",
            authorization: .bearer("id-token")
        )
    }

    func installFinalBootstrapDirtyOutboxTrigger(database: LocalDatabase, cardId: String) throws {
        let payloadJson: String = """
        {"cardId":"\(cardId)","frontText":"Local final-page dirty question","backText":"Local final-page dirty answer","tags":["local"],"effortLevel":"medium","dueAt":null,"createdAt":"2026-04-01T00:00:00.000Z","reps":0,"lapses":0,"fsrsCardState":"new","fsrsStepIndex":null,"fsrsStability":null,"fsrsDifficulty":null,"fsrsLastReviewedAt":null,"fsrsScheduledDays":null,"deletedAt":null}
        """
        let cardIdLiteral: String = self.sqliteTextLiteral(value: cardId)
        let payloadJsonLiteral: String = self.sqliteTextLiteral(value: payloadJson)

        try database.core.execute(
            sql: """
            CREATE TRIGGER final_bootstrap_dirty_outbox_after_card_insert
            AFTER INSERT ON cards
            WHEN NEW.card_id = \(cardIdLiteral)
            BEGIN
                UPDATE cards
                SET
                    front_text = 'Local final-page dirty question',
                    back_text = 'Local final-page dirty answer',
                    tags_json = '["local"]',
                    client_updated_at = '2030-01-01T00:00:00.000Z',
                    last_modified_by_replica_id = 'local-final-page-race',
                    last_operation_id = 'final-page-race-operation',
                    updated_at = '2030-01-01T00:00:00.000Z'
                WHERE workspace_id = NEW.workspace_id AND card_id = NEW.card_id;

                DELETE FROM card_tags
                WHERE workspace_id = NEW.workspace_id AND card_id = NEW.card_id;

                INSERT INTO card_tags (workspace_id, card_id, tag)
                VALUES (NEW.workspace_id, NEW.card_id, 'local');

                INSERT INTO outbox (
                    operation_id,
                    workspace_id,
                    installation_id,
                    entity_type,
                    entity_id,
                    operation_type,
                    payload_json,
                    client_updated_at,
                    created_at,
                    attempt_count,
                    last_error
                )
                VALUES (
                    'final-page-race-operation',
                    NEW.workspace_id,
                    'test-installation',
                    'card',
                    NEW.card_id,
                    'upsert',
                    \(payloadJsonLiteral),
                    '2030-01-01T00:00:00.000Z',
                    '2030-01-01T00:00:00.000Z',
                    0,
                    NULL
                );
            END
            """,
            values: []
        )
    }

    private func sqliteTextLiteral(value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "''"))'"
    }


    @MainActor
    func makeReviewFilterRecoveryStore(
        database: LocalDatabase,
        userDefaults: UserDefaults,
        credentialStore: CloudCredentialStore,
        cloudSyncService: (any CloudSyncServing)?
    ) -> FlashcardsStore {
        let guestCredentialStore = GuestCloudCredentialStore(
            service: "tests-deck-filter-guest-\(UUID().uuidString.lowercased())",
            bundle: .main,
            userDefaults: userDefaults
        )

        let store = FlashcardsStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder(),
            database: database,
            cloudAuthService: CloudAuthService(),
            cloudSyncService: cloudSyncService,
            credentialStore: credentialStore,
            guestCloudAuthService: GuestCloudAuthService(),
            guestCredentialStore: guestCredentialStore,
            reviewSubmissionOutboxMutationGate: ReviewSubmissionOutboxMutationGate(),
            reviewSubmissionExecutor: nil,
            reviewHeadLoader: { _, _, resolvedReviewFilter, _, _, _ in
                ReviewHeadLoadState(
                    resolvedReviewFilter: resolvedReviewFilter,
                    seedReviewQueue: [],
                    hasMoreCards: false
                )
            },
            reviewCountsLoader: { _, _, _, _ in
                ReviewCounts(dueCount: 0, totalCount: 0)
            },
            reviewQueueChunkLoader: { _, _, _, _, _, _ in
                ReviewQueueChunkLoadState(reviewQueueChunk: [], hasMoreCards: false)
            },
            reviewQueueWindowLoader: { _, _, _, _, _ in
                ReviewQueueWindowLoadState(reviewQueue: [], hasMoreCards: false)
            },
            reviewTimelinePageLoader: defaultReviewTimelinePageLoader,
            initialGlobalErrorMessage: ""
        )
        store.updateCurrentVisibleTab(tab: .cards)
        return store
    }

    func makeManualSyncTrigger(now: Date) -> CloudSyncTrigger {
        CloudSyncTrigger(
            source: .manualSyncNow,
            now: now,
            extendsFastPolling: false,
            allowsVisibleChangeBanner: false,
            surfacesGlobalErrorMessage: false
        )
    }

    func updateSyncState(
        database: LocalDatabase,
        workspaceId: String,
        hotChangeId: Int64,
        reviewSequenceId: Int64
    ) throws {
        _ = try database.core.execute(
            sql: """
            UPDATE sync_state
            SET
                last_applied_hot_change_id = ?,
                last_applied_review_sequence_id = ?,
                has_hydrated_hot_state = 1,
                has_hydrated_review_history = 1,
                updated_at = ?
            WHERE workspace_id = ?
            """,
            values: [
                .integer(hotChangeId),
                .integer(reviewSequenceId),
                .text(nowIsoTimestamp()),
                .text(workspaceId)
            ]
        )
    }

    func loadWorkspaceIds(database: LocalDatabase) throws -> [String] {
        try database.core.query(
            sql: "SELECT workspace_id FROM workspaces ORDER BY created_at ASC",
            values: []
        ) { statement in
            DatabaseCore.columnText(statement: statement, index: 0)
        }
    }

    func loadOutboxCount(database: LocalDatabase) throws -> Int {
        Int(try database.core.scalarInt(
            sql: "SELECT COUNT(*) FROM outbox",
            values: []
        ))
    }

    func loadCardTagCount(database: LocalDatabase, cardId: String) throws -> Int {
        Int(try database.core.scalarInt(
            sql: "SELECT COUNT(*) FROM card_tags WHERE card_id = ?",
            values: [.text(cardId)]
        ))
    }

    func loadOutboxRows(database: LocalDatabase) throws -> [WorkspaceSyncOutboxRow] {
        try database.core.query(
            sql: """
            SELECT workspace_id, entity_type, entity_id, payload_json
            FROM outbox
            ORDER BY created_at ASC, operation_id ASC
            """,
            values: []
        ) { statement in
            WorkspaceSyncOutboxRow(
                workspaceId: DatabaseCore.columnText(statement: statement, index: 0),
                entityType: DatabaseCore.columnText(statement: statement, index: 1),
                entityId: DatabaseCore.columnText(statement: statement, index: 2),
                payloadJson: DatabaseCore.columnText(statement: statement, index: 3)
            )
        }
    }

    func loadSyncState(database: LocalDatabase, workspaceId: String) throws -> WorkspaceSyncStateSnapshot? {
        try database.core.query(
            sql: """
            SELECT
                workspace_id,
                last_applied_hot_change_id,
                last_applied_review_sequence_id,
                has_hydrated_hot_state,
                has_hydrated_review_history
            FROM sync_state
            WHERE workspace_id = ?
            LIMIT 1
            """,
            values: [.text(workspaceId)]
        ) { statement in
            WorkspaceSyncStateSnapshot(
                workspaceId: DatabaseCore.columnText(statement: statement, index: 0),
                lastAppliedHotChangeId: DatabaseCore.columnInt64(statement: statement, index: 1),
                lastAppliedReviewSequenceId: DatabaseCore.columnInt64(statement: statement, index: 2),
                hasHydratedHotState: DatabaseCore.columnInt64(statement: statement, index: 3) == 1,
                hasHydratedReviewHistory: DatabaseCore.columnInt64(statement: statement, index: 4) == 1
            )
        }.first
    }

}

struct WorkspaceSyncStateSnapshot: Equatable {
    let workspaceId: String
    let lastAppliedHotChangeId: Int64
    let lastAppliedReviewSequenceId: Int64
    let hasHydratedHotState: Bool
    let hasHydratedReviewHistory: Bool
}

struct WorkspaceSyncOutboxRow {
    let workspaceId: String
    let entityType: String
    let entityId: String
    let payloadJson: String
}

struct WorkspaceSyncCardOutboxPayload: Decodable {
    let cardId: String
}

struct WorkspaceSyncDeckOutboxPayload: Decodable {
    let deckId: String
}

struct WorkspaceSyncReviewEventOutboxPayload: Decodable {
    let reviewEventId: String
    let cardId: String
}

struct WorkspaceSyncPushRetryRequestBody: Decodable {
    let operations: [WorkspaceSyncPushRetryOperationBody]
}

struct WorkspaceSyncPushRetryOperationBody: Decodable {
    let operationId: String
    let entityType: SyncEntityType
    let entityId: String
}
