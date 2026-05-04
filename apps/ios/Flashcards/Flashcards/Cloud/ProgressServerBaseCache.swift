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
}

private let progressSummaryServerBaseCacheUserDefaultsKeyPrefix: String = "progress-summary-server-base"
private let progressSeriesServerBaseCacheUserDefaultsKeyPrefix: String = "progress-series-server-base"
private let reviewScheduleServerBaseCacheUserDefaultsKeyPrefix: String = "progress-review-schedule-server-base"

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

    func removePersistedReviewScheduleServerBase(scopeKey: ReviewScheduleScopeKey) {
        self.userDefaults.removeObject(
            forKey: reviewScheduleServerBaseUserDefaultsKey(scopeKey: scopeKey)
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

    private func removeProgressServerBaseCache(
        key: String,
        cacheKind: String,
        reason: String,
        expectedScopeKey: String,
        actualScopeKey: String?,
        errorMessage: String?
    ) {
        var metadata: [String: String] = [
            "cacheKind": cacheKind,
            "key": key,
            "reason": reason,
            "expectedScopeKey": expectedScopeKey,
        ]
        if let actualScopeKey {
            metadata["actualScopeKey"] = actualScopeKey
        }
        if let errorMessage {
            metadata["errorMessage"] = errorMessage
        }

        logFlashcardsError(
            domain: "progress",
            action: "server_base_cache_removed",
            metadata: metadata
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
