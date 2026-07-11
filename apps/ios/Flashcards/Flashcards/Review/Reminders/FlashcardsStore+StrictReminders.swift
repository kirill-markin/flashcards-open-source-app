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
        self.refreshAppNotificationPresentationOwnership()
        self.reconcileNotificationsAfterStrictRemindersSettingsChanged(now: Date())
    }

    func updateStrictRemindersEnabled(isEnabled: Bool) {
        self.updateStrictRemindersSettings(
            settings: StrictRemindersSettings(isEnabled: isEnabled)
        )
    }

    @discardableResult
    func cancelStrictRemindersReconciliation() -> Task<Void, Never> {
        self.strictRemindersRescheduleGeneration += 1
        let generation = self.strictRemindersRescheduleGeneration
        let previousTask = self.activeStrictRemindersRescheduleTask
        previousTask?.cancel()
        self.pendingStrictRemindersReconcileRequest = nil
        let replacementTask = Task { @MainActor in
            if let previousTask {
                await previousTask.value
            }
            await self.drainStrictRemindersReconcileRequests(generation: generation)
        }
        self.activeStrictRemindersRescheduleTask = replacementTask
        return replacementTask
    }

    func reconcileStrictReminders(trigger: StrictRemindersReconcileTrigger, now: Date) {
        if trigger == .workspaceChanged {
            rotateStrictReminderNotificationScope(userDefaults: self.userDefaults)
            self.refreshAppNotificationPresentationOwnership()
        }
        if trigger == .workspaceChanged
            || self.reviewNotificationsSettings.isEnabled == false
            || self.strictRemindersSettings.isEnabled == false {
            self.cancelStrictRemindersReconciliation()
        }
        let generation = self.strictRemindersRescheduleGeneration
        let nextRequest = makeStrictRemindersReconcileRequest(
            trigger: trigger,
            now: now,
            shouldClearDeliveredStrictReminders: self.reviewNotificationsSettings.isEnabled == false
                || self.strictRemindersSettings.isEnabled == false
        )
        self.pendingStrictRemindersReconcileRequest = mergeStrictRemindersReconcileRequests(
            pendingRequest: self.pendingStrictRemindersReconcileRequest,
            nextRequest: nextRequest
        )
        guard self.activeStrictRemindersRescheduleTask == nil else {
            return
        }

        self.activeStrictRemindersRescheduleTask = Task { @MainActor in
            await self.drainStrictRemindersReconcileRequests(generation: generation)
        }
    }

    func reconcileAppBackgroundNotifications(now: Date) async {
        self.reconcileReviewNotifications(trigger: .appBackground, now: now)
        self.reconcileStrictReminders(trigger: .appBackground, now: now)
        await self.waitForReviewNotificationsReconcileToSettle()
        guard Task.isCancelled == false else {
            return
        }

        await self.waitForStrictRemindersReconcileToSettle()
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
            captureStrictRemindersSilentFailure(
                error: error,
                action: "strict_reminders_settings_save",
                stage: "encode",
                cloudSettings: self.cloudSettings,
                workspaceId: self.workspace?.workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
            self.userDefaults.removeObject(forKey: strictRemindersSettingsUserDefaultsKey)
        }
    }

    private func persistScheduledStrictReminders(payloads: [ScheduledStrictReminderPayload]) {
        do {
            let data = try self.encoder.encode(payloads)
            self.userDefaults.set(data, forKey: strictReminderScheduledPayloadsUserDefaultsKey)
        } catch {
            captureStrictRemindersSilentFailure(
                error: error,
                action: "strict_reminders_scheduled_payloads_save",
                stage: "encode",
                cloudSettings: self.cloudSettings,
                workspaceId: self.workspace?.workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
            self.userDefaults.removeObject(forKey: strictReminderScheduledPayloadsUserDefaultsKey)
        }
    }

    private func drainStrictRemindersReconcileRequests(generation: Int) async {
        guard self.strictRemindersRescheduleGeneration == generation else {
            return
        }
        guard Task.isCancelled == false else {
            self.pendingStrictRemindersReconcileRequest = nil
            return
        }

        while let request = self.pendingStrictRemindersReconcileRequest {
            guard self.strictRemindersRescheduleGeneration == generation else {
                return
            }
            guard Task.isCancelled == false else {
                self.pendingStrictRemindersReconcileRequest = nil
                return
            }
            self.pendingStrictRemindersReconcileRequest = nil
            await self.rescheduleStrictReminders(request: request)
        }

        if self.strictRemindersRescheduleGeneration == generation {
            self.activeStrictRemindersRescheduleTask = nil
        }
    }

    private func rescheduleStrictReminders(request: StrictRemindersReconcileRequest) async {
        guard Task.isCancelled == false else {
            return
        }
        guard let workspaceId = self.workspace?.workspaceId else {
            return
        }

        let triggerDiagnosticValue = strictRemindersReconcileTriggerDiagnosticValue(triggers: request.triggers)
        let reconcileStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_reconcile",
            phase: .start,
            trigger: triggerDiagnosticValue,
            startedAt: nil,
            authorizationStatus: nil,
            counts: emptyNotificationForegroundOperationCounts(),
            errorSummary: nil
        )
        let center = UNUserNotificationCenter.current()
        let cleanupStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_notification_center_cleanup",
            phase: .start,
            trigger: triggerDiagnosticValue,
            startedAt: nil,
            authorizationStatus: nil,
            counts: emptyNotificationForegroundOperationCounts(),
            errorSummary: nil
        )
        let pendingBeforeCleanupRequestIdentifiers = await pendingAppNotificationRequestIdentifiers(center: center)
        let cleanupPendingBefore = appNotificationPendingRequestBreakdown(
            identifiers: pendingBeforeCleanupRequestIdentifiers
        )
        let pendingStrictRequestIdentifiers = filterStrictReminderRequestIdentifiers(
            identifiers: pendingBeforeCleanupRequestIdentifiers
        )
        let shouldClearDeliveredStrictReminders = request.shouldClearDeliveredStrictReminders
            || self.reviewNotificationsSettings.isEnabled == false
            || self.strictRemindersSettings.isEnabled == false
        let deliveredBeforeCleanupRequestIdentifiersToRemove: [String]?
        if shouldClearDeliveredStrictReminders {
            deliveredBeforeCleanupRequestIdentifiersToRemove = await deliveredStrictReminderRequestIdentifiers(
                center: center
            )
        } else {
            deliveredBeforeCleanupRequestIdentifiersToRemove = nil
        }
        if pendingStrictRequestIdentifiers.isEmpty == false {
            center.removePendingNotificationRequests(withIdentifiers: pendingStrictRequestIdentifiers)
        }
        guard Task.isCancelled == false else {
            return
        }
        var deliveredRemovedCount: Int?
        if let deliveredBeforeCleanupRequestIdentifiersToRemove {
            deliveredRemovedCount = removeDeliveredStrictReminders(
                center: center,
                requestIdentifiers: deliveredBeforeCleanupRequestIdentifiersToRemove
            )
        }
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_notification_center_cleanup",
            phase: .success,
            trigger: triggerDiagnosticValue,
            startedAt: cleanupStartedAt,
            authorizationStatus: nil,
            counts: notificationCleanupForegroundOperationCounts(
                pendingBefore: cleanupPendingBefore,
                deliveredBeforeCount: nil,
                deliveredRemovedCount: deliveredRemovedCount
            ),
            errorSummary: nil
        )
        guard Task.isCancelled == false else {
            return
        }

        guard self.reviewNotificationsSettings.isEnabled, self.strictRemindersSettings.isEnabled else {
            self.persistScheduledStrictReminders(payloads: [])
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .strictReminder,
                stage: "strict_reconcile_skipped_disabled",
                phase: .success,
                trigger: triggerDiagnosticValue,
                startedAt: reconcileStartedAt,
                authorizationStatus: nil,
                counts: emptyNotificationForegroundOperationCounts(),
                errorSummary: nil
            )
            return
        }
        let permissionStatus = await resolveReviewNotificationPermissionStatus()
        guard permissionStatus == .allowed else {
            self.persistScheduledStrictReminders(payloads: [])
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .strictReminder,
                stage: "strict_reconcile_skipped_permission",
                phase: .success,
                trigger: triggerDiagnosticValue,
                startedAt: reconcileStartedAt,
                authorizationStatus: permissionStatus,
                counts: emptyNotificationForegroundOperationCounts(),
                errorSummary: nil
            )
            return
        }
        let waitStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_wait_review_notifications",
            phase: .start,
            trigger: triggerDiagnosticValue,
            startedAt: nil,
            authorizationStatus: permissionStatus,
            counts: emptyNotificationForegroundOperationCounts(),
            errorSummary: nil
        )
        await self.waitForReviewNotificationsReconcileToSettle()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_wait_review_notifications",
            phase: .success,
            trigger: triggerDiagnosticValue,
            startedAt: waitStartedAt,
            authorizationStatus: permissionStatus,
            counts: emptyNotificationForegroundOperationCounts(),
            errorSummary: nil
        )
        guard Task.isCancelled == false else {
            return
        }

        let payloads: [ScheduledStrictReminderPayload]
        let payloadLoadStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_payload_load",
            phase: .start,
            trigger: triggerDiagnosticValue,
            startedAt: nil,
            authorizationStatus: permissionStatus,
            counts: emptyNotificationForegroundOperationCounts(),
            errorSummary: nil
        )
        do {
            let calendar = Calendar.autoupdatingCurrent
            let persistedCompletedDayStartMillis = loadStrictReminderCompletedDayStartMillis(
                userDefaults: self.userDefaults,
                now: request.now,
                calendar: calendar
            )
            let importedCompletedDayStartMillis = try await loadStrictReminderImportedCompletedDayStartMillis(
                databaseURL: self.localDatabaseURL,
                workspaceId: workspaceId,
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
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .strictReminder,
                stage: "strict_payload_load",
                phase: .success,
                trigger: triggerDiagnosticValue,
                startedAt: payloadLoadStartedAt,
                authorizationStatus: permissionStatus,
                counts: notificationPlannedForegroundOperationCounts(
                    plannedCount: payloads.count
                ),
                errorSummary: nil
            )
        } catch {
            let errorSummary = Flashcards.errorMessage(error: error)
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .strictReminder,
                stage: "strict_payload_load",
                phase: .failure,
                trigger: triggerDiagnosticValue,
                startedAt: payloadLoadStartedAt,
                authorizationStatus: permissionStatus,
                counts: emptyNotificationForegroundOperationCounts(),
                errorSummary: errorSummary
            )
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .strictReminder,
                stage: "strict_reconcile",
                phase: .failure,
                trigger: triggerDiagnosticValue,
                startedAt: reconcileStartedAt,
                authorizationStatus: permissionStatus,
                counts: emptyNotificationForegroundOperationCounts(),
                errorSummary: errorSummary
            )
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
                        reason: errorSummary,
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
        let pendingReadStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_pending_read_before",
            phase: .start,
            trigger: triggerDiagnosticValue,
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
            notificationKind: .strictReminder,
            stage: "strict_pending_read_before",
            phase: .success,
            trigger: triggerDiagnosticValue,
            startedAt: pendingReadStartedAt,
            authorizationStatus: permissionStatusBeforeAdd,
            counts: notificationPendingBeforeForegroundOperationCounts(
                pendingBefore: pendingBeforeBreakdown,
                plannedCount: payloads.count
            ),
            errorSummary: nil
        )
        var addFailure: Error?
        var attemptedPayloads: [ScheduledStrictReminderPayload] = []
        var attemptedAddCount = 0
        let addStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_add_requests",
            phase: .start,
            trigger: triggerDiagnosticValue,
            startedAt: nil,
            authorizationStatus: permissionStatusBeforeAdd,
            counts: notificationPendingBeforeForegroundOperationCounts(
                pendingBefore: pendingBeforeBreakdown,
                plannedCount: payloads.count
            ),
            errorSummary: nil
        )
        for payload in payloads {
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
            let notificationRequest = makeStrictReminderNotificationRequest(
                payload: payload,
                notificationScope: notificationScope,
                addNow: addNow
            )

            attemptedPayloads.append(payload)
            do {
                attemptedAddCount += 1
                try await center.add(notificationRequest)
            } catch {
                addFailure = error
                break
            }
        }
        let addErrorSummary = addFailure.map { error in Flashcards.errorMessage(error: error) }
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_add_requests",
            phase: addFailure == nil ? .success : .failure,
            trigger: triggerDiagnosticValue,
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
        guard Task.isCancelled == false else {
            return
        }

        let readbackNow = Date()
        let expectedPayloads: [ScheduledStrictReminderPayload] = futureStrictReminderPayloads(
            payloads: attemptedPayloads,
            now: readbackNow
        )
        var finalExpectedPayloads: [ScheduledStrictReminderPayload] = expectedPayloads
        var readbackResult: NotificationSchedulingReadbackResult
        let initialReadbackRetryDelayNanoseconds: [UInt64] = addFailure == nil
            ? notificationSchedulingReadbackRetryDelayNanoseconds
            : []
        let readbackStartedAt = Date()
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_readback",
            phase: .start,
            trigger: triggerDiagnosticValue,
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
            readbackResult = try await notificationSchedulingReadback(
                center: center,
                plannedRequestIdentifiers: expectedPayloads.map(\.requestId),
                retryDelayNanoseconds: initialReadbackRetryDelayNanoseconds
            )
        } catch is CancellationError {
            return
        } catch {
            let errorSummary = Flashcards.errorMessage(error: error)
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .strictReminder,
                stage: "strict_readback",
                phase: .failure,
                trigger: triggerDiagnosticValue,
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
                notificationKind: .strictReminder,
                stage: "strict_reconcile",
                phase: .failure,
                trigger: triggerDiagnosticValue,
                startedAt: reconcileStartedAt,
                authorizationStatus: permissionStatusBeforeAdd,
                counts: notificationReadbackForegroundOperationCounts(
                    pendingBefore: pendingBeforeBreakdown,
                    pendingAfter: nil,
                    deliveredBeforeCount: nil,
                    deliveredRemovedCount: deliveredRemovedCount,
                    plannedCount: expectedPayloads.count,
                    attemptedCount: attemptedAddCount,
                    acceptedCount: nil,
                    readbackCompleted: nil,
                    readbackAttemptCount: nil
                ),
                errorSummary: errorSummary
            )
            captureStrictRemindersSilentFailure(
                error: error,
                action: "strict_reminders_delayed_readback",
                stage: "readback",
                cloudSettings: self.cloudSettings,
                workspaceId: self.workspace?.workspaceId,
                configurationMode: try? self.currentCloudServiceConfiguration().mode
            )
            return
        }
        guard Task.isCancelled == false else {
            return
        }
        var readbackAttemptCount: Int = readbackResult.attemptCount

        if addFailure == nil && readbackResult.isComplete == false {
            let initialReadbackResult = readbackResult
            let missingPayloads: [ScheduledStrictReminderPayload] = missingStrictReminderPayloads(
                payloads: expectedPayloads,
                pendingRequestIdentifiers: readbackResult.pendingRequestIdentifiers
            )
            for payload in missingPayloads {
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
                let notificationRequest = makeStrictReminderNotificationRequest(
                    payload: payload,
                    notificationScope: notificationScope,
                    addNow: addNow
                )
                do {
                    attemptedAddCount += 1
                    try await center.add(notificationRequest)
                } catch {
                    addFailure = error
                    break
                }
            }
            guard Task.isCancelled == false else {
                return
            }
            finalExpectedPayloads = futureStrictReminderPayloads(
                payloads: expectedPayloads,
                now: Date()
            )
            let finalReadbackRetryDelayNanoseconds: [UInt64] = addFailure == nil
                ? notificationSchedulingReadbackRetryDelayNanoseconds
                : []
            do {
                readbackResult = try await notificationSchedulingReadback(
                    center: center,
                    plannedRequestIdentifiers: finalExpectedPayloads.map(\.requestId),
                    retryDelayNanoseconds: finalReadbackRetryDelayNanoseconds
                )
                readbackAttemptCount += readbackResult.attemptCount
            } catch is CancellationError {
                return
            } catch {
                let errorSummary = Flashcards.errorMessage(error: error)
                self.addNotificationForegroundOperationBreadcrumb(
                    notificationKind: .strictReminder,
                    stage: "strict_readback",
                    phase: .failure,
                    trigger: triggerDiagnosticValue,
                    startedAt: readbackStartedAt,
                    authorizationStatus: permissionStatusBeforeAdd,
                    counts: notificationReadbackForegroundOperationCounts(
                        pendingBefore: pendingBeforeBreakdown,
                        pendingAfter: appNotificationPendingRequestBreakdown(
                            identifiers: initialReadbackResult.pendingRequestIdentifiers
                        ),
                        deliveredBeforeCount: nil,
                        deliveredRemovedCount: nil,
                        plannedCount: finalExpectedPayloads.count,
                        attemptedCount: attemptedAddCount,
                        acceptedCount: nil,
                        readbackCompleted: initialReadbackResult.isComplete,
                        readbackAttemptCount: readbackAttemptCount
                    ),
                    errorSummary: errorSummary
                )
                self.addNotificationForegroundOperationBreadcrumb(
                    notificationKind: .strictReminder,
                    stage: "strict_reconcile",
                    phase: .failure,
                    trigger: triggerDiagnosticValue,
                    startedAt: reconcileStartedAt,
                    authorizationStatus: permissionStatusBeforeAdd,
                    counts: notificationReadbackForegroundOperationCounts(
                        pendingBefore: pendingBeforeBreakdown,
                        pendingAfter: appNotificationPendingRequestBreakdown(
                            identifiers: initialReadbackResult.pendingRequestIdentifiers
                        ),
                        deliveredBeforeCount: nil,
                        deliveredRemovedCount: deliveredRemovedCount,
                        plannedCount: finalExpectedPayloads.count,
                        attemptedCount: attemptedAddCount,
                        acceptedCount: nil,
                        readbackCompleted: initialReadbackResult.isComplete,
                        readbackAttemptCount: readbackAttemptCount
                    ),
                    errorSummary: errorSummary
                )
                captureStrictRemindersSilentFailure(
                    error: error,
                    action: "strict_reminders_delayed_readback",
                    stage: "readback",
                    cloudSettings: self.cloudSettings,
                    workspaceId: self.workspace?.workspaceId,
                    configurationMode: try? self.currentCloudServiceConfiguration().mode
                )
                return
            }
            guard Task.isCancelled == false else {
                return
            }
        }

        let pendingAfterRequestIdentifiers: [String] = readbackResult.pendingRequestIdentifiers
        let permissionStatusAfterReadback: ReviewNotificationPermissionStatus =
            await resolveReviewNotificationPermissionStatus()
        guard Task.isCancelled == false else {
            return
        }
        let appStateAfterReadback: String = currentAppNotificationApplicationStateDiagnosticValue()
        let acceptedAttemptedPayloads: [ScheduledStrictReminderPayload] = acceptedStrictReminderPayloads(
            payloads: attemptedPayloads,
            pendingRequestIdentifiers: pendingAfterRequestIdentifiers
        )
        let acceptedExpectedPayloads: [ScheduledStrictReminderPayload] = acceptedStrictReminderPayloads(
            payloads: finalExpectedPayloads,
            pendingRequestIdentifiers: pendingAfterRequestIdentifiers
        )
        let hasReadbackMismatch: Bool = addFailure == nil && readbackResult.isComplete == false
        let delayedReadback: DelayedNotificationSchedulingReadback? = readbackResult.delayedReadback
        let diagnosticPayloads: [ScheduledStrictReminderPayload]
        if addFailure == nil {
            diagnosticPayloads = finalExpectedPayloads
        } else {
            diagnosticPayloads = attemptedPayloads
        }
        let diagnostics: NotificationSchedulingDiagnostics = makeNotificationSchedulingDiagnostics(
            trigger: triggerDiagnosticValue,
            scheduledAtMillisRange: strictReminderScheduledAtMillisRange(payloads: diagnosticPayloads),
            delaySecondsRange: strictReminderSchedulingDelaySecondsRange(
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
            ? "Notification Center accepted fewer strict reminders than planned"
            : nil
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_readback",
            phase: hasReadbackMismatch ? .failure : .success,
            trigger: triggerDiagnosticValue,
            startedAt: readbackStartedAt,
            authorizationStatus: permissionStatusAfterReadback,
            counts: notificationReadbackForegroundOperationCounts(
                pendingBefore: diagnostics.pendingBefore,
                pendingAfter: diagnostics.pendingAfter,
                deliveredBeforeCount: nil,
                deliveredRemovedCount: nil,
                plannedCount: finalExpectedPayloads.count,
                attemptedCount: attemptedAddCount,
                acceptedCount: acceptedExpectedPayloads.count,
                readbackCompleted: readbackResult.isComplete,
                readbackAttemptCount: readbackAttemptCount
            ),
            errorSummary: readbackMismatchSummary
        )
        let reconcileErrorSummary: String? = addFailure.map { error in
            Flashcards.errorMessage(error: error)
        } ?? readbackMismatchSummary
        if let addFailure, didLogAddFailureBreadcrumb == false {
            self.addNotificationForegroundOperationBreadcrumb(
                notificationKind: .strictReminder,
                stage: "strict_add_requests",
                phase: .failure,
                trigger: triggerDiagnosticValue,
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
                    readbackCompleted: readbackResult.isComplete,
                    readbackAttemptCount: readbackAttemptCount
                ),
                errorSummary: Flashcards.errorMessage(error: addFailure)
            )
        }
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
                        plannedCount: finalExpectedPayloads.count,
                        acceptedCount: acceptedExpectedPayloads.count,
                        diagnostics: diagnostics,
                        error: nil,
                        messageSummary: readbackMismatchSummary
                    )
                )
            )
        }
        self.persistScheduledStrictReminders(payloads: acceptedExpectedPayloads)
        self.addNotificationForegroundOperationBreadcrumb(
            notificationKind: .strictReminder,
            stage: "strict_reconcile",
            phase: reconcileErrorSummary == nil ? .success : .failure,
            trigger: triggerDiagnosticValue,
            startedAt: reconcileStartedAt,
            authorizationStatus: permissionStatusAfterReadback,
            counts: notificationReadbackForegroundOperationCounts(
                pendingBefore: diagnostics.pendingBefore,
                pendingAfter: diagnostics.pendingAfter,
                deliveredBeforeCount: nil,
                deliveredRemovedCount: deliveredRemovedCount,
                plannedCount: finalExpectedPayloads.count,
                attemptedCount: attemptedAddCount,
                acceptedCount: acceptedExpectedPayloads.count,
                readbackCompleted: readbackResult.isComplete,
                readbackAttemptCount: readbackAttemptCount
            ),
            errorSummary: reconcileErrorSummary
        )
    }
}

private func makeStrictReminderNotificationRequest(
    payload: ScheduledStrictReminderPayload,
    notificationScope: String,
    addNow: Date
) -> UNNotificationRequest {
    let content = UNMutableNotificationContent()
    content.title = appDisplayName()
    content.body = payload.notificationBodyText
    content.sound = .default
    content.userInfo = buildStrictReminderNotificationUserInfo(scope: notificationScope)

    let interval = max(1, TimeInterval(payload.scheduledAtMillis) / 1_000 - addNow.timeIntervalSince1970)
    return UNNotificationRequest(
        identifier: payload.requestId,
        content: content,
        trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
    )
}
