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
        if isEnabled == false {
            self.clearAppIconBadge()
        }
    }

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

    /**
     * The pre-prompt closed. `markDismissed` is what separates the two ways in: only "Not now" passes
     * `true`, and it is the person declining. SwiftUI's own binding write-back passes `false` and
     * runs behind whichever button was pressed, so reporting on it would double-count every answer.
     */
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
            Analytics.track(
                .promptAnswered(prompt: .notificationsPrePrompt, outcome: .dismissed),
                screen: .notificationsPrePrompt
            )
            self.restoreSurfaceAfterNotificationPrePrompt()
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
        // Accepting our prompt and being granted the OS permission are separate facts, reported
        // separately: the system dialog that follows can still be denied, and the gap between the two
        // is the whole reason this app asks first.
        Analytics.track(
            .promptAnswered(prompt: .notificationsPrePrompt, outcome: .accepted),
            screen: .notificationsPrePrompt
        )
        self.restoreSurfaceAfterNotificationPrePrompt()
        Task { @MainActor in
            do {
                _ = try await self.requestReviewNotificationPermissionFromSettings(now: Date())
            } catch {
                self.presentTechnicalError(error)
            }
        }
    }

    /// The tab the person is on, not `.review`: the presentation decision is awaited and validates
    /// the review context rather than the visible tab, so the tab can have changed inside that
    /// window. The system dialog that may follow is not one of ours and is no surface at all.
    private func restoreSurfaceAfterNotificationPrePrompt() {
        Analytics.trackScreenViewedOnDismiss(
            of: .notificationsPrePrompt,
            restoring: analyticsSurface(tab: self.currentVisibleTab)
        )
    }

    func requestReviewNotificationPermissionFromSettings(now: Date) async throws -> ReviewNotificationPermissionStatus {
        let currentPermissionStatus = await resolveReviewNotificationPermissionStatus()
        if currentPermissionStatus == .allowed {
            self.reconcileReviewNotifications(trigger: .permissionChanged, now: now)
            self.reconcileStrictReminders(trigger: .permissionChanged, now: now)
            return .allowed
        }
        if currentPermissionStatus == .blocked {
            return .blocked
        }

        self.updateNotificationPermissionPromptState(
            state: NotificationPermissionPromptState(
                hasShownPrePrompt: true,
                hasRequestedSystemPermission: true,
                hasDismissedPrePrompt: self.notificationPermissionPromptState.hasDismissedPrePrompt
            )
        )

        let notificationCenter = UNUserNotificationCenter.current()
        let notificationSettings: UNNotificationSettings
        do {
            _ = try await notificationCenter.requestAuthorization(options: [.alert, .badge, .sound])
            notificationSettings = await notificationCenter.notificationSettings()
        } catch let error as UNError where error.code == .notificationsNotAllowed {
            let observedSettings = await notificationCenter.notificationSettings()
            switch observedSettings.authorizationStatus {
            case .denied, .notDetermined:
                notificationSettings = observedSettings
            default:
                throw error
            }
        }
        let permissionStatus = reviewNotificationPermissionStatus(authorizationStatus: notificationSettings.authorizationStatus)
        switch notificationSettings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            Analytics.trackPermissionPromptAnswered(permission: .notifications, outcome: .granted)
        case .denied:
            Analytics.trackPermissionPromptAnswered(permission: .notifications, outcome: .denied)
        case .notDetermined:
            break
        @unknown default:
            break
        }

        if permissionStatus == .allowed {
            self.reconcileReviewNotifications(trigger: .permissionChanged, now: now)
            self.reconcileStrictReminders(trigger: .permissionChanged, now: now)
        }

        return permissionStatus
    }

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
            self.clearAppIconBadge()
        }
        if trigger == .workspaceChanged || self.reviewNotificationsSettings.isEnabled == false {
            self.clearReviewReminderAttention()
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
    ) {
        self.userDefaults.set(now.timeIntervalSince1970, forKey: reviewNotificationLastActiveAtUserDefaultsKey)
        self.reconcileReviewNotifications(trigger: .reviewRecorded, now: now)
        self.clearReviewReminderAttention(workspaceId: workspaceId)
        self.clearAppIconBadge()
        self.recordSuccessfulStrictReminderReview(reviewedAt: reviewedAt, now: now)
    }

    /// The once-per-install flags block any repeat, so the config cooldown has no showing to count from.
    func isReviewNotificationPrePromptDue(
        settings: ReviewPromptSettings,
        counters: ReviewPromptCounters,
        now: Date
    ) async -> Bool {
        guard reviewPromptConfigAllows(settings: settings, counters: counters, lastShownAt: nil, now: now),
              self.notificationPermissionPromptState.hasShownPrePrompt == false,
              self.notificationPermissionPromptState.hasDismissedPrePrompt == false,
              self.notificationPermissionPromptState.hasRequestedSystemPermission == false else {
            return false
        }

        return await resolveReviewNotificationPermissionStatus() == .notRequested
    }

    func presentReviewNotificationPrePromptIfAllowed(configVersion: String) -> Bool {
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
        // The showing, which `prompt_answered` is the other half of. Without it the answers have no
        // denominator and no acceptance rate can be computed.
        //
        // Reported from the state that presents the alert rather than from the alert, which SwiftUI
        // gives no appearance callback for. The alert is attached to `ReviewView`, and the decision
        // that reaches here is awaited and validates the review context rather than the visible tab,
        // so a person who leaves Review inside that await window can have this row written just
        // before the alert becomes visible to them. It is not guarded on the visible tab, because
        // the prompt does present when they come back and a guard would drop the only denominator
        // its answers have.
        Analytics.trackReviewPromptScreenViewed(.notificationsPrePrompt, reviewPromptConfigVersion: configVersion)

        return true
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
