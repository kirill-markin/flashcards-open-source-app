package com.flashcardsopensourceapp.app.notifications

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.await
import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidNotificationSchedulingDiagnostic
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidWorkInfoStateCounts
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.review.loadTopActiveReviewCard
import com.flashcardsopensourceapp.data.local.model.cards.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.cards.decodeDeckFilterDefinitionJson
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTagKey
import com.flashcardsopensourceapp.data.local.notifications.CurrentReviewNotificationCard
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationMode
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.ScheduledReviewNotificationPayload
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersStore
import com.flashcardsopensourceapp.data.local.notifications.appNotificationWorkLimit
import com.flashcardsopensourceapp.data.local.notifications.buildFallbackDailyReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.buildFallbackInactivityReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.buildDailyReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.buildInactivityReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.makePersistedReviewFilter
import com.flashcardsopensourceapp.data.local.notifications.reviewNotificationWorkLimit
import com.flashcardsopensourceapp.data.local.notifications.strictReminderWorkLimit
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.loadCurrentWorkspaceOrNull
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.feature.review.reviewTextProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

const val reviewNotificationChannelId: String = "review-reminders"
const val reviewNotificationFrontTextDataKey: String = "frontText"
const val reviewNotificationRequestIdDataKey: String = "requestId"
const val reviewNotificationWorkspaceIdDataKey: String = "workspaceId"
const val reviewNotificationWorkTag: String = "review-notification"

