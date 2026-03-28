package com.flashcardsopensourceapp.app.notifications

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.notifications.DailyReviewNotificationsSettings
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.decodeDeckFilterDefinitionJson
import com.flashcardsopensourceapp.data.local.model.decodeSchedulerStepListJson
import com.flashcardsopensourceapp.data.local.model.isCardDue
import com.flashcardsopensourceapp.data.local.model.isNewCard
import com.flashcardsopensourceapp.data.local.model.isReviewedCard
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.matchesDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.normalizeTags
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationMode
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsSettings
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.ScheduledReviewNotificationPayload
import com.flashcardsopensourceapp.data.local.notifications.buildDailyReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.buildInactivityReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.decodePersistedReviewFilter
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.feature.review.ReviewNotificationTapPayload
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.util.concurrent.TimeUnit

const val reviewNotificationChannelId: String = "review-reminders"
const val reviewNotificationWorkspaceIdDataKey: String = "workspaceId"
const val reviewNotificationCardIdDataKey: String = "cardId"
const val reviewNotificationFrontTextDataKey: String = "frontText"
const val reviewNotificationRequestIdDataKey: String = "requestId"
const val reviewNotificationFilterKindDataKey: String = "reviewFilterKind"
const val reviewNotificationFilterDeckIdDataKey: String = "reviewFilterDeckId"
const val reviewNotificationFilterTagDataKey: String = "reviewFilterTag"
const val reviewNotificationTapExtraPrefix: String = "review-notification-extra"

