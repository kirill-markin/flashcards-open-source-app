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
                inactivity: self.reviewNotificationsSettings.inactivity
            )
        )
    }

    func updateReviewNotificationsMode(selectedMode: ReviewNotificationMode) {
        self.updateReviewNotificationsSettings(
            settings: ReviewNotificationsSettings(
                isEnabled: self.reviewNotificationsSettings.isEnabled,
                selectedMode: selectedMode,
                daily: self.reviewNotificationsSettings.daily,
                inactivity: self.reviewNotificationsSettings.inactivity
            )
        )
    }

    func updateDailyReviewNotifications(hour: Int, minute: Int) {
        self.updateReviewNotificationsSettings(
            settings: ReviewNotificationsSettings(
                isEnabled: self.reviewNotificationsSettings.isEnabled,
                selectedMode: self.reviewNotificationsSettings.selectedMode,
                daily: DailyReviewNotificationsSettings(hour: hour, minute: minute),
                inactivity: self.reviewNotificationsSettings.inactivity
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
                )
            )
        )
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
            _ = await self.requestReviewNotificationPermissionFromSettings(now: Date(), autoEnableDefaultIfAllowed: true)
        }
    }

    func requestReviewNotificationPermissionFromSettings(
        now: Date,
        autoEnableDefaultIfAllowed: Bool
    ) async -> ReviewNotificationPermissionStatus {
        let currentPermissionStatus = await resolveReviewNotificationPermissionStatus()
        if currentPermissionStatus == .allowed {
            if autoEnableDefaultIfAllowed {
                self.enableDefaultDailyReviewNotificationsIfNeeded()
                self.reconcileReviewNotifications(trigger: .permissionChanged, now: now)
            }
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
            if autoEnableDefaultIfAllowed {
                self.enableDefaultDailyReviewNotificationsIfNeeded()
            }
            self.reconcileReviewNotifications(trigger: .permissionChanged, now: now)
            return .allowed
        }

        return .blocked
    }

    /// Reconciles review notifications to the current app state.
    ///
    /// The reconciler is idempotent and safe to call from multiple triggers. It clears
    /// pending review reminders before rescheduling, and it clears already delivered
    /// review reminders only when the app becomes active.
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
            navigation.selectTab(.review)
        }
    }

    func handleSuccessfulReviewNotificationTrigger() {
        let nextCount = self.userDefaults.integer(forKey: reviewNotificationSuccessfulReviewCountUserDefaultsKey) + 1
        self.userDefaults.set(nextCount, forKey: reviewNotificationSuccessfulReviewCountUserDefaultsKey)
        self.userDefaults.set(Date().timeIntervalSince1970, forKey: reviewNotificationLastActiveAtUserDefaultsKey)
        self.reconcileReviewNotifications(trigger: .reviewRecorded, now: Date())
        Task { @MainActor in
            let permissionStatus = await resolveReviewNotificationPermissionStatus()
            guard permissionStatus == .notRequested else {
                return
            }
            guard nextCount >= reviewNotificationPermissionPromptThreshold else {
                return
            }
            guard self.notificationPermissionPromptState.hasShownPrePrompt == false else {
                return
            }
            guard self.notificationPermissionPromptState.hasDismissedPrePrompt == false else {
                return
            }
            guard self.notificationPermissionPromptState.hasRequestedSystemPermission == false else {
                return
            }

            self.isReviewNotificationPrePromptPresented = true
            self.updateNotificationPermissionPromptState(
                state: NotificationPermissionPromptState(
                    hasShownPrePrompt: true,
                    hasRequestedSystemPermission: false,
                    hasDismissedPrePrompt: false
                )
            )
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
            self.userDefaults.removeObject(forKey: makeReviewNotificationsSettingsUserDefaultsKey(workspaceId: workspaceId))
        }
    }

    private func updateNotificationPermissionPromptState(state: NotificationPermissionPromptState) {
        self.notificationPermissionPromptState = state

        do {
            let data = try self.encoder.encode(state)
            self.userDefaults.set(data, forKey: reviewNotificationPromptStateUserDefaultsKey)
        } catch {
            self.userDefaults.removeObject(forKey: reviewNotificationPromptStateUserDefaultsKey)
        }
    }

    private func enableDefaultDailyReviewNotificationsIfNeeded() {
        let nextSettings = ReviewNotificationsSettings(
            isEnabled: true,
            selectedMode: .daily,
            daily: DailyReviewNotificationsSettings(
                hour: defaultDailyReminderHour,
                minute: defaultDailyReminderMinute
            ),
            inactivity: self.reviewNotificationsSettings.inactivity
        )
        self.reviewNotificationsSettings = nextSettings
        self.persistReviewNotificationsSettings()
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

        let center = UNUserNotificationCenter.current()
        let pendingRequestIdentifiers = await pendingReviewNotificationRequestIdentifiers(center: center)
        if pendingRequestIdentifiers.isEmpty == false {
            center.removePendingNotificationRequests(withIdentifiers: pendingRequestIdentifiers)
        }
        if trigger.shouldClearDeliveredReviewNotifications {
            await removeDeliveredReviewNotifications(center: center)
        }

        guard self.reviewNotificationsSettings.isEnabled else {
            self.persistScheduledReviewNotifications(payloads: [])
            return
        }
        guard await resolveReviewNotificationPermissionStatus() == .allowed else {
            self.persistScheduledReviewNotifications(payloads: [])
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
            lastActiveAt: lastActiveAt
        )

        let payloads: [ScheduledReviewNotificationPayload]
        do {
            payloads = try await loadScheduledReviewNotificationPayloads(snapshot: snapshot)
        } catch {
            logFlashcardsError(
                domain: "ios_notifications",
                action: "schedule_failed",
                metadata: [
                    "workspaceId": workspaceId,
                    "message": Flashcards.errorMessage(error: error)
                ]
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

        for payload in payloads {
            guard self.reviewNotificationsRescheduleGeneration == generation else {
                return
            }
            guard Task.isCancelled == false else {
                return
            }
            let content = UNMutableNotificationContent()
            content.title = appDisplayName()
            content.body = payload.frontText
            content.sound = .default
            content.userInfo = buildReviewNotificationUserInfo(notificationType: .reviewReminder)

            let interval = max(1, TimeInterval(payload.scheduledAtMillis) / 1000 - now.timeIntervalSince1970)
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
            let request = UNNotificationRequest(
                identifier: payload.requestId,
                content: content,
                trigger: trigger
            )
            try? await center.add(request)
        }

        guard self.reviewNotificationsRescheduleGeneration == generation else {
            return
        }
        guard Task.isCancelled == false else {
            return
        }
        self.persistScheduledReviewNotifications(payloads: payloads)
    }

    private func persistScheduledReviewNotifications(payloads: [ScheduledReviewNotificationPayload]) {
        guard let workspaceId = self.workspace?.workspaceId else {
            return
        }

        do {
            let data = try self.encoder.encode(payloads)
            self.userDefaults.set(data, forKey: makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: workspaceId))
        } catch {
            self.userDefaults.removeObject(forKey: makeScheduledReviewNotificationsUserDefaultsKey(workspaceId: workspaceId))
        }
    }
}