class ReviewNotificationsManager(
    private val context: Context,
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val reviewPreferencesStore: ReviewPreferencesStore,
    private val reviewNotificationsStore: ReviewNotificationsStore,
    private val strictRemindersStore: StrictRemindersStore,
    private val observability: AppObservability,
    private val appVersion: String?,
    private val versionCode: Int?
) {
    private val workManager: WorkManager = WorkManager.getInstance(context)
    private val scopeJob = SupervisorJob()
    private val scope = CoroutineScope(scopeJob + Dispatchers.Default)
    private var activeReconcileJob: Job? = null
    private val reconcileGeneration = AtomicLong(0)

    /**
     * Reconciles review reminder notifications for the current workspace.
     *
     * The operation is idempotent and safe to call repeatedly. It clears stale
     * system notifications when the trigger requires it, removes pending review
     * work for the current workspace, recomputes the desired reminder payloads,
     * and schedules the resulting payloads again.
     */
    fun reconcileCurrentWorkspaceReviewNotifications(
        trigger: ReviewNotificationsReconcileTrigger,
        nowMillis: Long
    ) {
        val generation = reconcileGeneration.incrementAndGet()
        activeReconcileJob?.cancel()
        activeReconcileJob = scope.launch {
            reconcileCurrentWorkspaceReviewNotifications(
                trigger = trigger,
                nowMillis = nowMillis,
                generation = generation
            )
            if (isLatestReconcileGeneration(generation = generation)) {
                activeReconcileJob = null
            }
        }
    }

    suspend fun reconcileCurrentWorkspaceReviewNotificationsAndWait(
        trigger: ReviewNotificationsReconcileTrigger,
        nowMillis: Long
    ) {
        val generation = reconcileGeneration.incrementAndGet()
        activeReconcileJob?.cancelAndJoin()
        val reconcileJob = scope.async {
            reconcileCurrentWorkspaceReviewNotifications(
                trigger = trigger,
                nowMillis = nowMillis,
                generation = generation
            )
        }
        activeReconcileJob = reconcileJob
        try {
            reconcileJob.await()
        } finally {
            if (isLatestReconcileGeneration(generation = generation)) {
                activeReconcileJob = null
            }
        }
    }

    suspend fun close() {
        activeReconcileJob?.cancelAndJoin()
        scopeJob.cancelAndJoin()
    }

    private suspend fun reconcileCurrentWorkspaceReviewNotifications(
        trigger: ReviewNotificationsReconcileTrigger,
        nowMillis: Long,
        generation: Long
    ) {
        if (isLatestReconcileGeneration(generation = generation).not()) {
            return
        }

        if (trigger.shouldClearDeliveredReviewNotifications) {
            clearDeliveredReviewReminderNotifications()
        }

        val workspace = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        ) ?: return
        if (isLatestReconcileGeneration(generation = generation).not()) {
            return
        }

        val workspaceId: String = workspace.workspaceId
        val strictRemindersSettings = strictRemindersStore.loadStrictRemindersSettings()
        val strictRemindersEnabled: Boolean = strictRemindersSettings.isEnabled
        val workLimit: Int = reviewNotificationWorkLimit(strictRemindersSettings = strictRemindersSettings)
        val permissionAllowed: Boolean = hasNotificationPermission(context = context)
        val storedScheduledCountBefore: Int = reviewNotificationsStore.loadScheduledPayloads(
            workspaceId = workspaceId
        ).size
        emitReviewSchedulingBreadcrumb(
            diagnostic = makeReviewSchedulingDiagnostic(
                stage = "reconcile_start",
                trigger = trigger,
                workspaceId = workspaceId,
                permissionAllowed = permissionAllowed,
                plannedCount = null,
                workLimit = workLimit,
                strictRemindersEnabled = strictRemindersEnabled,
                storedScheduledCountBefore = storedScheduledCountBefore,
                storedScheduledCountAfter = null,
                tagWorkStateCounts = null,
                expectedWorkReadback = null,
                delayRange = emptyNotificationDelayRange(),
                generation = generation
            )
        )

        clearCurrentWorkspaceReviewScheduling(workspaceId = workspaceId)
        emitReviewSchedulingBreadcrumb(
            diagnostic = makeReviewSchedulingDiagnostic(
                stage = "after_cancel",
                trigger = trigger,
                workspaceId = workspaceId,
                permissionAllowed = permissionAllowed,
                plannedCount = null,
                workLimit = workLimit,
                strictRemindersEnabled = strictRemindersEnabled,
                storedScheduledCountBefore = storedScheduledCountBefore,
                storedScheduledCountAfter = reviewNotificationsStore.loadScheduledPayloads(workspaceId = workspaceId).size,
                tagWorkStateCounts = loadWorkInfoStateCountsByTag(
                    workManager = workManager,
                    workTag = reviewNotificationWorkTag
                ),
                expectedWorkReadback = null,
                delayRange = emptyNotificationDelayRange(),
                generation = generation
            )
        )

        val settings = reviewNotificationsStore.loadSettings(workspaceId = workspaceId)
        if (settings.isEnabled.not()) {
            saveEmptyReviewSchedulingAndEmitSkippedDiagnostic(
                stage = "settings_disabled",
                trigger = trigger,
                workspaceId = workspaceId,
                permissionAllowed = permissionAllowed,
                workLimit = workLimit,
                strictRemindersEnabled = strictRemindersEnabled,
                storedScheduledCountBefore = storedScheduledCountBefore,
                generation = generation
            )
            return
        }
        if (permissionAllowed.not()) {
            // Keep the internal setting enabled; Android permission alone gates delivery.
            saveEmptyReviewSchedulingAndEmitSkippedDiagnostic(
                stage = "permission_blocked",
                trigger = trigger,
                workspaceId = workspaceId,
                permissionAllowed = permissionAllowed,
                workLimit = workLimit,
                strictRemindersEnabled = strictRemindersEnabled,
                storedScheduledCountBefore = storedScheduledCountBefore,
                generation = generation
            )
            return
        }
        if (isLatestReconcileGeneration(generation = generation).not()) {
            return
        }

        val selectedReviewFilter = reviewPreferencesStore.loadSelectedReviewFilter(
            workspaceId = workspaceId
        )
        val reviewNotificationFilterPlan = loadReviewNotificationFilterPlan(
            workspaceId = workspaceId,
            selectedReviewFilter = selectedReviewFilter
        )
        val resolvedReviewFilter = when (reviewNotificationFilterPlan) {
            is ReviewNotificationFilterPlan.Schedule -> reviewNotificationFilterPlan.reviewFilter
            ReviewNotificationFilterPlan.SuppressScheduledPayloads -> {
                saveEmptyReviewSchedulingAndEmitSkippedDiagnostic(
                    stage = "filter_suppressed",
                    trigger = trigger,
                    workspaceId = workspaceId,
                    permissionAllowed = permissionAllowed,
                    workLimit = workLimit,
                    strictRemindersEnabled = strictRemindersEnabled,
                    storedScheduledCountBefore = storedScheduledCountBefore,
                    generation = generation
                )
                return
            }
        }

        val currentCard = loadCurrentReviewNotificationCard(
            workspaceId = workspaceId,
            reviewFilter = resolvedReviewFilter,
            nowMillis = nowMillis
        )

        val zoneId = ZoneId.systemDefault()
        val payloads = if (currentCard != null) {
            when (settings.selectedMode) {
                ReviewNotificationMode.DAILY -> buildDailyReminderPayloads(
                    workspaceId = workspaceId,
                    currentCard = currentCard,
                    nowMillis = nowMillis,
                    zoneId = zoneId,
                    settings = settings.daily,
                    workLimit = workLimit
                )

                ReviewNotificationMode.INACTIVITY -> {
                    val lastActiveAtMillis = reviewNotificationsStore.loadLastActiveAtMillis()
                        ?: return saveEmptyReviewSchedulingAndEmitSkippedDiagnostic(
                            stage = "missing_last_active",
                            trigger = trigger,
                            workspaceId = workspaceId,
                            permissionAllowed = permissionAllowed,
                            workLimit = workLimit,
                            strictRemindersEnabled = strictRemindersEnabled,
                            storedScheduledCountBefore = storedScheduledCountBefore,
                            generation = generation
                        )
                    buildInactivityReminderPayloads(
                        workspaceId = workspaceId,
                        currentCard = currentCard,
                        nowMillis = nowMillis,
                        lastActiveAtMillis = lastActiveAtMillis,
                        zoneId = zoneId,
                        settings = settings.inactivity,
                        workLimit = workLimit
                    )
                }
            }
        } else {
            val persistedReviewFilter = makePersistedReviewFilter(reviewFilter = resolvedReviewFilter)
            val fallbackFrontText = reviewTextProvider(context = context).notificationFallbackFrontText
            when (settings.selectedMode) {
                ReviewNotificationMode.DAILY -> buildFallbackDailyReminderPayloads(
                    workspaceId = workspaceId,
                    reviewFilter = persistedReviewFilter,
                    fallbackFrontText = fallbackFrontText,
                    nowMillis = nowMillis,
                    zoneId = zoneId,
                    settings = settings.daily,
                    workLimit = workLimit
                )

                ReviewNotificationMode.INACTIVITY -> {
                    val lastActiveAtMillis = reviewNotificationsStore.loadLastActiveAtMillis()
                        ?: return saveEmptyReviewSchedulingAndEmitSkippedDiagnostic(
                            stage = "missing_last_active",
                            trigger = trigger,
                            workspaceId = workspaceId,
                            permissionAllowed = permissionAllowed,
                            workLimit = workLimit,
                            strictRemindersEnabled = strictRemindersEnabled,
                            storedScheduledCountBefore = storedScheduledCountBefore,
                            generation = generation
                        )
                    buildFallbackInactivityReminderPayloads(
                        workspaceId = workspaceId,
                        reviewFilter = persistedReviewFilter,
                        fallbackFrontText = fallbackFrontText,
                        nowMillis = nowMillis,
                        lastActiveAtMillis = lastActiveAtMillis,
                        zoneId = zoneId,
                        settings = settings.inactivity,
                        workLimit = workLimit
                    )
                }
            }
        }
        if (isLatestReconcileGeneration(generation = generation).not()) {
            return
        }

        payloads.forEach { payload ->
            if (isLatestReconcileGeneration(generation = generation).not()) {
                return
            }
            enqueuePayload(payload = payload, nowMillis = nowMillis)
        }
        if (isLatestReconcileGeneration(generation = generation).not()) {
            return
        }
        reviewNotificationsStore.saveScheduledPayloads(
            workspaceId = workspaceId,
            payloads = payloads
        )
        val expectedWorkReadback: NotificationExpectedWorkInfoReadback = loadExpectedWorkInfoReadback(
            workManager = workManager,
            expectedUniqueWorkNames = payloads.map { payload ->
                payload.requestId
            }
        )
        val tagWorkStateCounts: AndroidWorkInfoStateCounts = loadWorkInfoStateCountsByTag(
            workManager = workManager,
            workTag = reviewNotificationWorkTag
        )
        val delayRange: NotificationDelayRange = calculateNotificationDelayRange(
            scheduledAtMillisValues = payloads.map { payload ->
                payload.scheduledAtMillis
            },
            nowMillis = nowMillis
        )
        val afterEnqueueDiagnostic: AndroidNotificationSchedulingDiagnostic = makeReviewSchedulingDiagnostic(
            stage = "after_enqueue",
            trigger = trigger,
            workspaceId = workspaceId,
            permissionAllowed = permissionAllowed,
            plannedCount = payloads.size,
            workLimit = workLimit,
            strictRemindersEnabled = strictRemindersEnabled,
            storedScheduledCountBefore = storedScheduledCountBefore,
            storedScheduledCountAfter = reviewNotificationsStore.loadScheduledPayloads(workspaceId = workspaceId).size,
            tagWorkStateCounts = tagWorkStateCounts,
            expectedWorkReadback = expectedWorkReadback,
            delayRange = delayRange,
            generation = generation
        )
        emitReviewSchedulingBreadcrumb(diagnostic = afterEnqueueDiagnostic)
        emitReviewSchedulingWarningIfNeeded(
            diagnostic = afterEnqueueDiagnostic,
            plannedCount = payloads.size,
            expectedWorkReadback = expectedWorkReadback
        )
    }

    private fun isLatestReconcileGeneration(generation: Long): Boolean {
        return reconcileGeneration.get() == generation
    }

    /**
     * Removes only already-delivered review reminders from the notification shade.
     *
     * Review reminders are identified by the dedicated review channel and the
     * `review-notification::` tag namespace. Legacy reminders without a tag are
     * also removed as long as they are still posted on the review channel.
     *
     * Public so callers can drop the launcher icon badge synchronously, e.g. when
     * the user disables the "Show app icon badge" toggle.
     */
    fun clearDeliveredReviewReminderNotifications() {
        val notificationManager = context.getSystemService(NotificationManager::class.java)
        val deliveredNotifications = notificationManager.activeNotifications.filter { notification ->
            isReviewReminderNotification(notification = notification)
        }
        if (deliveredNotifications.isEmpty()) {
            return
        }

        val compatManager = NotificationManagerCompat.from(context)
        deliveredNotifications.forEach { notification ->
            val tag = notification.tag
            if (tag == null) {
                compatManager.cancel(notification.id)
            } else {
                compatManager.cancel(tag, notification.id)
            }
        }
    }

    private fun isReviewReminderNotification(notification: StatusBarNotification): Boolean {
        if (notification.packageName != context.packageName) {
            return false
        }

        val postedNotification = notification.notification
        if (postedNotification.channelId != reviewNotificationChannelId) {
            return false
        }

        val tag = notification.tag ?: return true
        return tag.startsWith(reviewReminderNotificationTagPrefix)
    }

    private suspend fun enqueuePayload(
        payload: ScheduledReviewNotificationPayload,
        nowMillis: Long
    ) {
        val delayMillis = maxOf(1L, payload.scheduledAtMillis - nowMillis)
        val inputData = Data.Builder()
            .putString(reviewNotificationFrontTextDataKey, payload.frontText)
            .putString(reviewNotificationRequestIdDataKey, payload.requestId)
            .putString(reviewNotificationWorkspaceIdDataKey, payload.workspaceId)
            .build()
        val request = OneTimeWorkRequestBuilder<ReviewNotificationWorker>()
            .setInitialDelay(delayMillis, TimeUnit.MILLISECONDS)
            .setInputData(inputData)
            .setConstraints(
                Constraints.Builder()
                    .setRequiresBatteryNotLow(false)
                    .build()
            )
            .addTag(reviewNotificationWorkspaceTag(workspaceId = payload.workspaceId))
            .addTag(reviewNotificationWorkTag)
            .build()

        workManager.enqueueUniqueWork(
            payload.requestId,
            ExistingWorkPolicy.REPLACE,
            request
        ).await()
    }

    private suspend fun clearCurrentWorkspaceReviewScheduling(workspaceId: String) {
        workManager.cancelAllWorkByTag(reviewNotificationWorkTag).await()
        reviewNotificationsStore.saveScheduledPayloads(workspaceId = workspaceId, payloads = emptyList())
    }

    private suspend fun saveEmptyReviewSchedulingAndEmitSkippedDiagnostic(
        stage: String,
        trigger: ReviewNotificationsReconcileTrigger,
        workspaceId: String,
        permissionAllowed: Boolean,
        workLimit: Int,
        strictRemindersEnabled: Boolean,
        storedScheduledCountBefore: Int,
        generation: Long
    ) {
        reviewNotificationsStore.saveScheduledPayloads(
            workspaceId = workspaceId,
            payloads = emptyList()
        )
        emitReviewSchedulingBreadcrumb(
            diagnostic = makeReviewSchedulingDiagnostic(
                stage = stage,
                trigger = trigger,
                workspaceId = workspaceId,
                permissionAllowed = permissionAllowed,
                plannedCount = 0,
                workLimit = workLimit,
                strictRemindersEnabled = strictRemindersEnabled,
                storedScheduledCountBefore = storedScheduledCountBefore,
                storedScheduledCountAfter = reviewNotificationsStore.loadScheduledPayloads(workspaceId = workspaceId).size,
                tagWorkStateCounts = loadWorkInfoStateCountsByTag(
                    workManager = workManager,
                    workTag = reviewNotificationWorkTag
                ),
                expectedWorkReadback = null,
                delayRange = emptyNotificationDelayRange(),
                generation = generation
            )
        )
    }

    private fun makeReviewSchedulingDiagnostic(
        stage: String,
        trigger: ReviewNotificationsReconcileTrigger,
        workspaceId: String,
        permissionAllowed: Boolean,
        plannedCount: Int?,
        workLimit: Int,
        strictRemindersEnabled: Boolean,
        storedScheduledCountBefore: Int?,
        storedScheduledCountAfter: Int?,
        tagWorkStateCounts: AndroidWorkInfoStateCounts?,
        expectedWorkReadback: NotificationExpectedWorkInfoReadback?,
        delayRange: NotificationDelayRange,
        generation: Long
    ): AndroidNotificationSchedulingDiagnostic {
        return AndroidNotificationSchedulingDiagnostic(
            notificationKind = reviewReminderNotificationKind,
            stage = stage,
            trigger = trigger.name.lowercase(),
            requestId = null,
            workspaceId = workspaceId,
            permissionAllowed = permissionAllowed,
            plannedCount = plannedCount,
            workLimit = workLimit,
            appNotificationWorkLimit = appNotificationWorkLimit,
            strictReminderWorkLimit = strictReminderWorkLimit,
            strictRemindersEnabled = strictRemindersEnabled,
            plannedCountEqualsWorkLimit = plannedCount?.let { count ->
                count == workLimit
            },
            storedScheduledCountBefore = storedScheduledCountBefore,
            storedScheduledCountAfter = storedScheduledCountAfter,
            workTag = reviewNotificationWorkTag,
            tagWorkStateCounts = tagWorkStateCounts,
            expectedWorkStateCounts = expectedWorkReadback?.stateCounts,
            expectedWorkNameCount = expectedWorkReadback?.expectedWorkNameCount,
            missingExpectedWorkNameCount = expectedWorkReadback?.missingExpectedWorkNameCount,
            firstScheduledAtMillis = delayRange.firstScheduledAtMillis,
            lastScheduledAtMillis = delayRange.lastScheduledAtMillis,
            minDelaySeconds = delayRange.minDelaySeconds,
            maxDelaySeconds = delayRange.maxDelaySeconds,
            generation = generation,
            managerClosed = null,
            enqueueRejected = null
        )
    }

    private fun emitReviewSchedulingBreadcrumb(diagnostic: AndroidNotificationSchedulingDiagnostic) {
        observability.addBreadcrumb(
            event = AndroidBreadcrumbEvent.NotificationSchedulingBreadcrumb(
                diagnostic = diagnostic,
                appVersion = appVersion,
                clientVersion = appVersion,
                versionCode = versionCode
            )
        )
    }

    private fun emitReviewSchedulingWarningIfNeeded(
        diagnostic: AndroidNotificationSchedulingDiagnostic,
        plannedCount: Int,
        expectedWorkReadback: NotificationExpectedWorkInfoReadback
    ) {
        if (plannedCount == 0) {
            return
        }

        val warningReason: String = when {
            hasMissingExpectedWorkNames(readback = expectedWorkReadback) -> "expected_work_missing"
            hasOnlyCancelledOrFailedExpectedWork(readback = expectedWorkReadback) -> {
                "expected_work_cancelled_or_failed"
            }
            else -> return
        }
        observability.captureWarning(
            event = AndroidWarningIssueEvent.NotificationSchedulingWarning(
                diagnostic = diagnostic,
                warningReason = warningReason,
                appVersion = appVersion,
                clientVersion = appVersion,
                versionCode = versionCode
            )
        )
    }

    private suspend fun loadCurrentReviewNotificationCard(
        workspaceId: String,
        reviewFilter: ReviewFilter,
        nowMillis: Long
    ): CurrentReviewNotificationCard? {
        return when (reviewFilter) {
            ReviewFilter.AllCards -> loadCurrentAllCardsReviewNotificationCard(
                workspaceId = workspaceId,
                nowMillis = nowMillis
            )

            is ReviewFilter.Deck -> loadCurrentDeckReviewNotificationCard(
                workspaceId = workspaceId,
                deckId = reviewFilter.deckId,
                nowMillis = nowMillis
            )

            is ReviewFilter.Effort -> loadCurrentEffortReviewNotificationCard(
                workspaceId = workspaceId,
                effortLevel = reviewFilter.effortLevel,
                nowMillis = nowMillis
            )

            is ReviewFilter.Tag -> loadCurrentTagReviewNotificationCard(
                workspaceId = workspaceId,
                tag = reviewFilter.tag,
                nowMillis = nowMillis
            )
        }
    }

    private suspend fun loadReviewNotificationFilterPlan(
        workspaceId: String,
        selectedReviewFilter: ReviewFilter
    ): ReviewNotificationFilterPlan {
        val selectedDeckFilterDefinition = when (selectedReviewFilter) {
            is ReviewFilter.Deck -> loadCurrentWorkspaceDeckFilterDefinitionOrNull(
                workspaceId = workspaceId,
                deckId = selectedReviewFilter.deckId
            )

            ReviewFilter.AllCards,
            is ReviewFilter.Effort,
            is ReviewFilter.Tag -> null
        }

        return resolveReviewNotificationFilterPlan(
            selectedReviewFilter = selectedReviewFilter,
            activeReviewTagNames = loadActiveReviewTagNames(workspaceId = workspaceId),
            selectedDeckFilterDefinition = selectedDeckFilterDefinition
        )
    }

    private suspend fun loadCurrentWorkspaceDeckFilterDefinitionOrNull(
        workspaceId: String,
        deckId: String
    ): DeckFilterDefinition? {
        val deck = database.deckDao().loadDeck(deckId = deckId) ?: return null
        if (deck.workspaceId != workspaceId || deck.deletedAtMillis != null) {
            return null
        }

        return decodeDeckFilterDefinitionJson(filterDefinitionJson = deck.filterDefinitionJson)
    }

    private suspend fun loadCurrentAllCardsReviewNotificationCard(
        workspaceId: String,
        nowMillis: Long
    ): CurrentReviewNotificationCard? {
        val card = loadTopActiveReviewCard(
            reviewCardSelectionDao = database.reviewCardSelectionDao(),
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = emptyList(),
            tagNames = emptyList()
        ) ?: return null

        return CurrentReviewNotificationCard(
            reviewFilter = makePersistedReviewFilter(reviewFilter = ReviewFilter.AllCards),
            cardId = card.cardId,
            frontText = card.frontText
        )
    }

    private suspend fun loadCurrentDeckReviewNotificationCard(
        workspaceId: String,
        deckId: String,
        nowMillis: Long
    ): CurrentReviewNotificationCard? {
        val deck = database.deckDao().loadDeck(deckId = deckId)
        if (deck == null || deck.workspaceId != workspaceId || deck.deletedAtMillis != null) {
            return loadCurrentAllCardsReviewNotificationCard(
                workspaceId = workspaceId,
                nowMillis = nowMillis
            )
        }

        val filterDefinition = decodeDeckFilterDefinitionJson(filterDefinitionJson = deck.filterDefinitionJson)
        val card = loadCurrentDeckReviewCardEntity(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            filterDefinition = filterDefinition
        ) ?: return null

        return CurrentReviewNotificationCard(
            reviewFilter = makePersistedReviewFilter(reviewFilter = ReviewFilter.Deck(deckId = deck.deckId)),
            cardId = card.cardId,
            frontText = card.frontText
        )
    }

    private suspend fun loadCurrentEffortReviewNotificationCard(
        workspaceId: String,
        effortLevel: EffortLevel,
        nowMillis: Long
    ): CurrentReviewNotificationCard? {
        val card = loadTopActiveReviewCard(
            reviewCardSelectionDao = database.reviewCardSelectionDao(),
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = listOf(effortLevel),
            tagNames = emptyList()
        ) ?: return null

        return CurrentReviewNotificationCard(
            reviewFilter = makePersistedReviewFilter(
                reviewFilter = ReviewFilter.Effort(effortLevel = effortLevel)
            ),
            cardId = card.cardId,
            frontText = card.frontText
        )
    }

    private suspend fun loadCurrentTagReviewNotificationCard(
        workspaceId: String,
        tag: String,
        nowMillis: Long
    ): CurrentReviewNotificationCard? {
        val exactTagNames = loadExactStoredReviewTagNames(
            workspaceId = workspaceId,
            requestedTagNames = listOf(tag)
        )
        if (exactTagNames.isEmpty()) {
            return loadCurrentAllCardsReviewNotificationCard(
                workspaceId = workspaceId,
                nowMillis = nowMillis
            )
        }

        val card = loadTopActiveReviewCard(
            reviewCardSelectionDao = database.reviewCardSelectionDao(),
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = emptyList(),
            tagNames = exactTagNames
        ) ?: return null

        return CurrentReviewNotificationCard(
            reviewFilter = makePersistedReviewFilter(reviewFilter = ReviewFilter.Tag(tag = tag)),
            cardId = card.cardId,
            frontText = card.frontText
        )
    }

    private suspend fun loadCurrentDeckReviewCardEntity(
        workspaceId: String,
        nowMillis: Long,
        filterDefinition: DeckFilterDefinition
    ): CardEntity? {
        val exactTagNames = loadExactStoredReviewTagNames(
            workspaceId = workspaceId,
            requestedTagNames = filterDefinition.tags
        )
        val hasTagPredicate = filterDefinition.tags.isNotEmpty()
        if (hasTagPredicate && exactTagNames.isEmpty()) {
            return null
        }

        return when {
            filterDefinition.effortLevels.isEmpty() && hasTagPredicate.not() -> {
                loadTopActiveReviewCard(
                    reviewCardSelectionDao = database.reviewCardSelectionDao(),
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = emptyList(),
                    tagNames = emptyList()
                )
            }

            filterDefinition.effortLevels.isNotEmpty() && hasTagPredicate.not() -> {
                loadTopActiveReviewCard(
                    reviewCardSelectionDao = database.reviewCardSelectionDao(),
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = filterDefinition.effortLevels,
                    tagNames = emptyList()
                )
            }

            filterDefinition.effortLevels.isEmpty() -> {
                loadTopActiveReviewCard(
                    reviewCardSelectionDao = database.reviewCardSelectionDao(),
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = emptyList(),
                    tagNames = exactTagNames
                )
            }

            else -> {
                loadTopActiveReviewCard(
                    reviewCardSelectionDao = database.reviewCardSelectionDao(),
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = filterDefinition.effortLevels,
                    tagNames = exactTagNames
                )
            }
        }
    }

    private suspend fun loadExactStoredReviewTagNames(
        workspaceId: String,
        requestedTagNames: List<String>
    ): List<String> {
        return resolveExactStoredReviewTagNames(
            requestedTagNames = requestedTagNames,
            storedTagNames = loadActiveReviewTagNames(workspaceId = workspaceId)
        )
    }

    private suspend fun loadActiveReviewTagNames(workspaceId: String): List<String> {
        return database.tagDao().loadReviewTagNames(workspaceId = workspaceId)
    }
}

