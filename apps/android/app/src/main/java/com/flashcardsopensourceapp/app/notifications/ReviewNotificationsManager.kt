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
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.decodeDeckFilterDefinitionJson
import com.flashcardsopensourceapp.data.local.model.normalizeTagKey
import com.flashcardsopensourceapp.data.local.model.normalizeTags
import com.flashcardsopensourceapp.data.local.notifications.CurrentReviewNotificationCard
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationMode
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.ScheduledReviewNotificationPayload
import com.flashcardsopensourceapp.data.local.notifications.buildFallbackDailyReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.buildFallbackInactivityReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.buildDailyReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.buildInactivityReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.makePersistedReviewFilter
import com.flashcardsopensourceapp.data.local.repository.loadCurrentWorkspaceOrNull
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.feature.review.reviewTextProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

const val reviewNotificationChannelId: String = "review-reminders"
const val reviewNotificationFrontTextDataKey: String = "frontText"
const val reviewNotificationRequestIdDataKey: String = "requestId"
const val reviewNotificationWorkTag: String = "review-notification"

class ReviewNotificationsManager(
    private val context: Context,
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val reviewPreferencesStore: ReviewPreferencesStore,
    private val reviewNotificationsStore: ReviewNotificationsStore
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

        clearCurrentWorkspaceReviewScheduling(workspaceId = workspace.workspaceId)

        val settings = reviewNotificationsStore.loadSettings(workspaceId = workspace.workspaceId)
        if (settings.isEnabled.not()) {
            reviewNotificationsStore.saveScheduledPayloads(
                workspaceId = workspace.workspaceId,
                payloads = emptyList()
            )
            return
        }
        if (hasNotificationPermission(context = context).not()) {
            // Keep the internal setting enabled; Android permission alone gates delivery.
            reviewNotificationsStore.saveScheduledPayloads(
                workspaceId = workspace.workspaceId,
                payloads = emptyList()
            )
            return
        }
        if (isLatestReconcileGeneration(generation = generation).not()) {
            return
        }

        val selectedReviewFilter = reviewPreferencesStore.loadSelectedReviewFilter(
            workspaceId = workspace.workspaceId
        )
        val currentCard = loadCurrentReviewNotificationCard(
            workspaceId = workspace.workspaceId,
            reviewFilter = selectedReviewFilter,
            nowMillis = nowMillis
        )

        val zoneId = ZoneId.systemDefault()
        val payloads = if (currentCard != null) {
            when (settings.selectedMode) {
                ReviewNotificationMode.DAILY -> buildDailyReminderPayloads(
                    workspaceId = workspace.workspaceId,
                    currentCard = currentCard,
                    nowMillis = nowMillis,
                    zoneId = zoneId,
                    settings = settings.daily
                )

                ReviewNotificationMode.INACTIVITY -> {
                    val lastActiveAtMillis = reviewNotificationsStore.loadLastActiveAtMillis()
                        ?: return reviewNotificationsStore.saveScheduledPayloads(
                            workspaceId = workspace.workspaceId,
                            payloads = emptyList()
                        )
                    buildInactivityReminderPayloads(
                        workspaceId = workspace.workspaceId,
                        currentCard = currentCard,
                        nowMillis = nowMillis,
                        lastActiveAtMillis = lastActiveAtMillis,
                        zoneId = zoneId,
                        settings = settings.inactivity
                    )
                }
            }
        } else {
            val persistedReviewFilter = makePersistedReviewFilter(reviewFilter = selectedReviewFilter)
            val fallbackFrontText = reviewTextProvider(context = context).notificationFallbackFrontText
            when (settings.selectedMode) {
                ReviewNotificationMode.DAILY -> buildFallbackDailyReminderPayloads(
                    workspaceId = workspace.workspaceId,
                    reviewFilter = persistedReviewFilter,
                    fallbackFrontText = fallbackFrontText,
                    nowMillis = nowMillis,
                    zoneId = zoneId,
                    settings = settings.daily
                )

                ReviewNotificationMode.INACTIVITY -> {
                    val lastActiveAtMillis = reviewNotificationsStore.loadLastActiveAtMillis()
                        ?: return reviewNotificationsStore.saveScheduledPayloads(
                            workspaceId = workspace.workspaceId,
                            payloads = emptyList()
                        )
                    buildFallbackInactivityReminderPayloads(
                        workspaceId = workspace.workspaceId,
                        reviewFilter = persistedReviewFilter,
                        fallbackFrontText = fallbackFrontText,
                        nowMillis = nowMillis,
                        lastActiveAtMillis = lastActiveAtMillis,
                        zoneId = zoneId,
                        settings = settings.inactivity
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
            workspaceId = workspace.workspaceId,
            payloads = payloads
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
     */
    private fun clearDeliveredReviewReminderNotifications() {
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

    private fun enqueuePayload(payload: ScheduledReviewNotificationPayload, nowMillis: Long) {
        val delayMillis = maxOf(1L, payload.scheduledAtMillis - nowMillis)
        val inputData = Data.Builder()
            .putString(reviewNotificationFrontTextDataKey, payload.frontText)
            .putString(reviewNotificationRequestIdDataKey, payload.requestId)
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
        )
    }

    private fun clearCurrentWorkspaceReviewScheduling(workspaceId: String) {
        workManager.cancelAllWorkByTag(reviewNotificationWorkTag)
        reviewNotificationsStore.saveScheduledPayloads(workspaceId = workspaceId, payloads = emptyList())
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

    private suspend fun loadCurrentAllCardsReviewNotificationCard(
        workspaceId: String,
        nowMillis: Long
    ): CurrentReviewNotificationCard? {
        val card = database.cardDao().loadTopReviewCard(
            workspaceId = workspaceId,
            nowMillis = nowMillis
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
        if (deck == null || deck.deletedAtMillis != null) {
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
        val card = database.cardDao().loadTopReviewCardByEffortLevels(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = listOf(effortLevel)
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
        val hasTag = database.tagDao().hasTag(
            workspaceId = workspaceId,
            tagName = tag
        )
        if (hasTag.not()) {
            return loadCurrentAllCardsReviewNotificationCard(
                workspaceId = workspaceId,
                nowMillis = nowMillis
            )
        }

        val card = database.cardDao().loadTopReviewCardByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            normalizedTagNames = listOf(normalizeTagKey(tag = tag))
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
    ): com.flashcardsopensourceapp.data.local.database.CardEntity? {
        val normalizedTagNames = normalizeTags(
            values = filterDefinition.tags,
            referenceTags = emptyList()
        ).map { tag ->
            normalizeTagKey(tag = tag)
        }

        return when {
            filterDefinition.effortLevels.isEmpty() && normalizedTagNames.isEmpty() -> {
                database.cardDao().loadTopReviewCard(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis
                )
            }

            filterDefinition.effortLevels.isNotEmpty() && normalizedTagNames.isEmpty() -> {
                database.cardDao().loadTopReviewCardByEffortLevels(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = filterDefinition.effortLevels
                )
            }

            filterDefinition.effortLevels.isEmpty() && normalizedTagNames.isNotEmpty() -> {
                database.cardDao().loadTopReviewCardByAnyTags(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    normalizedTagNames = normalizedTagNames
                )
            }

            else -> {
                database.cardDao().loadTopReviewCardByEffortLevelsAndAnyTags(
                    workspaceId = workspaceId,
                    nowMillis = nowMillis,
                    effortLevels = filterDefinition.effortLevels,
                    normalizedTagNames = normalizedTagNames
                )
            }
        }
    }
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
