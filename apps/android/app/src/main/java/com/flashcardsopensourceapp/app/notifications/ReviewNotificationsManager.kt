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
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.notifications.DailyReviewNotificationsSettings
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.decodeDeckFilterDefinitionJson
import com.flashcardsopensourceapp.data.local.model.normalizeTags
import com.flashcardsopensourceapp.data.local.model.normalizeTagKey
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.notifications.CurrentReviewNotificationCard
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationMode
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsSettings
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.ScheduledReviewNotificationPayload
import com.flashcardsopensourceapp.data.local.notifications.buildDailyReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.buildInactivityReminderPayloads
import com.flashcardsopensourceapp.data.local.notifications.decodePersistedReviewFilter
import com.flashcardsopensourceapp.data.local.notifications.makePersistedReviewFilter
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.repository.loadCurrentWorkspaceOrNull
import com.flashcardsopensourceapp.feature.review.ReviewNotificationTapPayload
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
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
private val reviewNotificationTapIntentExtraKeys: List<String> = listOf(
    "$reviewNotificationTapExtraPrefix::$reviewNotificationWorkspaceIdDataKey",
    "$reviewNotificationTapExtraPrefix::$reviewNotificationCardIdDataKey",
    "$reviewNotificationTapExtraPrefix::$reviewNotificationFrontTextDataKey",
    "$reviewNotificationTapExtraPrefix::$reviewNotificationRequestIdDataKey",
    "$reviewNotificationTapExtraPrefix::$reviewNotificationFilterKindDataKey",
    "$reviewNotificationTapExtraPrefix::$reviewNotificationFilterDeckIdDataKey",
    "$reviewNotificationTapExtraPrefix::$reviewNotificationFilterTagDataKey"
)

class ReviewNotificationsManager(
    private val context: Context,
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
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
            val workspace = loadCurrentWorkspaceOrNull(
                database = database,
                preferencesStore = preferencesStore
            ) ?: return@launch
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
            val workspace = loadCurrentWorkspaceOrNull(
                database = database,
                preferencesStore = preferencesStore
            ) ?: return@launch
            cancelWorkspaceScheduling(workspaceId = workspace.workspaceId)
        }
    }

    private suspend fun rescheduleCurrentWorkspace(nowMillis: Long) {
        val workspace = loadCurrentWorkspaceOrNull(
            database = database,
            preferencesStore = preferencesStore
        ) ?: return
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

        val currentCard = loadCurrentReviewNotificationCard(
            workspaceId = workspace.workspaceId,
            nowMillis = nowMillis
        )
        if (currentCard == null) {
            reviewNotificationsStore.saveScheduledPayloads(workspaceId = workspace.workspaceId, payloads = emptyList())
            return
        }

        val zoneId = ZoneId.systemDefault()
        val payloads = when (settings.selectedMode) {
            ReviewNotificationMode.DAILY -> buildDailyReminderPayloads(
                workspaceId = workspace.workspaceId,
                currentCard = currentCard,
                nowMillis = nowMillis,
                zoneId = zoneId,
                settings = settings.daily
            )

            ReviewNotificationMode.INACTIVITY -> {
                val lastActiveAtMillis = reviewNotificationsStore.loadLastActiveAtMillis() ?: nowMillis
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

    private suspend fun loadCurrentReviewNotificationCard(
        workspaceId: String,
        nowMillis: Long
    ): CurrentReviewNotificationCard? {
        val selectedFilter = reviewPreferencesStore.loadSelectedReviewFilter(workspaceId = workspaceId)

        return when (selectedFilter) {
            ReviewFilter.AllCards -> loadCurrentAllCardsReviewNotificationCard(
                workspaceId = workspaceId,
                nowMillis = nowMillis
            )
            is ReviewFilter.Deck -> loadCurrentDeckReviewNotificationCard(
                workspaceId = workspaceId,
                deckId = selectedFilter.deckId,
                nowMillis = nowMillis
            )
            is ReviewFilter.Tag -> loadCurrentTagReviewNotificationCard(
                workspaceId = workspaceId,
                tag = selectedFilter.tag,
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

fun consumeReviewNotificationTapPayload(intent: android.content.Intent): ReviewNotificationTapPayload? {
    val payload = parseReviewNotificationTapPayload(intent = intent) ?: return null
    clearReviewNotificationTapExtras(intent = intent)
    return payload
}

private fun clearReviewNotificationTapExtras(intent: android.content.Intent) {
    reviewNotificationTapIntentExtraKeys.forEach(intent::removeExtra)
}
