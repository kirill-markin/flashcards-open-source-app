import Foundation
import UserNotifications

@MainActor
extension FlashcardsStore {
    func reloadStrictRemindersSettings() {
        self.strictRemindersSettings = loadStrictRemindersSettings(
            userDefaults: self.userDefaults,
            decoder: self.decoder
        )
    }

    func recordSuccessfulStrictReminderReview(reviewedAt: Date, now: Date) {
        persistStrictReminderLastReviewedAt(
            userDefaults: self.userDefaults,
            reviewedAt: reviewedAt
        )
        self.reconcileStrictReminders(trigger: .reviewRecorded, now: now)
    }

    func updateStrictRemindersSettings(settings: StrictRemindersSettings) {
        self.strictRemindersSettings = settings
        self.persistStrictRemindersSettings()
        self.reconcileStrictReminders(trigger: .settingsChanged, now: Date())
    }

    func updateStrictRemindersEnabled(isEnabled: Bool) {
        self.updateStrictRemindersSettings(
            settings: StrictRemindersSettings(isEnabled: isEnabled)
        )
    }

    func reconcileStrictReminders(trigger: StrictRemindersReconcileTrigger, now: Date) {
        let nextRequest = makeStrictRemindersReconcileRequest(trigger: trigger, now: now)
        self.pendingStrictRemindersReconcileRequest = mergeStrictRemindersReconcileRequests(
            pendingRequest: self.pendingStrictRemindersReconcileRequest,
            nextRequest: nextRequest
        )
        guard self.activeStrictRemindersRescheduleTask == nil else {
            return
        }

        self.activeStrictRemindersRescheduleTask = Task { @MainActor in
            await self.drainStrictRemindersReconcileRequests()
        }
    }

    private func persistStrictRemindersSettings() {
        do {
            let data = try self.encoder.encode(self.strictRemindersSettings)
            self.userDefaults.set(data, forKey: strictRemindersSettingsUserDefaultsKey)
        } catch {
            self.userDefaults.removeObject(forKey: strictRemindersSettingsUserDefaultsKey)
        }
    }

    private func persistScheduledStrictReminders(payloads: [ScheduledStrictReminderPayload]) {
        do {
            let data = try self.encoder.encode(payloads)
            self.userDefaults.set(data, forKey: strictReminderScheduledPayloadsUserDefaultsKey)
        } catch {
            self.userDefaults.removeObject(forKey: strictReminderScheduledPayloadsUserDefaultsKey)
        }
    }

    private func drainStrictRemindersReconcileRequests() async {
        guard Task.isCancelled == false else {
            self.pendingStrictRemindersReconcileRequest = nil
            return
        }

        while let request = self.pendingStrictRemindersReconcileRequest {
            guard Task.isCancelled == false else {
                self.pendingStrictRemindersReconcileRequest = nil
                return
            }
            self.pendingStrictRemindersReconcileRequest = nil
            await self.rescheduleStrictReminders(request: request)
        }

        self.activeStrictRemindersRescheduleTask = nil
    }

    private func rescheduleStrictReminders(request: StrictRemindersReconcileRequest) async {
        guard Task.isCancelled == false else {
            return
        }

        let center = UNUserNotificationCenter.current()
        let removalScopes = strictReminderRemovalScopes(
            currentScope: storedStrictReminderNotificationScope(userDefaults: self.userDefaults)
        )
        for removalScope in removalScopes {
            await removePendingStrictReminders(center: center, removalScope: removalScope)
        }
        guard Task.isCancelled == false else {
            return
        }
        if request.shouldClearDeliveredStrictReminders {
            for removalScope in removalScopes {
                await removeDeliveredStrictReminders(center: center, removalScope: removalScope)
            }
        }
        guard Task.isCancelled == false else {
            return
        }

        guard self.strictRemindersSettings.isEnabled else {
            self.persistScheduledStrictReminders(payloads: [])
            return
        }
        guard await resolveReviewNotificationPermissionStatus() == .allowed else {
            self.persistScheduledStrictReminders(payloads: [])
            return
        }

        let payloads: [ScheduledStrictReminderPayload]
        do {
            let calendar = Calendar.autoupdatingCurrent
            let persistedCompletedDayStartMillis = loadStrictReminderCompletedDayStartMillis(
                userDefaults: self.userDefaults,
                now: request.now,
                calendar: calendar
            )
            let importedCompletedDayStartMillis = try await loadStrictReminderImportedCompletedDayStartMillis(
                databaseURL: self.localDatabaseURL,
                now: request.now,
                calendar: calendar
            )
            let completedDayResolution = resolveStrictReminderCompletedDayResolution(
                persistedCompletedDayStartMillis: persistedCompletedDayStartMillis,
                importedCompletedDayStartMillis: importedCompletedDayStartMillis,
                prefersImportedCurrentDayCompletion: self.localDatabaseURL != nil
            )
            if completedDayResolution.shouldPersistImportedCompletion {
                persistStrictReminderLastReviewedAt(
                    userDefaults: self.userDefaults,
                    reviewedAt: request.now
                )
            }
            if completedDayResolution.shouldClearPersistedCompletion {
                clearStrictReminderLastReviewedAt(userDefaults: self.userDefaults)
            }
            payloads = try loadScheduledStrictReminderPayloads(
                snapshot: StrictReminderSchedulingSnapshot(
                    now: request.now,
                    calendar: calendar,
                    completedDayStartMillis: completedDayResolution.completedDayStartMillis
                )
            )
        } catch {
            logFlashcardsError(
                domain: "ios_notifications",
                action: "strict_schedule_failed",
                metadata: [
                    "message": Flashcards.errorMessage(error: error)
                ]
            )
            self.persistScheduledStrictReminders(payloads: [])
            return
        }
        guard Task.isCancelled == false else {
            return
        }

        do {
            let notificationScope = loadStrictReminderNotificationScope(userDefaults: self.userDefaults)
            for payload in payloads {
                guard Task.isCancelled == false else {
                    return
                }
                let content = UNMutableNotificationContent()
                content.title = appDisplayName()
                content.body = payload.notificationBodyText
                content.sound = .default
                content.userInfo = buildStrictReminderNotificationUserInfo(scope: notificationScope)

                let interval = max(1, TimeInterval(payload.scheduledAtMillis) / 1_000 - request.now.timeIntervalSince1970)
                let request = UNNotificationRequest(
                    identifier: payload.requestId,
                    content: content,
                    trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
                )

                do {
                    try await center.add(request)
                } catch {
                    throw LocalStoreError.validation(
                        "Strict reminder request could not be scheduled: requestId=\(payload.requestId), message=\(Flashcards.errorMessage(error: error))"
                    )
                }
            }
        } catch {
            logFlashcardsError(
                domain: "ios_notifications",
                action: "strict_schedule_add_failed",
                metadata: [
                    "message": Flashcards.errorMessage(error: error)
                ]
            )
            self.persistScheduledStrictReminders(payloads: [])
            return
        }
        self.persistScheduledStrictReminders(payloads: payloads)
    }
}
