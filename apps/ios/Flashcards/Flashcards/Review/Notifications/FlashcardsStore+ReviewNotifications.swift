import Foundation
import UserNotifications

@MainActor
extension FlashcardsStore {
    func refreshAppNotificationPresentationOwnership() {
        self.persistAppNotificationPresentationOwnership(
            ownership: AppNotificationPresentationOwnership(
                schemaVersion: appNotificationPresentationOwnershipSchemaVersion,
                isMasterEnabled: self.reviewNotificationsSettings.isEnabled,
                workspaceId: self.workspace?.workspaceId,
                isStrictReminderEnabled: self.strictRemindersSettings.isEnabled,
                strictReminderScope: loadStrictReminderNotificationScope(userDefaults: self.userDefaults)
            )
        )
    }

    func invalidateAppNotificationPresentationOwnership(strictReminderScope: String) {
        self.persistAppNotificationPresentationOwnership(
            ownership: AppNotificationPresentationOwnership(
                schemaVersion: appNotificationPresentationOwnershipSchemaVersion,
                isMasterEnabled: false,
                workspaceId: nil,
                isStrictReminderEnabled: false,
                strictReminderScope: strictReminderScope
            )
        )
    }

    func reloadReviewNotificationsSettings() {
        self.reviewNotificationsSettings = loadReviewNotificationsSettings(
            userDefaults: self.userDefaults,
            encoder: self.encoder,
            decoder: self.decoder,
            workspaceId: self.workspace?.workspaceId
        )
    }

    func updateReviewNotificationsSettings(settings: ReviewNotificationsSettings) {
        self.reviewNotificationsSettings = settings
        self.persistReviewNotificationsSettings()
        self.refreshAppNotificationPresentationOwnership()
        let now = Date()
        if settings.isEnabled == false {
            self.clearReviewReminderAttention()
            self.clearAppIconBadge()
        }
        self.reconcileReviewNotifications(trigger: .settingsChanged, now: now)
        self.reconcileStrictReminders(trigger: .settingsChanged, now: now)
    }

    func updateReviewNotificationsEnabled(isEnabled: Bool) {
        self.updateReviewNotificationsSettings(
            settings: ReviewNotificationsSettings(
                isEnabled: isEnabled,
                selectedMode: self.reviewNotificationsSettings.selectedMode,
                daily: self.reviewNotificationsSettings.daily,
                inactivity: self.reviewNotificationsSettings.inactivity,
                showAppIconBadge: self.reviewNotificationsSettings.showAppIconBadge
            )
        )
    }

    func updateReviewNotificationsMode(selectedMode: ReviewNotificationMode) {
        self.updateReviewNotificationsSettings(
            settings: ReviewNotificationsSettings(
                isEnabled: self.reviewNotificationsSettings.isEnabled,
                selectedMode: selectedMode,
                daily: self.reviewNotificationsSettings.daily,
                inactivity: self.reviewNotificationsSettings.inactivity,
                showAppIconBadge: self.reviewNotificationsSettings.showAppIconBadge
            )
        )
    }

    func updateDailyReviewNotifications(hour: Int, minute: Int) {
        self.updateReviewNotificationsSettings(
            settings: ReviewNotificationsSettings(
                isEnabled: self.reviewNotificationsSettings.isEnabled,
                selectedMode: self.reviewNotificationsSettings.selectedMode,
                daily: DailyReviewNotificationsSettings(hour: hour, minute: minute),
                inactivity: self.reviewNotificationsSettings.inactivity,
                showAppIconBadge: self.reviewNotificationsSettings.showAppIconBadge
            )
        )
    }

    func updateInactivityReviewNotifications(
        windowStartHour: Int,
        windowStartMinute: Int,
        windowEndHour: Int,
        windowEndMinute: Int,
        idleMinutes: Int
    ) {
        self.updateReviewNotificationsSettings(
            settings: ReviewNotificationsSettings(
                isEnabled: self.reviewNotificationsSettings.isEnabled,
                selectedMode: self.reviewNotificationsSettings.selectedMode,
                daily: self.reviewNotificationsSettings.daily,
                inactivity: InactivityReviewNotificationsSettings(
                    windowStartHour: windowStartHour,
                    windowStartMinute: windowStartMinute,
                    windowEndHour: windowEndHour,
                    windowEndMinute: windowEndMinute,
                    idleMinutes: idleMinutes
                ),
                showAppIconBadge: self.reviewNotificationsSettings.showAppIconBadge
            )
        )
    }

