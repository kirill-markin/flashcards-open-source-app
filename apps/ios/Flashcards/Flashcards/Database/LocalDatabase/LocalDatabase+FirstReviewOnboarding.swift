import Foundation

struct FirstReviewOnboardingState {
    let ownerUserId: String?
    let completed: Bool
    let isKnown: Bool
    let pending: Bool
    let generation: String
    let reviewTransitionTokens: [String]
}

extension LocalDatabase {
    func loadFirstReviewOnboarding() throws -> FirstReviewOnboardingState {
        let cloud = try self.workspaceSettingsStore.loadCloudSettings()
        let owner = cloud.linkedUserId
        let ownerValue: SQLiteValue = owner.map(SQLiteValue.text) ?? .null
        let known = cloud.cloudState == .disconnected || cloud.cloudState == .linkingReady
        try self.core.execute(
            sql: """
            INSERT OR IGNORE INTO first_review_onboarding
                (settings_id, owner_user_id, completed, is_known, pending, generation)
            VALUES (1, ?, EXISTS(SELECT 1 FROM review_events), ?, 0, ?)
            """,
            values: [ownerValue, .integer(known ? 1 : 0), .text(UUID().uuidString)]
        )
        let state = try self.readFirstReviewOnboarding()
        if state.ownerUserId != owner {
            // Only the existing guest creation path may bind an anonymous local edit.
            let bindsLocalGuest = state.ownerUserId == nil && cloud.cloudState == .guest
            try self.core.execute(
                sql: """
                UPDATE first_review_onboarding SET owner_user_id = ?,
                    completed = ?, is_known = ?, pending = ?, generation = ?, completion_review_tokens_json = ?
                WHERE settings_id = 1
                """,
                values: [
                    ownerValue, .integer(bindsLocalGuest && state.completed ? 1 : 0),
                    .integer(bindsLocalGuest && state.isKnown ? 1 : 0),
                    .integer(bindsLocalGuest && state.pending ? 1 : 0),
                    .text(bindsLocalGuest ? state.generation : UUID().uuidString),
                    .text(try self.core.encodeJsonString(value: bindsLocalGuest ? state.reviewTransitionTokens : []))
                ]
            )
        }
        return try self.readFirstReviewOnboarding()
    }

    func readFirstReviewOnboardingGeneration() throws -> String {
        try self.readFirstReviewOnboarding().generation
    }

    private func readFirstReviewOnboarding() throws -> FirstReviewOnboardingState {
        let rows = try self.core.query(
            sql: "SELECT owner_user_id, completed, is_known, pending, generation, completion_review_tokens_json FROM first_review_onboarding WHERE settings_id = 1",
            values: []
        ) { statement in
            FirstReviewOnboardingState(
                ownerUserId: DatabaseCore.columnOptionalText(statement: statement, index: 0),
                completed: DatabaseCore.columnInt64(statement: statement, index: 1) == 1,
                isKnown: DatabaseCore.columnInt64(statement: statement, index: 2) == 1,
                pending: DatabaseCore.columnInt64(statement: statement, index: 3) == 1,
                generation: DatabaseCore.columnText(statement: statement, index: 4),
                reviewTransitionTokens: try self.core.decoder.decode(
                    [String].self,
                    from: Data(DatabaseCore.columnText(statement: statement, index: 5).utf8)
                )
            )
        }
        guard let state = rows.first else {
            throw LocalStoreError.database("First review onboarding state is unavailable")
        }
        return state
    }

    @discardableResult
    func setFirstReviewOnboardingCompleted(completed: Bool, reviewToken: String?) throws -> Bool {
        let state = try self.loadFirstReviewOnboarding()
        guard state.completed != completed || state.isKnown == false else { return false }
        let tokens = state.completed == false && completed
            ? state.reviewTransitionTokens + (reviewToken.map { [$0] } ?? [])
            : state.reviewTransitionTokens
        try self.core.execute(
            sql: """
            UPDATE first_review_onboarding SET completed = ?, is_known = 1, pending = 1,
                generation = ?, completion_review_tokens_json = ? WHERE settings_id = 1
            """,
            values: [
                .integer(completed ? 1 : 0), .text(UUID().uuidString),
                .text(try self.core.encodeJsonString(value: tokens))
            ]
        )
        return state.completed != completed
    }

    func consumeFirstReviewOnboardingReviewTransition(reviewToken: String) throws -> Bool {
        try self.core.inTransaction {
            let state = try self.readFirstReviewOnboarding()
            guard state.reviewTransitionTokens.contains(reviewToken) else { return false }
            try self.core.execute(
                sql: "UPDATE first_review_onboarding SET completion_review_tokens_json = ? WHERE settings_id = 1",
                values: [.text(try self.core.encodeJsonString(
                    value: state.reviewTransitionTokens.filter { $0 != reviewToken }
                ))]
            )
            return true
        }
    }

    func adoptFirstReviewOnboarding(
        completed: Bool, ownerUserId: String, snapshotGeneration: String?
    ) throws {
        _ = try self.loadFirstReviewOnboarding()
        // An unknown destination may adopt its account snapshot after discarding the departing
        // owner's state. Known values require provenance, even after a local edit was acknowledged.
        try self.core.execute(
            sql: """
            UPDATE first_review_onboarding SET completed = ?, is_known = 1
            WHERE settings_id = 1 AND owner_user_id = ? AND pending = 0
                AND (generation = ? OR is_known = 0)
            """,
            values: [
                .integer(completed ? 1 : 0), .text(ownerUserId),
                snapshotGeneration.map(SQLiteValue.text) ?? .null
            ]
        )
    }

    func acknowledgeFirstReviewOnboarding(state: FirstReviewOnboardingState) throws {
        guard let owner = state.ownerUserId else { return }
        // Reads begun while delivery was pending may still carry the previous server value.
        try self.core.execute(
            sql: """
            UPDATE first_review_onboarding SET pending = 0, generation = ?
            WHERE settings_id = 1 AND owner_user_id = ? AND generation = ? AND pending = 1
            """,
            values: [.text(UUID().uuidString), .text(owner), .text(state.generation)]
        )
    }
}
