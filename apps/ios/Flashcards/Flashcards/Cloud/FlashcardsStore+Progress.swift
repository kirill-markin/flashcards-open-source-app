import Foundation

private struct ProgressRequestRange: Hashable, Sendable {
    let timeZone: String
    let from: String
    let to: String
}

private let recentProgressHistoryDayCount: Int = 140

@MainActor
extension FlashcardsStore {
    func loadRecentProgress() async throws -> UserProgressSeries {
        guard let cloudSettings = self.cloudSettings else {
            throw LocalStoreError.validation("Progress is available only for guest or linked cloud accounts")
        }

        switch cloudSettings.cloudState {
        case .linked, .guest:
            // Progress intentionally stays aligned with the server-backed
            // account-wide series after syncing the current workspace only.
            // Pending review events from inactive local workspaces are eventual
            // consistency data and appear here after that workspace syncs.
            try await self.syncCloudNow(trigger: self.manualCloudSyncTrigger(now: Date()))
        case .disconnected, .linkingReady:
            throw LocalStoreError.validation("Progress is available only for guest or linked cloud accounts")
        }

        guard let activeSession = self.cloudRuntime.activeCloudSession() else {
            throw LocalStoreError.uninitialized("Progress cloud session is unavailable")
        }

        let requestRange = try makeProgressRequestRange(
            now: Date(),
            timeZone: .current,
            dayCount: recentProgressHistoryDayCount
        )

        let cloudSyncService = try requireCloudSyncService(cloudSyncService: self.dependencies.cloudSyncService)
        let serverSeries = try await cloudSyncService.loadProgress(
            apiBaseUrl: activeSession.apiBaseUrl,
            authorizationHeader: activeSession.authorizationHeaderValue,
            timeZone: requestRange.timeZone,
            from: requestRange.from,
            to: requestRange.to
        )
        return serverSeries
    }
}

private func makeProgressRequestRange(
    now: Date,
    timeZone: TimeZone,
    dayCount: Int
) throws -> ProgressRequestRange {
    guard dayCount > 0 else {
        throw LocalStoreError.validation("Progress date range must include at least one day")
    }

    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone

    let endDate = calendar.startOfDay(for: now)
    guard let startDate = calendar.date(byAdding: .day, value: -(dayCount - 1), to: endDate) else {
        throw LocalStoreError.validation("Progress date range could not be calculated")
    }

    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd"

    let timeZoneIdentifier = timeZone.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    if timeZoneIdentifier.isEmpty {
        throw LocalStoreError.validation("Current timezone identifier is unavailable")
    }

    return ProgressRequestRange(
        timeZone: timeZoneIdentifier,
        from: formatter.string(from: startDate),
        to: formatter.string(from: endDate)
    )
}