    func updateReviewNotificationsAppIconBadgeEnabled(isEnabled: Bool) {
        self.updateReviewNotificationsSettings(
            settings: ReviewNotificationsSettings(
                isEnabled: self.reviewNotificationsSettings.isEnabled,
                selectedMode: self.reviewNotificationsSettings.selectedMode,
                daily: self.reviewNotificationsSettings.daily,
                inactivity: self.reviewNotificationsSettings.inactivity,
                showAppIconBadge: isEnabled
            )
        )
        // When the toggle is turned off, drop any badge currently shown on the icon
        // so the user gets immediate feedback rather than waiting for the next reminder.
        if isEnabled == false {
            self.clearAppIconBadge()
        }
    }

    /// Clears the app icon badge. Safe to call from any path; resets to zero unconditionally.
    func clearAppIconBadge() {
        Task { @MainActor in
            try? await UNUserNotificationCenter.current().setBadgeCount(0)
        }
    }

    func markReviewReminderAttention(
        workspaceId: String,
        requestId: String,
        deliveredAtMillis: Int64
    ) {
        let state = makeReviewReminderAttentionState(
            workspaceId: workspaceId,
            requestId: requestId,
            deliveredAtMillis: deliveredAtMillis
        )
        self.reviewReminderAttentionState = state
        saveReviewReminderAttentionState(
            state: state,
            userDefaults: self.userDefaults,
            encoder: self.encoder
        )
    }

    func clearReviewReminderAttention(workspaceId: String) {
        guard self.reviewReminderAttentionState?.workspaceId == workspaceId else {
            return
        }

        self.reviewReminderAttentionState = nil
        clearReviewReminderAttentionState(userDefaults: self.userDefaults)
    }

    func clearReviewReminderAttention() {
        self.reviewReminderAttentionState = nil
        clearReviewReminderAttentionState(userDefaults: self.userDefaults)
    }

    func reloadReviewReminderAttentionState() {
        self.reviewReminderAttentionState = loadReviewReminderAttentionState(
            userDefaults: self.userDefaults,
            decoder: self.decoder
        )
    }

    func reconcileReviewReminderAttentionAfterReviewLogs(now _: Date) {
        guard let state = self.reviewReminderAttentionState else {
            return
        }
        guard isReviewReminderAttentionVisible(
            state: state,
            workspaceId: self.workspace?.workspaceId
        ) else {
            return
        }
        guard let database = self.database else {
            return
        }

        do {
            let deliveredAt = Date(timeIntervalSince1970: TimeInterval(state.deliveredAtMillis) / 1_000)
            if try database.hasReviewEvent(workspaceId: state.workspaceId, after: deliveredAt) {
                self.clearReviewReminderAttention(workspaceId: state.workspaceId)
            }
        } catch {
            FlashcardsObservability.captureWarning(
                .localDataRepair(
                    LocalDataRepairWarning(
                        action: "review_reminder_attention_reconcile_failed",
                        scope: IOSObservationScope(
                            feature: .notifications,
                            userId: nil,
                            workspaceId: state.workspaceId,
                            requestId: nil,
                            clientRequestId: nil,
                            sessionId: nil,
                            runId: nil,
                            cloudState: self.cloudSettings?.cloudState,
                            configurationMode: nil
                        ),
                        workspaceId: state.workspaceId,
                        cardId: nil,
                        reason: Flashcards.errorMessage(error: error),
                        repair: "keep_review_reminder_attention_state"
                    )
                )
            )
        }
    }

    func dismissReviewNotificationPrePrompt(markDismissed: Bool) {
        self.isReviewNotificationPrePromptPresented = false
        if markDismissed {
            self.updateNotificationPermissionPromptState(
                state: NotificationPermissionPromptState(
                    hasShownPrePrompt: true,
                    hasRequestedSystemPermission: self.notificationPermissionPromptState.hasRequestedSystemPermission,
                    hasDismissedPrePrompt: true
                )
            )
        }
    }

    func continueReviewNotificationPrePrompt() {
        self.isReviewNotificationPrePromptPresented = false
        self.updateNotificationPermissionPromptState(
            state: NotificationPermissionPromptState(
                hasShownPrePrompt: true,
                hasRequestedSystemPermission: self.notificationPermissionPromptState.hasRequestedSystemPermission,
                hasDismissedPrePrompt: self.notificationPermissionPromptState.hasDismissedPrePrompt
            )
        )
        Task { @MainActor in
            _ = await self.requestReviewNotificationPermissionFromSettings(now: Date())
        }
    }

