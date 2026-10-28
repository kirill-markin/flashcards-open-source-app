import Foundation

@MainActor
extension FlashcardsStore {
    func loadReviewPromptCounters(now: Date) throws -> ReviewPromptCounters {
        let database = try requireLocalDatabase(database: self.database)
        let timeZone = TimeZone.current
        let today = try makeStoreReviewCurrentLocalDayRange(
            now: now,
            calendar: makeStoreReviewLocalCalendar(timeZone: timeZone)
        )
        return ReviewPromptCounters(
            totalReviews: try database.loadReviewEventCount(),
            reviewsToday: try database.loadAppWideReviewEventCount(start: today.start, end: today.end),
            reviewDays: try database.loadAppWideReviewDayCount(timeZone: timeZone)
        )
    }

    func captureReviewPromptFailure(error: Error, stage: String) {
        FlashcardsObservability.captureSilentFailure(
            error: error,
            scope: IOSObservationScope(
                feature: .prompts,
                userId: self.cloudSettings?.linkedUserId,
                workspaceId: self.workspace?.workspaceId,
                requestId: nil,
                clientRequestId: nil,
                sessionId: nil,
                runId: nil,
                cloudState: self.cloudSettings?.cloudState,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            ),
            action: "review_prompt_walk",
            stage: stage,
            statusCode: nil,
            backendCode: nil,
            requestId: nil
        )
    }
}
