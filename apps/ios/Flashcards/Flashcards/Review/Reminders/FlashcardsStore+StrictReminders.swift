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
        self.reconcileNotificationsAfterStrictRemindersSettingsChanged(now: Date())
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

    private func reconcileNotificationsAfterStrictRemindersSettingsChanged(now: Date) {
        guard self.strictRemindersSettings.isEnabled else {
            self.reconcileStrictReminders(trigger: .settingsChanged, now: now)
            Task { @MainActor in
                await self.waitForStrictRemindersReconcileToSettle()
                guard Task.isCancelled == false else {
                    return
                }
                guard self.strictRemindersSettings.isEnabled == false else {
                    return
                }
                self.reconcileReviewNotifications(trigger: .settingsChanged, now: now)
            }
            return
        }

        self.reconcileReviewNotifications(trigger: .settingsChanged, now: now)
        self.reconcileStrictReminders(trigger: .settingsChanged, now: now)
    }

    private func waitForStrictRemindersReconcileToSettle() async {
        while let task = self.activeStrictRemindersRescheduleTask {
            await task.value
            guard Task.isCancelled == false else {
                return
            }
        }
    }

    private func waitForReviewNotificationsReconcileToSettle() async {
        while let task = self.activeReviewNotificationsRescheduleTask {
            await task.value
            guard Task.isCancelled == false else {
                return
            }
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
        await self.waitForReviewNotificationsReconcileToSettle()
        guard Task.isCancelled == false else {
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
            FlashcardsObservability.captureWarning(
                .localDataRepair(
                    LocalDataRepairWarning(
                        action: "strict_schedule_failed",
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
                        repair: "clear_scheduled_strict_reminders"
                    )
                )
            )
            self.persistScheduledStrictReminders(payloads: [])
            return
        }
        guard Task.isCancelled == false else {
            return
        }

        let notificationScope = loadStrictReminderNotificationScope(userDefaults: self.userDefaults)
        let pendingBeforeRequestIdentifiers: [String] = await pendingAppNotificationRequestIdentifiers(center: center)
        let permissionStatusBeforeAdd: ReviewNotificationPermissionStatus =
            await resolveReviewNotificationPermissionStatus()
        let appStateBeforeAdd: String = currentAppNotificationApplicationStateDiagnosticValue()
        var addFailure: Error?
        var failedRequestId: String?
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
                addFailure = error
                failedRequestId = payload.requestId
                break
            }
        }
        guard Task.isCancelled == false else {
            return
        }

        let pendingAfterRequestIdentifiers: [String] = await pendingAppNotificationRequestIdentifiers(center: center)
        guard Task.isCancelled == false else {
            return
        }
        let permissionStatusAfterReadback: ReviewNotificationPermissionStatus =
            await resolveReviewNotificationPermissionStatus()
        guard Task.isCancelled == false else {
            return
        }
        let appStateAfterReadback: String = currentAppNotificationApplicationStateDiagnosticValue()
        let acceptedPayloads: [ScheduledStrictReminderPayload] = acceptedStrictReminderPayloads(
            payloads: payloads,
            pendingRequestIdentifiers: pendingAfterRequestIdentifiers
        )
        let hasReadbackMismatch: Bool = addFailure == nil && acceptedPayloads.count != payloads.count
        var delayedReadback: DelayedNotificationSchedulingReadback?
        if hasReadbackMismatch {
            do {
                delayedReadback = try await delayedNotificationSchedulingReadback(
                    center: center,
                    plannedRequestIdentifiers: payloads.map(\.requestId),
                    delayNanoseconds: notificationSchedulingDelayedReadbackNanoseconds
                )
            } catch {
                return
            }
            guard Task.isCancelled == false else {
                return
            }
        }
        let diagnostics: NotificationSchedulingDiagnostics = makeNotificationSchedulingDiagnostics(
            trigger: strictRemindersReconcileTriggerDiagnosticValue(triggers: request.triggers),
            scheduledAtMillisRange: strictReminderScheduledAtMillisRange(payloads: payloads),
            delaySecondsRange: strictReminderSchedulingDelaySecondsRange(
                payloads: payloads,
                now: request.now
            ),
            pendingBeforeRequestIdentifiers: pendingBeforeRequestIdentifiers,
            pendingAfterRequestIdentifiers: pendingAfterRequestIdentifiers,
            permissionStatusBefore: permissionStatusBeforeAdd,
            permissionStatusAfter: permissionStatusAfterReadback,
            appStateBeforeAdd: appStateBeforeAdd,
            appStateAfterReadback: appStateAfterReadback,
            delayedReadback: delayedReadback
        )
        if let addFailure {
            FlashcardsObservability.captureWarning(
                .notificationSchedulingFailed(
                    makeNotificationSchedulingFailureWarning(
                        action: "strict_schedule_add_failed",
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
                        notificationKind: .strictReminder,
                        workspaceId: self.workspace?.workspaceId,
                        requestId: failedRequestId,
                        stage: "add",
                        plannedCount: payloads.count,
                        acceptedCount: acceptedPayloads.count,
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
                        action: "strict_schedule_readback_mismatch",
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
                        notificationKind: .strictReminder,
                        workspaceId: self.workspace?.workspaceId,
                        requestId: nil,
                        stage: "readback",
                        plannedCount: payloads.count,
                        acceptedCount: acceptedPayloads.count,
                        diagnostics: diagnostics,
                        error: nil,
                        messageSummary: "Notification Center accepted fewer strict reminders than planned"
                    )
                )
            )
        }
        self.persistScheduledStrictReminders(payloads: acceptedPayloads)
    }
}