    /// Requests the top-level system notification permission and then reconciles
    /// reminder delivery. Internal reminder toggles keep their stored values.
    func requestReviewNotificationPermissionFromSettings(now: Date) async -> ReviewNotificationPermissionStatus {
        let currentPermissionStatus = await resolveReviewNotificationPermissionStatus()
        if currentPermissionStatus == .allowed {
            self.reconcileReviewNotifications(trigger: .permissionChanged, now: now)
            self.reconcileStrictReminders(trigger: .permissionChanged, now: now)
            return .allowed
        }
        if currentPermissionStatus == .blocked {
            return .blocked
        }

        let isAllowed = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        self.updateNotificationPermissionPromptState(
            state: NotificationPermissionPromptState(
                hasShownPrePrompt: true,
                hasRequestedSystemPermission: true,
                hasDismissedPrePrompt: self.notificationPermissionPromptState.hasDismissedPrePrompt
            )
        )

        if isAllowed {
            self.reconcileReviewNotifications(trigger: .permissionChanged, now: now)
            self.reconcileStrictReminders(trigger: .permissionChanged, now: now)
            return .allowed
        }

        return .blocked
    }

    /// Reconciles review notifications to the current app state.
    ///
    /// The reconciler is idempotent and safe to call from multiple triggers. It clears
    /// pending review reminders before rescheduling, and it clears already delivered
    /// review reminders when the app becomes active or a review is recorded.
    func reconcileReviewNotifications(trigger: ReviewNotificationsReconcileTrigger, now: Date) {
        let shouldClearDeliveredReviewNotifications = trigger.shouldClearDeliveredReviewNotifications
            || self.reviewNotificationsSettings.isEnabled == false
        self.pendingReviewNotificationsDeliveredCleanup = self.pendingReviewNotificationsDeliveredCleanup
            || shouldClearDeliveredReviewNotifications
        if trigger == .workspaceChanged {
            clearPendingAppNotificationTap(userDefaults: self.userDefaults)
            self.clearReviewReminderAttention()
            self.clearAppIconBadge()
        }
        if trigger == .workspaceChanged || self.reviewNotificationsSettings.isEnabled == false {
            self.pendingReviewNotificationsAttentionClear = true
        }
        self.reviewNotificationsRescheduleGeneration += 1
        let generation = self.reviewNotificationsRescheduleGeneration
        let previousTask = self.activeReviewNotificationsRescheduleTask
        previousTask?.cancel()
        self.activeReviewNotificationsRescheduleTask = Task { @MainActor in
            if let previousTask {
                await previousTask.value
            }
            guard self.reviewNotificationsRescheduleGeneration == generation else {
                return
            }
            guard Task.isCancelled == false else {
                return
            }
            await self.rescheduleReviewNotifications(
                trigger: trigger,
                now: now,
                generation: generation,
                shouldClearDeliveredReviewNotifications: self.pendingReviewNotificationsDeliveredCleanup,
                shouldClearReviewReminderAttention: self.pendingReviewNotificationsAttentionClear
            )
            if self.reviewNotificationsRescheduleGeneration == generation {
                self.activeReviewNotificationsRescheduleTask = nil
            }
        }
    }

    func handleAppNotificationTap(request: AppNotificationTapRequest, navigation: AppNavigationModel) {
        switch request {
        case .fallback(let fallback):
            logAppNotificationTapFallback(fallback: fallback)
        case .openReviewReminder:
            if let fallback = appNotificationTapWorkspaceOwnershipFallback(
                request: request,
                currentWorkspaceId: self.workspace?.workspaceId
            ) {
                logAppNotificationTapFallback(fallback: fallback)
                return
            }
            self.reloadReviewReminderAttentionState()
            navigation.selectTab(.review)
        case .openFilteredReviewReminder(_, let persistedReviewFilter):
            if let fallback = appNotificationTapWorkspaceOwnershipFallback(
                request: request,
                currentWorkspaceId: self.workspace?.workspaceId
            ) {
                logAppNotificationTapFallback(fallback: fallback)
                return
            }
            do {
                self.selectReviewFilter(
                    reviewFilter: try makeReviewFilter(persistedReviewFilter: persistedReviewFilter)
                )
            } catch {
                self.presentTechnicalError(error)
                return
            }
            self.reloadReviewReminderAttentionState()
            navigation.selectTab(.review)
        case .openStrictReminder:
            navigation.selectTab(.review)
        }
    }

    func recordSuccessfulReviewNotificationEffects(
        reviewedAt: Date,
        workspaceId: String,
        now: Date
    ) -> Int {
        let nextCount = self.userDefaults.integer(forKey: reviewNotificationSuccessfulReviewCountUserDefaultsKey) + 1
        self.userDefaults.set(nextCount, forKey: reviewNotificationSuccessfulReviewCountUserDefaultsKey)
        self.userDefaults.set(now.timeIntervalSince1970, forKey: reviewNotificationLastActiveAtUserDefaultsKey)
        self.reconcileReviewNotifications(trigger: .reviewRecorded, now: now)
        self.clearReviewReminderAttention(workspaceId: workspaceId)
        self.clearAppIconBadge()
        self.recordSuccessfulStrictReminderReview(reviewedAt: reviewedAt, now: now)
        return self.loadReviewNotificationPromptReviewCount(persistedReviewCount: nextCount)
    }

