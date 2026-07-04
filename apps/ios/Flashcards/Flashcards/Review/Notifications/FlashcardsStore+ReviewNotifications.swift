import Foundation
import UserNotifications

@MainActor
extension FlashcardsStore {
    func reloadReviewNotificationsSettings() {
        self.reviewNotificationsSettings = loadReviewNotificationsSettings(
            userDefaults: self.userDefaults,
            decoder: self.decoder,
            workspaceId: self.workspace?.workspaceId
        )
    }

    func updateReviewNotificationsSettings(settings: ReviewNotificationsSettings) {
        self.reviewNotificationsSettings = settings
        self.persistReviewNotificationsSettings()
        self.reconcileReviewNotifications(trigger: .settingsChanged, now: Date())
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
        self.reviewNotificationsRescheduleGeneration += 1
        let generation = self.reviewNotificationsRescheduleGeneration
        self.activeReviewNotificationsRescheduleTask?.cancel()
        self.activeReviewNotificationsRescheduleTask = Task { @MainActor in
            await self.rescheduleReviewNotifications(
                trigger: trigger,
                now: now,
                generation: generation
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
        guard let workspaceId = self.workspace?.workspaceId else {
            return
        }

        do {
            let data = try self.encoder.encode(self.reviewNotificationsSettings)
            self.userDefaults.set(data, forKey: makeReviewNotificationsSettingsUserDefaultsKey(workspaceId: workspaceId))
        } catch {
            captureReviewNotificationsSilentFailure(
                error: error,
                action: "review_notifications_settings_save",
                stage: "encode",
                cloudSettings: self.cloudSettings,
                workspaceId: workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
            self.userDefaults.removeObject(forKey: makeReviewNotificationsSettingsUserDefaultsKey(workspaceId: workspaceId))
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

    private func rescheduleReviewNotifications(
        trigger: ReviewNotificationsReconcileTrigger,
        now: Date,
        generation: Int
    ) async {
        guard self.reviewNotificationsRescheduleGeneration == generation else {
            return
        }
        guard Task.isCancelled == false else {
            return
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            return
        }

        let reconcileStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .reviewReminder,
            stage: "review_reconcile",
            phase: .start,
            trigger: trigger.diagnosticValue,
            startedAt: nil,
            authorizationStatus: nil,
            counts: emptyNotificationForegroundOperationCounts(),
            errorSummary: nil
        )
        let center = UNUserNotificationCenter.current()
        let cleanupStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .reviewReminder,
            stage: "review_notification_center_cleanup",
            phase: .start,
            trigger: trigger.diagnosticValue,
            startedAt: nil,
            authorizationStatus: nil,
            counts: emptyNotificationForegroundOperationCounts(),
            errorSummary: nil
        )
        let pendingBeforeCleanupRequestIdentifiers = await pendingAppNotificationRequestIdentifiers(center: center)
        let cleanupPendingBefore = appNotificationPendingRequestBreakdown(
            identifiers: pendingBeforeCleanupRequestIdentifiers
        )
        let pendingRequestIdentifiers = filterReviewNotificationRequestIdentifiers(
            identifiers: pendingBeforeCleanupRequestIdentifiers
        )
        var deliveredBeforeCount: Int?
        if trigger.shouldClearDeliveredReviewNotifications {
            let deliveredReviewReminderStates = await deliveredReviewReminderAttentionStates(center: center)
            deliveredBeforeCount = deliveredReviewReminderStates.count
            self.markReviewReminderAttentionFromDeliveredStates(
                states: deliveredReviewReminderStates,
                workspaceId: workspaceId
            )
            self.reconcileReviewReminderAttentionAfterReviewLogs(now: now)
        }
        if pendingRequestIdentifiers.isEmpty == false {
            center.removePendingNotificationRequests(withIdentifiers: pendingRequestIdentifiers)
        }
        var deliveredRemovedCount: Int?
        if trigger.shouldClearDeliveredReviewNotifications {
            deliveredRemovedCount = await removeDeliveredReviewNotifications(center: center)
        }
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .reviewReminder,
            stage: "review_notification_center_cleanup",
            phase: .success,
            trigger: trigger.diagnosticValue,
            startedAt: cleanupStartedAt,
            authorizationStatus: nil,
            counts: notificationCleanupForegroundOperationCounts(
                pendingBefore: cleanupPendingBefore,
                deliveredBeforeCount: deliveredBeforeCount,
                deliveredRemovedCount: deliveredRemovedCount
            ),
            errorSummary: nil
        )

        guard self.reviewNotificationsSettings.isEnabled else {
            self.persistScheduledReviewNotifications(payloads: [])
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .reviewReminder,
                stage: "review_reconcile_skipped_disabled",
                phase: .success,
                trigger: trigger.diagnosticValue,
                startedAt: reconcileStartedAt,
                authorizationStatus: nil,
                counts: emptyNotificationForegroundOperationCounts(),
                errorSummary: nil
            )
            return
        }
        let permissionStatus = await resolveReviewNotificationPermissionStatus()
        guard permissionStatus == .allowed else {
            self.persistScheduledReviewNotifications(payloads: [])
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .reviewReminder,
                stage: "review_reconcile_skipped_permission",
                phase: .success,
                trigger: trigger.diagnosticValue,
                startedAt: reconcileStartedAt,
                authorizationStatus: permissionStatus,
                counts: emptyNotificationForegroundOperationCounts(),
                errorSummary: nil
            )
            return
        }
        guard self.reviewNotificationsRescheduleGeneration == generation else {
            return
        }
        guard Task.isCancelled == false else {
            return
        }

        let lastActiveAt: Date?
        if let lastActiveTimestamp = self.userDefaults.object(forKey: reviewNotificationLastActiveAtUserDefaultsKey) as? TimeInterval {
            lastActiveAt = Date(timeIntervalSince1970: lastActiveTimestamp)
        } else {
            lastActiveAt = nil
        }
        let snapshot = ReviewNotificationSchedulingSnapshot(
            databaseURL: self.localDatabaseURL,
            workspaceId: workspaceId,
            reviewFilter: self.selectedReviewFilter,
            now: now,
            settings: self.reviewNotificationsSettings,
            lastActiveAt: lastActiveAt,
            pendingRequestLimit: reviewNotificationPendingRequestsLimit(
                strictRemindersSettings: self.strictRemindersSettings
            )
        )

        let loadResult: ScheduledReviewNotificationLoadResult
        let payloadLoadStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .reviewReminder,
            stage: "review_payload_load",
            phase: .start,
            trigger: trigger.diagnosticValue,
            startedAt: nil,
            authorizationStatus: permissionStatus,
            counts: emptyNotificationForegroundOperationCounts(),
            errorSummary: nil
        )
        do {
            loadResult = try await loadScheduledReviewNotificationPayloads(snapshot: snapshot)
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .reviewReminder,
                stage: "review_payload_load",
                phase: .success,
                trigger: trigger.diagnosticValue,
                startedAt: payloadLoadStartedAt,
                authorizationStatus: permissionStatus,
                counts: notificationPlannedForegroundOperationCounts(
                    plannedCount: loadResult.payloads.count
                ),
                errorSummary: nil
            )
        } catch {
            let errorSummary = Flashcards.errorMessage(error: error)
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .reviewReminder,
                stage: "review_payload_load",
                phase: .failure,
                trigger: trigger.diagnosticValue,
                startedAt: payloadLoadStartedAt,
                authorizationStatus: permissionStatus,
                counts: emptyNotificationForegroundOperationCounts(),
                errorSummary: errorSummary
            )
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .reviewReminder,
                stage: "review_reconcile",
                phase: .failure,
                trigger: trigger.diagnosticValue,
                startedAt: reconcileStartedAt,
                authorizationStatus: permissionStatus,
                counts: emptyNotificationForegroundOperationCounts(),
                errorSummary: errorSummary
            )
            FlashcardsObservability.captureWarning(
                .localDataRepair(
                    LocalDataRepairWarning(
                        action: "schedule_failed",
                        scope: IOSObservationScope(
                            feature: .notifications,
                            userId: nil,
                            workspaceId: workspaceId,
                            requestId: nil,
                            clientRequestId: nil,
                            sessionId: nil,
                            runId: nil,
                            cloudState: self.cloudSettings?.cloudState,
                            configurationMode: nil
                        ),
                        workspaceId: workspaceId,
                        cardId: nil,
                        reason: errorSummary,
                        repair: "clear_scheduled_review_notifications"
                    )
                )
            )
            self.persistScheduledReviewNotifications(payloads: [])
            return
        }
        guard self.reviewNotificationsRescheduleGeneration == generation else {
            return
        }
        guard Task.isCancelled == false else {
            return
        }

        let payloads = loadResult.payloads
        let pendingReadStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .reviewReminder,
            stage: "review_pending_read_before",
            phase: .start,
            trigger: trigger.diagnosticValue,
            startedAt: nil,
            authorizationStatus: permissionStatus,
            counts: notificationPlannedForegroundOperationCounts(
                plannedCount: payloads.count
            ),
            errorSummary: nil
        )
        let pendingBeforeRequestIdentifiers: [String] = await pendingAppNotificationRequestIdentifiers(center: center)
        let permissionStatusBeforeAdd: ReviewNotificationPermissionStatus =
            await resolveReviewNotificationPermissionStatus()
        let appStateBeforeAdd: String = currentAppNotificationApplicationStateDiagnosticValue()
        let pendingBeforeBreakdown = appNotificationPendingRequestBreakdown(
            identifiers: pendingBeforeRequestIdentifiers
        )
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .reviewReminder,
            stage: "review_pending_read_before",
            phase: .success,
            trigger: trigger.diagnosticValue,
            startedAt: pendingReadStartedAt,
            authorizationStatus: permissionStatusBeforeAdd,
            counts: notificationPendingBeforeForegroundOperationCounts(
                pendingBefore: pendingBeforeBreakdown,
                plannedCount: payloads.count
            ),
            errorSummary: nil
        )
        var addFailure: Error?
        var attemptedPayloads: [ScheduledReviewNotificationPayload] = []
        var attemptedAddCount = 0

        let addStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .reviewReminder,
            stage: "review_add_requests",
            phase: .start,
            trigger: trigger.diagnosticValue,
            startedAt: nil,
            authorizationStatus: permissionStatusBeforeAdd,
            counts: notificationPendingBeforeForegroundOperationCounts(
                pendingBefore: pendingBeforeBreakdown,
                plannedCount: payloads.count
            ),
            errorSummary: nil
        )
        for payload in payloads {
            guard self.reviewNotificationsRescheduleGeneration == generation else {
                return
            }
            guard Task.isCancelled == false else {
                return
            }
            let addNow = Date()
            guard isFutureNotificationPayload(
                scheduledAtMillis: payload.scheduledAtMillis,
                now: addNow
            ) else {
                continue
            }
            let request = self.makeReviewNotificationRequest(
                payload: payload,
                addNow: addNow
            )
            attemptedPayloads.append(payload)
            do {
                attemptedAddCount += 1
                try await center.add(request)
            } catch {
                addFailure = error
                break
            }
        }
        let addErrorSummary = addFailure.map { error in Flashcards.errorMessage(error: error) }
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .reviewReminder,
            stage: "review_add_requests",
            phase: addFailure == nil ? .success : .failure,
            trigger: trigger.diagnosticValue,
            startedAt: addStartedAt,
            authorizationStatus: permissionStatusBeforeAdd,
            counts: notificationAddForegroundOperationCounts(
                pendingBefore: pendingBeforeBreakdown,
                plannedCount: payloads.count,
                attemptedCount: attemptedAddCount
            ),
            errorSummary: addErrorSummary
        )
        let didLogAddFailureBreadcrumb = addFailure != nil

        guard self.reviewNotificationsRescheduleGeneration == generation else {
            return
        }
        guard Task.isCancelled == false else {
            return
        }

        let readbackNow = Date()
        let expectedPayloads: [ScheduledReviewNotificationPayload] = futureReviewNotificationPayloads(
            payloads: attemptedPayloads,
            now: readbackNow
        )
        let plannedRequestIdentifiers: [String] = expectedPayloads.map(\.requestId)
        let initialReadback: NotificationSchedulingReadbackResult
        let readbackStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .reviewReminder,
            stage: "review_readback",
            phase: .start,
            trigger: trigger.diagnosticValue,
            startedAt: nil,
            authorizationStatus: permissionStatusBeforeAdd,
            counts: notificationAddForegroundOperationCounts(
                pendingBefore: pendingBeforeBreakdown,
                plannedCount: expectedPayloads.count,
                attemptedCount: attemptedAddCount
            ),
            errorSummary: nil
        )
        do {
            initialReadback = try await notificationSchedulingReadback(
                center: center,
                plannedRequestIdentifiers: plannedRequestIdentifiers,
                retryDelayNanoseconds: notificationSchedulingReadbackRetryDelayNanoseconds
            )
        } catch is CancellationError {
            return
        } catch {
            let errorSummary = Flashcards.errorMessage(error: error)
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .reviewReminder,
                stage: "review_readback",
                phase: .failure,
                trigger: trigger.diagnosticValue,
                startedAt: readbackStartedAt,
                authorizationStatus: permissionStatusBeforeAdd,
                counts: notificationAddForegroundOperationCounts(
                    pendingBefore: pendingBeforeBreakdown,
                    plannedCount: expectedPayloads.count,
                    attemptedCount: attemptedAddCount
                ),
                errorSummary: errorSummary
            )
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .reviewReminder,
                stage: "review_reconcile",
                phase: .failure,
                trigger: trigger.diagnosticValue,
                startedAt: reconcileStartedAt,
                authorizationStatus: permissionStatusBeforeAdd,
                counts: notificationReadbackForegroundOperationCounts(
                    pendingBefore: pendingBeforeBreakdown,
                    pendingAfter: nil,
                    deliveredBeforeCount: deliveredBeforeCount,
                    deliveredRemovedCount: deliveredRemovedCount,
                    plannedCount: expectedPayloads.count,
                    attemptedCount: attemptedAddCount,
                    acceptedCount: nil,
                    readbackCompleted: nil,
                    readbackAttemptCount: nil
                ),
                errorSummary: errorSummary
            )
            captureReviewNotificationsSilentFailure(
                error: error,
                action: "review_notifications_delayed_readback",
                stage: "readback",
                cloudSettings: self.cloudSettings,
                workspaceId: workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
            return
        }
        guard self.reviewNotificationsRescheduleGeneration == generation else {
            return
        }
        guard Task.isCancelled == false else {
            return
        }

        var finalReadback: NotificationSchedulingReadbackResult = initialReadback
        var readbackAttemptCount: Int = initialReadback.attemptCount
        if addFailure == nil && initialReadback.isComplete == false {
            let missingPayloads: [ScheduledReviewNotificationPayload] = missingReviewNotificationPayloads(
                payloads: expectedPayloads,
                pendingRequestIdentifiers: initialReadback.pendingRequestIdentifiers
            )
            for payload in missingPayloads {
                guard self.reviewNotificationsRescheduleGeneration == generation else {
                    return
                }
                guard Task.isCancelled == false else {
                    return
                }
                let retryAddNow = Date()
                guard isFutureNotificationPayload(
                    scheduledAtMillis: payload.scheduledAtMillis,
                    now: retryAddNow
                ) else {
                    continue
                }
                let request = self.makeReviewNotificationRequest(
                    payload: payload,
                    addNow: retryAddNow
                )
                do {
                    attemptedAddCount += 1
                    try await center.add(request)
                } catch {
                    addFailure = error
                    break
                }
            }
            guard self.reviewNotificationsRescheduleGeneration == generation else {
                return
            }
            guard Task.isCancelled == false else {
                return
            }
            do {
                finalReadback = try await notificationSchedulingReadback(
                    center: center,
                    plannedRequestIdentifiers: plannedRequestIdentifiers,
                    retryDelayNanoseconds: notificationSchedulingReadbackRetryDelayNanoseconds
                )
                readbackAttemptCount += finalReadback.attemptCount
            } catch is CancellationError {
                return
            } catch {
                let errorSummary = Flashcards.errorMessage(error: error)
                self.addNotificationForegroundOperationBreadcrumb(
                    notificationKind: .reviewReminder,
                    stage: "review_readback",
                    phase: .failure,
                    trigger: trigger.diagnosticValue,
                    startedAt: readbackStartedAt,
                    authorizationStatus: permissionStatusBeforeAdd,
                    counts: notificationReadbackForegroundOperationCounts(
                        pendingBefore: pendingBeforeBreakdown,
                        pendingAfter: appNotificationPendingRequestBreakdown(
                            identifiers: initialReadback.pendingRequestIdentifiers
                        ),
                        deliveredBeforeCount: nil,
                        deliveredRemovedCount: nil,
                        plannedCount: expectedPayloads.count,
                        attemptedCount: attemptedAddCount,
                        acceptedCount: nil,
                        readbackCompleted: initialReadback.isComplete,
                        readbackAttemptCount: readbackAttemptCount
                    ),
                    errorSummary: errorSummary
                )
                self.addNotificationForegroundOperationBreadcrumb(
                    notificationKind: .reviewReminder,
                    stage: "review_reconcile",
                    phase: .failure,
                    trigger: trigger.diagnosticValue,
                    startedAt: reconcileStartedAt,
                    authorizationStatus: permissionStatusBeforeAdd,
                    counts: notificationReadbackForegroundOperationCounts(
                        pendingBefore: pendingBeforeBreakdown,
                        pendingAfter: appNotificationPendingRequestBreakdown(
                            identifiers: initialReadback.pendingRequestIdentifiers
                        ),
                        deliveredBeforeCount: deliveredBeforeCount,
                        deliveredRemovedCount: deliveredRemovedCount,
                        plannedCount: expectedPayloads.count,
                        attemptedCount: attemptedAddCount,
                        acceptedCount: nil,
                        readbackCompleted: initialReadback.isComplete,
                        readbackAttemptCount: readbackAttemptCount
                    ),
                    errorSummary: errorSummary
                )
                captureReviewNotificationsSilentFailure(
                    error: error,
                    action: "review_notifications_delayed_readback",
                    stage: "readback",
                    cloudSettings: self.cloudSettings,
                    workspaceId: workspaceId,
                    configurationMode: try? self.currentCloudServiceConfiguration().mode
                )
                return
            }
            guard self.reviewNotificationsRescheduleGeneration == generation else {
                return
            }
            guard Task.isCancelled == false else {
                return
            }
        }

        let pendingAfterRequestIdentifiers: [String] = finalReadback.pendingRequestIdentifiers
        let permissionStatusAfterReadback: ReviewNotificationPermissionStatus =
            await resolveReviewNotificationPermissionStatus()
        guard self.reviewNotificationsRescheduleGeneration == generation else {
            return
        }
        guard Task.isCancelled == false else {
            return
        }
        let appStateAfterReadback: String = currentAppNotificationApplicationStateDiagnosticValue()
        let acceptedAttemptedPayloads: [ScheduledReviewNotificationPayload] = acceptedReviewNotificationPayloads(
            payloads: attemptedPayloads,
            pendingRequestIdentifiers: pendingAfterRequestIdentifiers
        )
        let acceptedExpectedPayloads: [ScheduledReviewNotificationPayload] = acceptedReviewNotificationPayloads(
            payloads: expectedPayloads,
            pendingRequestIdentifiers: pendingAfterRequestIdentifiers
        )
        let hasReadbackMismatch: Bool = addFailure == nil && finalReadback.isComplete == false
        let delayedReadback: DelayedNotificationSchedulingReadback? = finalReadback.delayedReadback
        let diagnosticPayloads: [ScheduledReviewNotificationPayload]
        if addFailure == nil {
            diagnosticPayloads = expectedPayloads
        } else {
            diagnosticPayloads = attemptedPayloads
        }
        let diagnostics: NotificationSchedulingDiagnostics = makeNotificationSchedulingDiagnostics(
            trigger: trigger.diagnosticValue,
            scheduledAtMillisRange: reviewNotificationScheduledAtMillisRange(payloads: diagnosticPayloads),
            delaySecondsRange: reviewNotificationSchedulingDelaySecondsRange(
                payloads: diagnosticPayloads,
                now: readbackNow
            ),
            pendingBeforeRequestIdentifiers: pendingBeforeRequestIdentifiers,
            pendingAfterRequestIdentifiers: pendingAfterRequestIdentifiers,
            permissionStatusBefore: permissionStatusBeforeAdd,
            permissionStatusAfter: permissionStatusAfterReadback,
            appStateBeforeAdd: appStateBeforeAdd,
            appStateAfterReadback: appStateAfterReadback,
            delayedReadback: delayedReadback
        )
        let readbackMismatchSummary: String? = hasReadbackMismatch
            ? "Notification Center accepted fewer review reminders than planned"
            : nil
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .reviewReminder,
            stage: "review_readback",
            phase: hasReadbackMismatch ? .failure : .success,
            trigger: trigger.diagnosticValue,
            startedAt: readbackStartedAt,
            authorizationStatus: permissionStatusAfterReadback,
            counts: notificationReadbackForegroundOperationCounts(
                pendingBefore: diagnostics.pendingBefore,
                pendingAfter: diagnostics.pendingAfter,
                deliveredBeforeCount: nil,
                deliveredRemovedCount: nil,
                plannedCount: expectedPayloads.count,
                attemptedCount: attemptedAddCount,
                acceptedCount: acceptedExpectedPayloads.count,
                readbackCompleted: finalReadback.isComplete,
                readbackAttemptCount: readbackAttemptCount
            ),
            errorSummary: readbackMismatchSummary
        )
        let reconcileErrorSummary: String? = addFailure.map { error in
            Flashcards.errorMessage(error: error)
        } ?? readbackMismatchSummary
        if let addFailure, didLogAddFailureBreadcrumb == false {
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .reviewReminder,
                stage: "review_add_requests",
                phase: .failure,
                trigger: trigger.diagnosticValue,
                startedAt: nil,
                authorizationStatus: permissionStatusAfterReadback,
                counts: notificationReadbackForegroundOperationCounts(
                    pendingBefore: diagnostics.pendingBefore,
                    pendingAfter: diagnostics.pendingAfter,
                    deliveredBeforeCount: nil,
                    deliveredRemovedCount: nil,
                    plannedCount: payloads.count,
                    attemptedCount: attemptedAddCount,
                    acceptedCount: acceptedAttemptedPayloads.count,
                    readbackCompleted: finalReadback.isComplete,
                    readbackAttemptCount: readbackAttemptCount
                ),
                errorSummary: Flashcards.errorMessage(error: addFailure)
            )
        }
        if let addFailure {
            FlashcardsObservability.captureWarning(
                .notificationSchedulingFailed(
                    makeNotificationSchedulingFailureWarning(
                        action: "review_schedule_add_failed",
                        scope: IOSObservationScope(
                            feature: .notifications,
                            userId: nil,
                            workspaceId: workspaceId,
                            requestId: nil,
                            clientRequestId: nil,
                            sessionId: nil,
                            runId: nil,
                            cloudState: self.cloudSettings?.cloudState,
                            configurationMode: nil
                        ),
                        notificationKind: .reviewReminder,
                        workspaceId: workspaceId,
                        requestId: nil,
                        stage: "add",
                        plannedCount: attemptedPayloads.count,
                        acceptedCount: acceptedAttemptedPayloads.count,
                        diagnostics: diagnostics,
                        error: addFailure,
                        messageSummary: nil
                    )
                )
            )
        } else if hasReadbackMismatch {
            FlashcardsObservability.captureWarning(
                .notificationSchedulingFailed(
                    makeNotificationSchedulingFailureWarning(
                        action: "review_schedule_readback_mismatch",
                        scope: IOSObservationScope(
                            feature: .notifications,
                            userId: nil,
                            workspaceId: workspaceId,
                            requestId: nil,
                            clientRequestId: nil,
                            sessionId: nil,
                            runId: nil,
                            cloudState: self.cloudSettings?.cloudState,
                            configurationMode: nil
                        ),
                        notificationKind: .reviewReminder,
                        workspaceId: workspaceId,
                        requestId: nil,
                        stage: "readback",
                        plannedCount: expectedPayloads.count,
                        acceptedCount: acceptedExpectedPayloads.count,
                        diagnostics: diagnostics,
                        error: nil,
                        messageSummary: readbackMismatchSummary
                    )
                )
            )
        }
        self.persistScheduledReviewNotifications(payloads: acceptedExpectedPayloads)
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .reviewReminder,
            stage: "review_reconcile",
            phase: reconcileErrorSummary == nil ? .success : .failure,
            trigger: trigger.diagnosticValue,
            startedAt: reconcileStartedAt,
            authorizationStatus: permissionStatusAfterReadback,
            counts: notificationReadbackForegroundOperationCounts(
                pendingBefore: diagnostics.pendingBefore,
                pendingAfter: diagnostics.pendingAfter,
                deliveredBeforeCount: deliveredBeforeCount,
                deliveredRemovedCount: deliveredRemovedCount,
                plannedCount: expectedPayloads.count,
                attemptedCount: attemptedAddCount,
                acceptedCount: acceptedExpectedPayloads.count,
                readbackCompleted: finalReadback.isComplete,
                readbackAttemptCount: readbackAttemptCount
            ),
            errorSummary: reconcileErrorSummary
        )
    }

    private func markReviewReminderAttentionFromDeliveredStates(
        states: [ReviewReminderAttentionState],
        workspaceId: String
    ) {
        let currentWorkspaceStates = states.filter { state in
            state.workspaceId == workspaceId
        }
        guard let latestState = currentWorkspaceStates.max(by: { lhs, rhs in
            lhs.deliveredAtMillis < rhs.deliveredAtMillis
        }) else {
            return
        }

        self.markReviewReminderAttention(
            workspaceId: latestState.workspaceId,
            requestId: latestState.requestId,
            deliveredAtMillis: latestState.deliveredAtMillis
        )
    }

    private func persistScheduledReviewNotifications(payloads: [ScheduledReviewNotificationPayload]) {
        guard let workspaceId = self.workspace?.workspaceId else {
            return
        }

        do {
            let data = try self.encoder.encode(payloads)
            self.userDefaults.set(data, forKey: makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: workspaceId))
        } catch {
            captureReviewNotificationsSilentFailure(
                error: error,
                action: "review_notifications_scheduled_payloads_save",
                stage: "encode",
                cloudSettings: self.cloudSettings,
                workspaceId: workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
            self.userDefaults.removeObject(forKey: makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: workspaceId))
        }
    }

    private func makeReviewNotificationRequest(
        payload: ScheduledReviewNotificationPayload,
        addNow: Date
    ) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = appDisplayName()
        content.body = payload.notificationBodyText
        content.sound = .default
        content.userInfo = buildAppNotificationUserInfo(notificationType: .reviewReminder)
        if self.reviewNotificationsSettings.showAppIconBadge {
            content.badge = NSNumber(value: 1)
        }

        let interval = max(1, TimeInterval(payload.scheduledAtMillis) / 1_000 - addNow.timeIntervalSince1970)
        let notificationTrigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
        return UNNotificationRequest(
            identifier: payload.requestId,
            content: content,
            trigger: notificationTrigger
        )
    }
}
