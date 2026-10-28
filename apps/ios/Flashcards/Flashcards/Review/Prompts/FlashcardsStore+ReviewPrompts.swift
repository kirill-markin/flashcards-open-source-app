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

    /// Clears every local after-review prompt showing; the server-synced paywall history and the cached
    /// remote config stay.
    func clearReviewPromptStateForTests() {
        self.reviewHardReminderLastShownAt = nil
        self.userDefaults.removeObject(forKey: reviewHardReminderLastShownAtUserDefaultsKey)
        self.reviewNotificationPrePromptLastShownAt = nil
        self.userDefaults.removeObject(forKey: reviewNotificationPrePromptLastShownAtUserDefaultsKey)
        self.clearStoreReviewPromptStateForTests()
        self.clearGuestSignInAfterReviewPromptState()
        self.clearAutomaticFeedbackPromptStateForTests()
    }

    /// Adopts and caches a valid remote config; an invalid one is reported and the active config kept.
    func applyRemoteReviewPromptConfig(json: ReviewPromptRemoteConfigJSON) {
        let config: ReviewPromptConfig
        do {
            config = try parseRemoteReviewPromptConfig(json: json)
        } catch {
            captureReviewPromptConfigSilentFailure(error: error, action: "review_prompt_remote_config", stage: "validate")
            return
        }
        guard config != self.activeReviewPromptConfig else {
            return
        }
        do {
            let data = try self.encoder.encode(config)
            self.userDefaults.set(data, forKey: reviewPromptRemoteConfigUserDefaultsKey)
        } catch {
            captureReviewPromptConfigSilentFailure(error: error, action: "review_prompt_config_cache_save", stage: "encode")
            return
        }
        self.activeReviewPromptConfig = config
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