    func resolveSuccessfulReviewNotificationPrePromptDecision(reviewCount: Int) async -> Bool {
        defer {
            self.requestGuestSignInAfterReviewPromptReconciliation()
        }

        let permissionStatus = await resolveReviewNotificationPermissionStatus()
        guard permissionStatus == .notRequested else {
            return false
        }
        guard hasEnoughReviewHistoryForNotificationPrompt(reviewCount: reviewCount) else {
            return false
        }
        guard self.notificationPermissionPromptState.hasShownPrePrompt == false else {
            return false
        }
        guard self.notificationPermissionPromptState.hasDismissedPrePrompt == false else {
            return false
        }
        guard self.notificationPermissionPromptState.hasRequestedSystemPermission == false else {
            return false
        }

        return true
    }

    func presentReviewNotificationPrePromptIfAllowed() -> Bool {
        guard self.notificationPermissionPromptState.hasShownPrePrompt == false else {
            return false
        }
        guard self.notificationPermissionPromptState.hasDismissedPrePrompt == false else {
            return false
        }
        guard self.notificationPermissionPromptState.hasRequestedSystemPermission == false else {
            return false
        }

        self.isReviewNotificationPrePromptPresented = true
        self.updateNotificationPermissionPromptState(
            state: NotificationPermissionPromptState(
                hasShownPrePrompt: true,
                hasRequestedSystemPermission: false,
                hasDismissedPrePrompt: false
            )
        )

        return true
    }

    private func loadReviewNotificationPromptReviewCount(persistedReviewCount: Int) -> Int {
        guard let database = self.database else {
            return persistedReviewCount
        }

        do {
            return max(persistedReviewCount, try database.loadReviewEventCount())
        } catch {
            FlashcardsObservability.captureWarning(
                .localDataRepair(
                    LocalDataRepairWarning(
                        action: "review_prompt_count_load_failed",
                        scope: IOSObservationScope(
                            feature: .notifications,
                            userId: nil,
                            workspaceId: self.workspace?.workspaceId,
                            requestId: nil,
                            clientRequestId: nil,
                            sessionId: nil,
                            runId: nil,
                            cloudState: self.cloudSettings?.cloudState,
                            configurationMode: nil
                        ),
                        workspaceId: self.workspace?.workspaceId,
                        cardId: nil,
                        reason: Flashcards.errorMessage(error: error),
                        repair: "use_persisted_review_count"
                    )
                )
            )
            return persistedReviewCount
        }
    }

    private func persistReviewNotificationsSettings() {
        do {
            let data = try self.encoder.encode(self.reviewNotificationsSettings)
            self.userDefaults.set(data, forKey: reviewNotificationsSettingsUserDefaultsKey)
        } catch {
            captureReviewNotificationsSilentFailure(
                error: error,
                action: "review_notifications_settings_save",
                stage: "encode",
                cloudSettings: self.cloudSettings,
                workspaceId: self.workspace?.workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
            self.userDefaults.removeObject(forKey: reviewNotificationsSettingsUserDefaultsKey)
        }
    }

    private func persistAppNotificationPresentationOwnership(
        ownership: AppNotificationPresentationOwnership
    ) {
        do {
            try saveAppNotificationPresentationOwnership(
                ownership: ownership,
                userDefaults: self.userDefaults,
                encoder: self.encoder
            )
        } catch {
            self.userDefaults.removeObject(forKey: appNotificationPresentationOwnershipUserDefaultsKey)
            captureReviewNotificationsSilentFailure(
                error: error,
                action: "app_notification_presentation_ownership_save",
                stage: "encode",
                cloudSettings: self.cloudSettings,
                workspaceId: ownership.workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
        }
    }

    private func updateNotificationPermissionPromptState(state: NotificationPermissionPromptState) {
        self.notificationPermissionPromptState = state

        do {
            let data = try self.encoder.encode(state)
            self.userDefaults.set(data, forKey: reviewNotificationPromptStateUserDefaultsKey)
        } catch {
            captureReviewNotificationsSilentFailure(
                error: error,
                action: "review_notification_permission_prompt_state_save",
                stage: "encode",
                cloudSettings: self.cloudSettings,
                workspaceId: self.workspace?.workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
            self.userDefaults.removeObject(forKey: reviewNotificationPromptStateUserDefaultsKey)
        }
    }

}
