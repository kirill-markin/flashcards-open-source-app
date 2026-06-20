import Foundation

struct PersistedProgressSummaryServerBase: Codable, Hashable, Sendable {
    let scopeKey: ProgressSummaryScopeKey
    let serverBase: UserProgressSummary
    let storedAt: String
}

struct PersistedProgressSeriesServerBase: Codable, Hashable, Sendable {
    let scopeKey: ProgressScopeKey
    let serverBase: UserProgressSeries
    let storedAt: String
}

struct PersistedReviewScheduleServerBase: Codable, Hashable, Sendable {
    let scopeKey: ReviewScheduleScopeKey
    let serverBase: UserReviewSchedule
    let storedAt: String
    let requiresRefresh: Bool

    enum CodingKeys: String, CodingKey {
        case scopeKey
        case serverBase
        case storedAt
        case requiresRefresh
    }

    init(
        scopeKey: ReviewScheduleScopeKey,
        serverBase: UserReviewSchedule,
        storedAt: String,
        requiresRefresh: Bool
    ) {
        self.scopeKey = scopeKey
        self.serverBase = serverBase
        self.storedAt = storedAt
        self.requiresRefresh = requiresRefresh
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            scopeKey: try container.decode(ReviewScheduleScopeKey.self, forKey: .scopeKey),
            serverBase: try container.decode(UserReviewSchedule.self, forKey: .serverBase),
            storedAt: try container.decode(String.self, forKey: .storedAt),
            requiresRefresh: try container.decodeIfPresent(Bool.self, forKey: .requiresRefresh) ?? false
        )
    }
}

/// Cached compact leaderboard payload exactly as the API returned it, including
/// the server-generated anonymous display names; the client never regenerates them.
struct PersistedProgressLeaderboardServerBase: Codable, Hashable, Sendable {
    let scopeKey: ProgressLeaderboardScopeKey
    let serverBase: UserProgressLeaderboard
    let storedAt: String
}

/// Cached daily streak leaderboard payload exactly as the API returned it.
struct PersistedProgressStreakLeaderboardServerBase: Codable, Hashable, Sendable {
    let scopeKey: ProgressLeaderboardScopeKey
    let serverBase: UserProgressStreakLeaderboard
    let storedAt: String
}

private let progressSummaryServerBaseCacheUserDefaultsKeyPrefix: String = "progress-summary-server-base"
private let progressSeriesServerBaseCacheUserDefaultsKeyPrefix: String = "progress-series-server-base"
private let reviewScheduleServerBaseCacheUserDefaultsKeyPrefix: String = "progress-review-schedule-server-base"
private let legacyProgressLeaderboardServerBaseCacheUserDefaultsKeyPrefix: String = "progress-leaderboard-server-base"
private let progressLeaderboardServerBaseCacheUserDefaultsKeyPrefix: String = "progress-leaderboard-server-base-v2"
private let progressStreakLeaderboardServerBaseCacheUserDefaultsKeyPrefix: String = "progress-streak-leaderboard-server-base-v1"

@MainActor
extension FlashcardsStore {
    func persistProgressSummaryServerBase(serverBase: PersistedProgressSummaryServerBase) throws {
        let data = try self.encoder.encode(serverBase)
        self.userDefaults.set(
            data,
            forKey: progressSummaryServerBaseUserDefaultsKey(scopeKey: serverBase.scopeKey)
        )
    }

    func persistProgressSeriesServerBase(serverBase: PersistedProgressSeriesServerBase) throws {
        let data = try self.encoder.encode(serverBase)
        self.userDefaults.set(
            data,
            forKey: progressSeriesServerBaseUserDefaultsKey(scopeKey: serverBase.scopeKey)
        )
    }

    func persistReviewScheduleServerBase(serverBase: PersistedReviewScheduleServerBase) throws {
        let data = try self.encoder.encode(serverBase)
        self.userDefaults.set(
            data,
            forKey: reviewScheduleServerBaseUserDefaultsKey(scopeKey: serverBase.scopeKey)
        )
    }

