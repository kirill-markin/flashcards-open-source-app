import Foundation
import UserNotifications

@MainActor
extension FlashcardsStore {
    func rescheduleReviewNotifications(
        trigger: ReviewNotificationsReconcileTrigger,
        now: Date,
        generation: Int,
        shouldClearDeliveredReviewNotifications: Bool,
        shouldClearReviewReminderAttention: Bool
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
        if shouldClearDeliveredReviewNotifications {
            let deliveredReviewReminderStates = await deliveredReviewReminderAttentionStates(center: center)
            guard self.reviewNotificationsRescheduleGeneration == generation else {
                return
            }
            guard Task.isCancelled == false else {
                return
            }
            deliveredBeforeCount = deliveredReviewReminderStates.count
            if shouldClearReviewReminderAttention == false && self.reviewNotificationsSettings.isEnabled {
                self.markReviewReminderAttentionFromDeliveredStates(
                    states: deliveredReviewReminderStates,
                    workspaceId: workspaceId
                )
                self.reconcileReviewReminderAttentionAfterReviewLogs(now: now)
            } else if shouldClearReviewReminderAttention == false {
                self.clearReviewReminderAttention()
            }
        }
        if pendingRequestIdentifiers.isEmpty == false {
            center.removePendingNotificationRequests(withIdentifiers: pendingRequestIdentifiers)
        }
        var deliveredRemovedCount: Int?
        if shouldClearDeliveredReviewNotifications {
            deliveredRemovedCount = await removeDeliveredReviewNotifications(center: center)
            guard self.reviewNotificationsRescheduleGeneration == generation else {
                return
            }
            guard Task.isCancelled == false else {
                return
            }
            if shouldClearReviewReminderAttention {
                self.clearReviewReminderAttention()
                do {
                    try await center.setBadgeCount(0)
                } catch {
                    let errorSummary = Flashcards.errorMessage(error: error)
                    self.addNotificationForegroundOperationBreadcrumb(
                        notificationKind: .reviewReminder,
                        stage: "review_notification_center_cleanup",
                        phase: .failure,
                        trigger: trigger.diagnosticValue,
                        startedAt: cleanupStartedAt,
                        authorizationStatus: nil,
                        counts: notificationCleanupForegroundOperationCounts(
                            pendingBefore: cleanupPendingBefore,
                            deliveredBeforeCount: deliveredBeforeCount,
                            deliveredRemovedCount: deliveredRemovedCount
                        ),
                        errorSummary: errorSummary
                    )
                    captureReviewNotificationsSilentFailure(
                        error: error,
                        action: "review_notifications_badge_reset",
                        stage: "cleanup",
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
                self.pendingReviewNotificationsAttentionClear = false
            }
            self.pendingReviewNotificationsDeliveredCleanup = false
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
        content.userInfo = buildReviewNotificationUserInfo(reviewFilter: payload.reviewFilter)
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
