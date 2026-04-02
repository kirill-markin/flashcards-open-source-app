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
        self.refreshReviewNotificationsScheduling(now: Date())
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
                self.refreshReviewNotificationsScheduling(now: now)
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
            self.refreshReviewNotificationsScheduling(now: now)
            return .allowed
        }

        return .blocked
    }

    func markReviewNotificationsAppActive(now: Date) {
        self.userDefaults.set(now.timeIntervalSince1970, forKey: reviewNotificationLastActiveAtUserDefaultsKey)
        self.refreshReviewNotificationsScheduling(now: now)
    }

    func markReviewNotificationsAppBackground(now: Date) {
        guard self.reviewNotificationsSettings.selectedMode == .inactivity else {
            return
        }
        self.refreshReviewNotificationsScheduling(now: now)
    }

    func refreshReviewNotificationsScheduling(now: Date) {
        Task { @MainActor in
            await self.rescheduleReviewNotifications(now: now)
        }
    }

    func handleReviewNotificationTap(request: ReviewNotificationTapRequest, navigation: AppNavigationModel) {
        navigation.selectTab(.review)

        switch request {
        case .fallback(let fallback):
            logReviewNotificationTapFallback(fallback: fallback)
        case .resolved(let payload):
            let workspaceIdAtTap = self.workspace?.workspaceId
            let databaseURL = self.localDatabaseURL
            Task { @MainActor in
                let result = await resolveReviewNotificationTap(
                    snapshot: ReviewNotificationTapValidationSnapshot(
                        databaseURL: databaseURL,
                        activeWorkspaceId: workspaceIdAtTap,
                        payload: payload,
                        now: Date()
                    )
                )

                switch result {
                case .fallback(let fallback):
                    logReviewNotificationTapFallback(fallback: fallback)
                case .resolved(let resolvedPayload, let reviewFilter):
                    guard self.workspace?.workspaceId == resolvedPayload.workspaceId else {
                        return
                    }

                    self.selectReviewFilter(reviewFilter: reviewFilter)
                    if self.effectiveReviewQueue.first?.cardId != resolvedPayload.cardId {
                        self.enqueueTransientBanner(banner: makeReviewQueueUpdatedBanner())
                    }
                }
            }
        }
    }

    func handleSuccessfulReviewNotificationTrigger() {
        let nextCount = self.userDefaults.integer(forKey: reviewNotificationSuccessfulReviewCountUserDefaultsKey) + 1
        self.userDefaults.set(nextCount, forKey: reviewNotificationSuccessfulReviewCountUserDefaultsKey)
        self.refreshReviewNotificationsScheduling(now: Date())
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

    private func rescheduleReviewNotifications(now: Date) async {
        guard let workspaceId = self.workspace?.workspaceId else {
            return
        }

        let center = UNUserNotificationCenter.current()
        let existingPayloads = loadScheduledReviewNotifications(
            userDefaults: self.userDefaults,
            decoder: self.decoder,
            workspaceId: workspaceId
        )
        center.removePendingNotificationRequests(
            withIdentifiers: makeReviewNotificationRequestIdentifiers(
                workspaceId: workspaceId,
                scheduledPayloads: existingPayloads
            )
        )

        guard self.reviewNotificationsSettings.isEnabled else {
            self.persistScheduledReviewNotifications(payloads: [])
            return
        }
        guard await resolveReviewNotificationPermissionStatus() == .allowed else {
            self.persistScheduledReviewNotifications(payloads: [])
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

        let mode = self.reviewNotificationsSettings.selectedMode
        for payload in payloads {
            let content = UNMutableNotificationContent()
            content.title = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Flashcards"
            content.body = payload.frontText
            content.sound = .default
            content.userInfo = buildReviewNotificationUserInfo(
                payload: payload,
                kind: mode
            )

            let interval = max(1, TimeInterval(payload.scheduledAtMillis) / 1000 - now.timeIntervalSince1970)
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
            let request = UNNotificationRequest(
                identifier: payload.requestId,
                content: content,
                trigger: trigger
            )
            try? await center.add(request)
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

func makeReviewQueueUpdatedBanner() -> TransientBanner {
    TransientBanner(
        id: UUID().uuidString.lowercased(),
        message: reviewQueueUpdatedBannerMessage,
        kind: .reviewUpdatedOnAnotherDevice,
        dismissDelayNanoseconds: transientBannerDefaultDismissDelayNanoseconds
    )
}