    func persistProgressLeaderboardServerBase(serverBase: PersistedProgressLeaderboardServerBase) throws {
        let data = try self.encoder.encode(serverBase)
        self.userDefaults.set(
            data,
            forKey: progressLeaderboardServerBaseUserDefaultsKey(scopeKey: serverBase.scopeKey)
        )
        self.removeLegacyProgressLeaderboardServerBase(scopeKey: serverBase.scopeKey)
    }

    func persistProgressStreakLeaderboardServerBase(
        serverBase: PersistedProgressStreakLeaderboardServerBase
    ) throws {
        let data = try self.encoder.encode(serverBase)
        self.userDefaults.set(
            data,
            forKey: progressStreakLeaderboardServerBaseUserDefaultsKey(scopeKey: serverBase.scopeKey)
        )
    }

    func removePersistedReviewScheduleServerBase(scopeKey: ReviewScheduleScopeKey) {
        self.userDefaults.removeObject(
            forKey: reviewScheduleServerBaseUserDefaultsKey(scopeKey: scopeKey)
        )
    }

    func removePersistedProgressLeaderboardServerBase(scopeKey: ProgressLeaderboardScopeKey) {
        self.userDefaults.removeObject(
            forKey: progressLeaderboardServerBaseUserDefaultsKey(scopeKey: scopeKey)
        )
        self.removeLegacyProgressLeaderboardServerBase(scopeKey: scopeKey)
    }

    func removePersistedProgressStreakLeaderboardServerBase(scopeKey: ProgressLeaderboardScopeKey) {
        self.userDefaults.removeObject(
            forKey: progressStreakLeaderboardServerBaseUserDefaultsKey(scopeKey: scopeKey)
        )
    }