internal sealed interface ReviewNotificationFilterPlan {
    data class Schedule(
        val reviewFilter: ReviewFilter
    ) : ReviewNotificationFilterPlan

    data object SuppressScheduledPayloads : ReviewNotificationFilterPlan
}

internal fun resolveReviewNotificationFilterPlan(
    selectedReviewFilter: ReviewFilter,
    activeReviewTagNames: List<String>,
    selectedDeckFilterDefinition: DeckFilterDefinition?
): ReviewNotificationFilterPlan {
    return when (selectedReviewFilter) {
        ReviewFilter.AllCards -> ReviewNotificationFilterPlan.Schedule(reviewFilter = ReviewFilter.AllCards)
        is ReviewFilter.Effort -> ReviewNotificationFilterPlan.Schedule(reviewFilter = selectedReviewFilter)
        is ReviewFilter.Tag -> {
            val exactTagName = resolveExactStoredReviewTagNames(
                requestedTagNames = listOf(selectedReviewFilter.tag),
                storedTagNames = activeReviewTagNames
            ).firstOrNull()
            val resolvedReviewFilter = exactTagName?.let { tagName ->
                ReviewFilter.Tag(tag = tagName)
            } ?: ReviewFilter.AllCards

            ReviewNotificationFilterPlan.Schedule(reviewFilter = resolvedReviewFilter)
        }

        is ReviewFilter.Deck -> {
            if (selectedDeckFilterDefinition == null) {
                return ReviewNotificationFilterPlan.Schedule(reviewFilter = ReviewFilter.AllCards)
            }

            if (hasImpossibleStoredTagDeckPredicate(
                    filterDefinition = selectedDeckFilterDefinition,
                    storedTagNames = activeReviewTagNames
                )
            ) {
                ReviewNotificationFilterPlan.SuppressScheduledPayloads
            } else {
                ReviewNotificationFilterPlan.Schedule(reviewFilter = selectedReviewFilter)
            }
        }
    }
}