class ReviewNotificationsManager(
    private val context: Context,
    private val database: AppDatabase,
    private val reviewPreferencesStore: ReviewPreferencesStore,
    private val reviewNotificationsStore: ReviewNotificationsStore
) {
    private val workManager: WorkManager = WorkManager.getInstance(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun markAppResumed(nowMillis: Long) {
        reviewNotificationsStore.saveLastActiveAtMillis(timestampMillis = nowMillis)
        refreshCurrentWorkspaceScheduling(nowMillis = nowMillis)
    }

    fun markAppPaused(nowMillis: Long) {
        refreshCurrentWorkspaceScheduling(nowMillis = nowMillis)
    }

    fun refreshCurrentWorkspaceScheduling(nowMillis: Long = System.currentTimeMillis()) {
        scope.launch {
            rescheduleCurrentWorkspace(nowMillis = nowMillis)
        }
    }

    fun enableDefaultDailyForCurrentWorkspace() {
        scope.launch {
            val workspace = database.workspaceDao().loadWorkspace() ?: return@launch
            val currentSettings = reviewNotificationsStore.loadSettings(workspaceId = workspace.workspaceId)
            reviewNotificationsStore.saveSettings(
                workspaceId = workspace.workspaceId,
                settings = ReviewNotificationsSettings(
                    isEnabled = true,
                    selectedMode = ReviewNotificationMode.DAILY,
                    daily = DailyReviewNotificationsSettings(
                        hour = com.flashcardsopensourceapp.data.local.notifications.defaultDailyReminderHour,
                        minute = com.flashcardsopensourceapp.data.local.notifications.defaultDailyReminderMinute
                    ),
                    inactivity = currentSettings.inactivity
                )
            )
            rescheduleCurrentWorkspace(nowMillis = System.currentTimeMillis())
        }
    }

    fun cancelCurrentWorkspaceScheduling() {
        scope.launch {
            val workspace = database.workspaceDao().loadWorkspace() ?: return@launch
            cancelWorkspaceScheduling(workspaceId = workspace.workspaceId)
        }
    }

    private suspend fun rescheduleCurrentWorkspace(nowMillis: Long) {
        val workspace = database.workspaceDao().loadWorkspace() ?: return
        cancelWorkspaceScheduling(workspaceId = workspace.workspaceId)

        val settings = reviewNotificationsStore.loadSettings(workspaceId = workspace.workspaceId)
        if (settings.isEnabled.not()) {
            reviewNotificationsStore.saveScheduledPayloads(workspaceId = workspace.workspaceId, payloads = emptyList())
            return
        }
        if (hasNotificationPermission(context = context).not()) {
            reviewNotificationsStore.saveScheduledPayloads(workspaceId = workspace.workspaceId, payloads = emptyList())
            return
        }

        val schedulerSettingsEntity = database.workspaceSchedulerSettingsDao()
            .loadWorkspaceSchedulerSettings(workspaceId = workspace.workspaceId)
        val schedulerSettings = schedulerSettingsEntity?.let { entity ->
            WorkspaceSchedulerSettings(
                workspaceId = entity.workspaceId,
                algorithm = entity.algorithm,
                desiredRetention = entity.desiredRetention,
                learningStepsMinutes = decodeSchedulerStepListJson(entity.learningStepsMinutesJson),
                relearningStepsMinutes = decodeSchedulerStepListJson(entity.relearningStepsMinutesJson),
                maximumIntervalDays = entity.maximumIntervalDays,
                enableFuzz = entity.enableFuzz,
                updatedAtMillis = entity.updatedAtMillis
            )
        } ?: makeDefaultWorkspaceSchedulerSettings(
            workspaceId = workspace.workspaceId,
            updatedAtMillis = nowMillis
        )
        val cards = database.cardDao().observeCardsWithRelations().first()
            .map(::toCardSummary)
            .filter { card -> card.deletedAtMillis == null }
        val decks = database.deckDao().observeDecks().first()
            .filter { deck -> deck.deletedAtMillis == null }
            .map { deck ->
                toDeckSummary(
                    deck = deck,
                    cards = cards,
                    nowMillis = nowMillis
                )
            }
        val selectedFilter = reviewPreferencesStore.loadSelectedReviewFilter(workspaceId = workspace.workspaceId)
        val zoneId = ZoneId.systemDefault()
        val payloads = when (settings.selectedMode) {
            ReviewNotificationMode.DAILY -> buildDailyReminderPayloads(
                workspaceId = workspace.workspaceId,
                reviewFilter = selectedFilter,
                schedulerSettings = schedulerSettings,
                cards = cards,
                decks = decks,
                nowMillis = nowMillis,
                zoneId = zoneId,
                settings = settings.daily
            )

            ReviewNotificationMode.INACTIVITY -> {
                val lastActiveAtMillis = reviewNotificationsStore.loadLastActiveAtMillis() ?: nowMillis
                buildInactivityReminderPayloads(
                    workspaceId = workspace.workspaceId,
                    reviewFilter = selectedFilter,
                    schedulerSettings = schedulerSettings,
                    cards = cards,
                    decks = decks,
                    nowMillis = nowMillis,
                    lastActiveAtMillis = lastActiveAtMillis,
                    zoneId = zoneId,
                    settings = settings.inactivity
                )
            }
        }

        payloads.forEach { payload ->
            enqueuePayload(payload = payload, nowMillis = nowMillis)
        }
        reviewNotificationsStore.saveScheduledPayloads(workspaceId = workspace.workspaceId, payloads = payloads)
    }

    private fun enqueuePayload(payload: ScheduledReviewNotificationPayload, nowMillis: Long) {
        val delayMillis = maxOf(1L, payload.scheduledAtMillis - nowMillis)
        val inputData = Data.Builder()
            .putString(reviewNotificationWorkspaceIdDataKey, payload.workspaceId)
            .putString(reviewNotificationCardIdDataKey, payload.cardId)
            .putString(reviewNotificationFrontTextDataKey, payload.frontText)
            .putString(reviewNotificationRequestIdDataKey, payload.requestId)
            .putString(reviewNotificationFilterKindDataKey, payload.reviewFilter.kind)
            .putString(reviewNotificationFilterDeckIdDataKey, payload.reviewFilter.deckId)
            .putString(reviewNotificationFilterTagDataKey, payload.reviewFilter.tag)
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
            .addTag("review-notification")
            .build()

        workManager.enqueueUniqueWork(
            payload.requestId,
            ExistingWorkPolicy.REPLACE,
            request
        )
    }

    private fun cancelWorkspaceScheduling(workspaceId: String) {
        workManager.cancelAllWorkByTag(reviewNotificationWorkspaceTag(workspaceId = workspaceId))
        reviewNotificationsStore.saveScheduledPayloads(workspaceId = workspaceId, payloads = emptyList())
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

fun parseReviewNotificationTapPayload(intent: android.content.Intent): ReviewNotificationTapPayload? {
    val workspaceId = intent.getStringExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationWorkspaceIdDataKey")
        ?: return null
    val cardId = intent.getStringExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationCardIdDataKey")
        ?: return null
    val frontText = intent.getStringExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationFrontTextDataKey")
        ?: return null
    val requestId = intent.getStringExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationRequestIdDataKey")
        ?: return null
    val filterKind = intent.getStringExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationFilterKindDataKey")
        ?: return null
    val persistedFilter = com.flashcardsopensourceapp.data.local.notifications.PersistedReviewFilter(
        kind = filterKind,
        deckId = intent.getStringExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationFilterDeckIdDataKey"),
        tag = intent.getStringExtra("$reviewNotificationTapExtraPrefix::$reviewNotificationFilterTagDataKey")
    )

    return ReviewNotificationTapPayload(
        workspaceId = workspaceId,
        cardId = cardId,
        requestId = requestId,
        frontText = frontText,
        reviewFilter = decodePersistedReviewFilter(filter = persistedFilter)
    )
}

private fun toCardSummary(card: CardWithRelations): CardSummary {
    return CardSummary(
        cardId = card.card.cardId,
        workspaceId = card.card.workspaceId,
        frontText = card.card.frontText,
        backText = card.card.backText,
        tags = normalizeTags(
            values = card.tags.map { tag -> tag.name },
            referenceTags = emptyList()
        ),
        effortLevel = card.card.effortLevel,
        dueAtMillis = card.card.dueAtMillis,
        createdAtMillis = card.card.createdAtMillis,
        updatedAtMillis = card.card.updatedAtMillis,
        reps = card.card.reps,
        lapses = card.card.lapses,
        fsrsCardState = card.card.fsrsCardState,
        fsrsStepIndex = card.card.fsrsStepIndex,
        fsrsStability = card.card.fsrsStability,
        fsrsDifficulty = card.card.fsrsDifficulty,
        fsrsLastReviewedAtMillis = card.card.fsrsLastReviewedAtMillis,
        fsrsScheduledDays = card.card.fsrsScheduledDays,
        deletedAtMillis = card.card.deletedAtMillis
    )
}

private fun toDeckSummary(
    deck: DeckEntity,
    cards: List<CardSummary>,
    nowMillis: Long
): DeckSummary {
    val filterDefinition = decodeDeckFilterDefinitionJson(filterDefinitionJson = deck.filterDefinitionJson)
    val matchingCards = cards.filter { card ->
        matchesDeckFilterDefinition(filterDefinition = filterDefinition, card = card)
    }

    return DeckSummary(
        deckId = deck.deckId,
        workspaceId = deck.workspaceId,
        name = deck.name,
        filterDefinition = filterDefinition,
        totalCards = matchingCards.size,
        dueCards = matchingCards.count { card ->
            isCardDue(card = card, nowMillis = nowMillis)
        },
        newCards = matchingCards.count(::isNewCard),
        reviewedCards = matchingCards.count(::isReviewedCard),
        createdAtMillis = deck.createdAtMillis,
        updatedAtMillis = deck.updatedAtMillis
    )
}