    func loadPersistedProgressSummaryServerBase(
        scopeKey: ProgressSummaryScopeKey
    ) -> PersistedProgressSummaryServerBase? {
        let key = progressSummaryServerBaseUserDefaultsKey(scopeKey: scopeKey)
        guard let data = self.userDefaults.data(forKey: key) else {
            return nil
        }

        do {
            let serverBase = try self.decoder.decode(PersistedProgressSummaryServerBase.self, from: data)
            guard serverBase.scopeKey == scopeKey else {
                self.removeProgressServerBaseCache(
                    key: key,
                    cacheKind: "summary",
                    reason: "scope_mismatch",
                    expectedScopeKey: scopeKey.storageKey,
                    actualScopeKey: serverBase.scopeKey.storageKey,
                    errorMessage: nil
                )
                return nil
            }

            do {
                try validateProgressSummaryMetadata(
                    summary: serverBase.serverBase,
                    scopeKey: scopeKey
                )
            } catch {
                self.removeProgressServerBaseCache(
                    key: key,
                    cacheKind: "summary",
                    reason: "validation_failed",
                    expectedScopeKey: scopeKey.storageKey,
                    actualScopeKey: serverBase.scopeKey.storageKey,
                    errorMessage: Flashcards.errorMessage(error: error)
                )
                return nil
            }

            return serverBase
        } catch {
            self.removeProgressServerBaseCache(
                key: key,
                cacheKind: "summary",
                reason: "decode_failed",
                expectedScopeKey: scopeKey.storageKey,
                actualScopeKey: nil,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            return nil
        }
    }

    func loadPersistedProgressSeriesServerBase(scopeKey: ProgressScopeKey) -> PersistedProgressSeriesServerBase? {
        let key = progressSeriesServerBaseUserDefaultsKey(scopeKey: scopeKey)
        guard let data = self.userDefaults.data(forKey: key) else {
            return nil
        }

        do {
            let serverBase = try self.decoder.decode(PersistedProgressSeriesServerBase.self, from: data)
            guard serverBase.scopeKey == scopeKey else {
                self.removeProgressServerBaseCache(
                    key: key,
                    cacheKind: "series",
                    reason: "scope_mismatch",
                    expectedScopeKey: scopeKey.storageKey,
                    actualScopeKey: serverBase.scopeKey.storageKey,
                    errorMessage: nil
                )
                return nil
            }

            do {
                let timeZone = try progressTimeZone(identifier: scopeKey.timeZone)
                try validateProgressSeries(
                    series: serverBase.serverBase,
                    scopeKey: scopeKey,
                    calendar: makeProgressStoreCalendar(timeZone: timeZone)
                )
            } catch {
                self.removeProgressServerBaseCache(
                    key: key,
                    cacheKind: "series",
                    reason: "validation_failed",
                    expectedScopeKey: scopeKey.storageKey,
                    actualScopeKey: serverBase.scopeKey.storageKey,
                    errorMessage: Flashcards.errorMessage(error: error)
                )
                return nil
            }

            return serverBase
        } catch {
            self.removeProgressServerBaseCache(
                key: key,
                cacheKind: "series",
                reason: "decode_failed",
                expectedScopeKey: scopeKey.storageKey,
                actualScopeKey: nil,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            return nil
        }
    }

    func loadPersistedReviewScheduleServerBase(
        scopeKey: ReviewScheduleScopeKey
    ) -> PersistedReviewScheduleServerBase? {
        let key = reviewScheduleServerBaseUserDefaultsKey(scopeKey: scopeKey)
        guard let data = self.userDefaults.data(forKey: key) else {
            return nil
        }

        do {
            let serverBase = try self.decoder.decode(PersistedReviewScheduleServerBase.self, from: data)
            guard serverBase.scopeKey == scopeKey else {
                self.removeProgressServerBaseCache(
                    key: key,
                    cacheKind: "review_schedule",
                    reason: "scope_mismatch",
                    expectedScopeKey: scopeKey.storageKey,
                    actualScopeKey: serverBase.scopeKey.storageKey,
                    errorMessage: nil
                )
                return nil
            }

            do {
                try validateReviewSchedule(
                    schedule: serverBase.serverBase,
                    scopeKey: scopeKey
                )
            } catch {
                self.removeProgressServerBaseCache(
                    key: key,
                    cacheKind: "review_schedule",
                    reason: "validation_failed",
                    expectedScopeKey: scopeKey.storageKey,
                    actualScopeKey: serverBase.scopeKey.storageKey,
                    errorMessage: Flashcards.errorMessage(error: error)
                )
                return nil
            }

            return serverBase
        } catch {
            self.removeProgressServerBaseCache(
                key: key,
                cacheKind: "review_schedule",
                reason: "decode_failed",
                expectedScopeKey: scopeKey.storageKey,
                actualScopeKey: nil,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            return nil
        }
    }

    func loadPersistedProgressLeaderboardServerBase(
        scopeKey: ProgressLeaderboardScopeKey
    ) -> PersistedProgressLeaderboardServerBase? {
        self.removeLegacyProgressLeaderboardServerBase(scopeKey: scopeKey)

        let key = progressLeaderboardServerBaseUserDefaultsKey(scopeKey: scopeKey)
        guard let data = self.userDefaults.data(forKey: key) else {
            return nil
        }

        do {
            let serverBase = try self.decoder.decode(PersistedProgressLeaderboardServerBase.self, from: data)
            guard serverBase.scopeKey == scopeKey else {
                self.removeProgressServerBaseCache(
                    key: key,
                    cacheKind: "leaderboard",
                    reason: "scope_mismatch",
                    expectedScopeKey: scopeKey.storageKey,
                    actualScopeKey: serverBase.scopeKey.storageKey,
                    errorMessage: nil
                )
                return nil
            }

            do {
                try validateProgressLeaderboard(leaderboard: serverBase.serverBase)
            } catch {
                self.removeProgressServerBaseCache(
                    key: key,
                    cacheKind: "leaderboard",
                    reason: "validation_failed",
                    expectedScopeKey: scopeKey.storageKey,
                    actualScopeKey: serverBase.scopeKey.storageKey,
                    errorMessage: Flashcards.errorMessage(error: error)
                )
                return nil
            }

            return serverBase
        } catch {
            self.removeProgressServerBaseCache(
                key: key,
                cacheKind: "leaderboard",
                reason: "decode_failed",
                expectedScopeKey: scopeKey.storageKey,
                actualScopeKey: nil,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            return nil
        }
    }

    func loadPersistedProgressStreakLeaderboardServerBase(
        scopeKey: ProgressLeaderboardScopeKey
    ) -> PersistedProgressStreakLeaderboardServerBase? {
        let key = progressStreakLeaderboardServerBaseUserDefaultsKey(scopeKey: scopeKey)
        guard let data = self.userDefaults.data(forKey: key) else {
            return nil
        }

        do {
            let serverBase = try self.decoder.decode(PersistedProgressStreakLeaderboardServerBase.self, from: data)
            guard serverBase.scopeKey == scopeKey else {
                self.removeProgressServerBaseCache(
                    key: key,
                    cacheKind: "streak_leaderboard",
                    reason: "scope_mismatch",
                    expectedScopeKey: scopeKey.storageKey,
                    actualScopeKey: serverBase.scopeKey.storageKey,
                    errorMessage: nil
                )
                return nil
            }

            do {
                try validateProgressStreakLeaderboard(leaderboard: serverBase.serverBase)
            } catch {
                self.removeProgressServerBaseCache(
                    key: key,
                    cacheKind: "streak_leaderboard",
                    reason: "validation_failed",
                    expectedScopeKey: scopeKey.storageKey,
                    actualScopeKey: serverBase.scopeKey.storageKey,
                    errorMessage: Flashcards.errorMessage(error: error)
                )
                return nil
            }

            return serverBase
        } catch {
            self.removeProgressServerBaseCache(
                key: key,
                cacheKind: "streak_leaderboard",
                reason: "decode_failed",
                expectedScopeKey: scopeKey.storageKey,
                actualScopeKey: nil,
                errorMessage: Flashcards.errorMessage(error: error)
            )
            return nil
        }
    }

    private func removeLegacyProgressLeaderboardServerBase(scopeKey: ProgressLeaderboardScopeKey) {
        // The unversioned cache predates rankingRows, which the current renderer requires.
        self.userDefaults.removeObject(
            forKey: legacyProgressLeaderboardServerBaseUserDefaultsKey(scopeKey: scopeKey)
        )
    }

    private func removeProgressServerBaseCache(
        key: String,
        cacheKind: String,
        reason: String,
        expectedScopeKey: String,
        actualScopeKey: String?,
        errorMessage: String?
    ) {
        FlashcardsObservability.captureWarning(
            .progressCacheRemoved(
                ProgressCacheRemovedWarning(
                    scope: IOSObservationScope(
                        feature: .progress,
                        userId: nil,
                        workspaceId: nil,
                        requestId: nil,
                        clientRequestId: nil,
                        sessionId: nil,
                        runId: nil,
                        cloudState: nil,
                        configurationMode: nil
                    ),
                    cacheKind: cacheKind,
                    key: key,
                    reason: reason,
                    expectedScopeKey: expectedScopeKey,
                    actualScopeKey: actualScopeKey,
                    errorSummary: errorMessage
                )
            )
        )
        self.userDefaults.removeObject(forKey: key)
    }
}

private func progressSummaryServerBaseUserDefaultsKey(scopeKey: ProgressSummaryScopeKey) -> String {
    "\(progressSummaryServerBaseCacheUserDefaultsKeyPrefix)|\(scopeKey.storageKey)"
}

private func progressSeriesServerBaseUserDefaultsKey(scopeKey: ProgressScopeKey) -> String {
    "\(progressSeriesServerBaseCacheUserDefaultsKeyPrefix)|\(scopeKey.storageKey)"
}

private func reviewScheduleServerBaseUserDefaultsKey(scopeKey: ReviewScheduleScopeKey) -> String {
    "\(reviewScheduleServerBaseCacheUserDefaultsKeyPrefix)|\(scopeKey.storageKey)"
}

private func progressLeaderboardServerBaseUserDefaultsKey(scopeKey: ProgressLeaderboardScopeKey) -> String {
    "\(progressLeaderboardServerBaseCacheUserDefaultsKeyPrefix)|\(scopeKey.storageKey)"
}

private func progressStreakLeaderboardServerBaseUserDefaultsKey(scopeKey: ProgressLeaderboardScopeKey) -> String {
    "\(progressStreakLeaderboardServerBaseCacheUserDefaultsKeyPrefix)|\(scopeKey.storageKey)"
}

private func legacyProgressLeaderboardServerBaseUserDefaultsKey(scopeKey: ProgressLeaderboardScopeKey) -> String {
    "\(legacyProgressLeaderboardServerBaseCacheUserDefaultsKeyPrefix)|\(scopeKey.storageKey)"
}