internal fun hasImpossibleStoredTagDeckPredicate(
    filterDefinition: DeckFilterDefinition,
    storedTagNames: List<String>
): Boolean {
    return filterDefinition.tags.isNotEmpty() && resolveExactStoredReviewTagNames(
        requestedTagNames = filterDefinition.tags,
        storedTagNames = storedTagNames
    ).isEmpty()
}

internal fun resolveExactStoredReviewTagNames(
    requestedTagNames: List<String>,
    storedTagNames: List<String>
): List<String> {
    val requestedTagKeys: List<String> = requestedTagNames.map { tagName ->
        normalizeTagKey(tag = tagName)
    }.filter { tagKey ->
        tagKey.isNotEmpty()
    }.distinct()
    if (requestedTagKeys.isEmpty()) {
        return emptyList()
    }

    val requestedTagKeySet: Set<String> = requestedTagKeys.toSet()
    return storedTagNames.filter { storedTagName ->
        requestedTagKeySet.contains(normalizeTagKey(tag = storedTagName))
    }.distinct()
}

fun hasNotificationPermission(context: Context): Boolean {
    return ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
}

fun reviewNotificationWorkspaceTag(workspaceId: String): String {
    return "review-notification::$workspaceId"
}

internal fun parseAppNotificationTapRequest(
    getStringExtra: (String) -> String?
): AppNotificationTapRequest? {
    val rawNotificationType = getStringExtra("$appNotificationTapExtraPrefix::$appNotificationTapTypeDataKey")
        ?: return null
    val notificationType = AppNotificationTapType.fromRawValue(rawValue = rawNotificationType)
    if (notificationType == null) {
        logAppNotificationTapFallback(
            fallback = AppNotificationTapFallback(
                stage = "parse",
                reason = "unsupported_notification_type",
                notificationType = rawNotificationType,
                details = null
            )
        )
        return null
    }

    return AppNotificationTapRequest(type = notificationType)
}

fun parseAppNotificationTapRequest(intent: android.content.Intent): AppNotificationTapRequest? {
    return parseAppNotificationTapRequest(getStringExtra = intent::getStringExtra)
}

internal fun consumeAppNotificationTapRequest(
    getStringExtra: (String) -> String?,
    removeExtra: (String) -> Unit
): AppNotificationTapRequest? {
    val request = parseAppNotificationTapRequest(getStringExtra = getStringExtra) ?: return null
    clearAppNotificationTapExtras(removeExtra = removeExtra)
    return request
}

fun consumeAppNotificationTapRequest(intent: android.content.Intent): AppNotificationTapRequest? {
    return consumeAppNotificationTapRequest(
        getStringExtra = intent::getStringExtra,
        removeExtra = intent::removeExtra
    )
}

private fun clearAppNotificationTapExtras(removeExtra: (String) -> Unit) {
    appNotificationTapIntentExtraKeys.forEach(removeExtra)
}
