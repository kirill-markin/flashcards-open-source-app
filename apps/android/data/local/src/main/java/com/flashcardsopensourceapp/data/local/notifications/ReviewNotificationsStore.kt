package com.flashcardsopensourceapp.data.local.notifications

import android.content.Context
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import org.json.JSONArray
import org.json.JSONObject

const val reviewNotificationPermissionPromptThreshold: Int = 3
const val defaultDailyReminderHour: Int = 10
const val defaultDailyReminderMinute: Int = 0
const val dailyReminderSchedulingHorizonDays: Int = 7
const val defaultInactivityReminderWindowEndHour: Int = 19
const val defaultInactivityReminderWindowEndMinute: Int = 0

private const val reviewNotificationsPreferencesName: String = "flashcards-review-notifications"
private const val reviewNotificationsSettingsKeyPrefix: String = "review-notifications-settings::"
private const val reviewNotificationsScheduledPayloadsKeyPrefix: String = "review-notifications-scheduled-payloads::"
private const val reviewNotificationsPromptStateKey: String = "review-notifications-prompt-state"
private const val reviewNotificationsSuccessfulReviewCountKey: String = "review-notifications-successful-review-count"
private const val reviewNotificationsLastActiveAtKey: String = "review-notifications-last-active-at"
private const val reviewNotificationsModeDaily: String = "daily"
private const val reviewNotificationsModeInactivity: String = "inactivity"
private const val reviewFilterKindKey: String = "kind"
private const val reviewFilterDeckIdKey: String = "deckId"
private const val reviewFilterEffortLevelKey: String = "effortLevel"
private const val reviewFilterTagKey: String = "tag"
private const val reviewFilterAllCardsKind: String = "allCards"
private const val reviewFilterDeckKind: String = "deck"
private const val reviewFilterEffortKind: String = "effort"
private const val reviewFilterTagKind: String = "tag"

enum class ReviewNotificationMode {
    DAILY,
    INACTIVITY
}

data class DailyReviewNotificationsSettings(
    val hour: Int,
    val minute: Int
)

data class InactivityReviewNotificationsSettings(
    val windowStartHour: Int,
    val windowStartMinute: Int,
    val windowEndHour: Int,
    val windowEndMinute: Int,
    val idleMinutes: Int
)

data class ReviewNotificationsSettings(
    val isEnabled: Boolean,
    val selectedMode: ReviewNotificationMode,
    val daily: DailyReviewNotificationsSettings,
    val inactivity: InactivityReviewNotificationsSettings
)

data class NotificationPermissionPromptState(
    val hasShownPrePrompt: Boolean,
    val hasRequestedSystemPermission: Boolean,
    val hasDismissedPrePrompt: Boolean
)

data class PersistedReviewFilter(
    val kind: String,
    val deckId: String?,
    val effortLevel: String?,
    val tag: String?
)

data class ScheduledReviewNotificationPayload(
    val workspaceId: String,
    val reviewFilter: PersistedReviewFilter,
    val cardId: String?,
    val frontText: String,
    val scheduledAtMillis: Long,
    val requestId: String
)

data class CurrentReviewNotificationCard(
    val reviewFilter: PersistedReviewFilter,
    val cardId: String,
    val frontText: String
)

fun defaultReviewNotificationsSettings(): ReviewNotificationsSettings {
    return ReviewNotificationsSettings(
        isEnabled = false,
        selectedMode = ReviewNotificationMode.DAILY,
        daily = DailyReviewNotificationsSettings(
            hour = defaultDailyReminderHour,
            minute = defaultDailyReminderMinute
        ),
        inactivity = InactivityReviewNotificationsSettings(
            windowStartHour = defaultDailyReminderHour,
            windowStartMinute = defaultDailyReminderMinute,
            windowEndHour = defaultInactivityReminderWindowEndHour,
            windowEndMinute = defaultInactivityReminderWindowEndMinute,
            idleMinutes = 120
        )
    )
}

fun defaultNotificationPermissionPromptState(): NotificationPermissionPromptState {
    return NotificationPermissionPromptState(
        hasShownPrePrompt = false,
        hasRequestedSystemPermission = false,
        hasDismissedPrePrompt = false
    )
}

interface ReviewNotificationsStore {
    fun loadSettings(workspaceId: String): ReviewNotificationsSettings
    fun saveSettings(workspaceId: String, settings: ReviewNotificationsSettings)
    fun loadPromptState(): NotificationPermissionPromptState
    fun savePromptState(state: NotificationPermissionPromptState)
    fun loadSuccessfulReviewCount(): Int
    fun saveSuccessfulReviewCount(count: Int)
    fun loadLastActiveAtMillis(): Long?
    fun saveLastActiveAtMillis(timestampMillis: Long)
    fun clearLastActiveAtMillis()
    fun loadScheduledPayloads(workspaceId: String): List<ScheduledReviewNotificationPayload>
    fun saveScheduledPayloads(workspaceId: String, payloads: List<ScheduledReviewNotificationPayload>)
}

class SharedPreferencesReviewNotificationsStore(
    context: Context
) : ReviewNotificationsStore {
    private val preferences = context.getSharedPreferences(
        reviewNotificationsPreferencesName,
        Context.MODE_PRIVATE
    )

    override fun loadSettings(workspaceId: String): ReviewNotificationsSettings {
        val rawValue = preferences.getString(makeSettingsKey(workspaceId = workspaceId), null)
            ?: return defaultReviewNotificationsSettings()

        return try {
            decodeSettings(rawValue = rawValue)
        } catch (_: Exception) {
            preferences.edit(commit = true) {
                remove(makeSettingsKey(workspaceId = workspaceId))
            }
            defaultReviewNotificationsSettings()
        }
    }

    override fun saveSettings(workspaceId: String, settings: ReviewNotificationsSettings) {
        preferences.edit(commit = true) {
            putString(
                makeSettingsKey(workspaceId = workspaceId),
                encodeSettings(settings = settings)
            )
        }
    }

    override fun loadPromptState(): NotificationPermissionPromptState {
        val rawValue = preferences.getString(reviewNotificationsPromptStateKey, null)
            ?: return defaultNotificationPermissionPromptState()

        return try {
            decodePromptState(rawValue = rawValue)
        } catch (_: Exception) {
            preferences.edit(commit = true) {
                remove(reviewNotificationsPromptStateKey)
            }
            defaultNotificationPermissionPromptState()
        }
    }

    override fun savePromptState(state: NotificationPermissionPromptState) {
        preferences.edit(commit = true) {
            putString(reviewNotificationsPromptStateKey, encodePromptState(state = state))
        }
    }

    override fun loadSuccessfulReviewCount(): Int {
        return preferences.getInt(reviewNotificationsSuccessfulReviewCountKey, 0)
    }

    override fun saveSuccessfulReviewCount(count: Int) {
        preferences.edit(commit = true) {
            putInt(reviewNotificationsSuccessfulReviewCountKey, count)
        }
    }

    override fun loadLastActiveAtMillis(): Long? {
        if (preferences.contains(reviewNotificationsLastActiveAtKey).not()) {
            return null
        }

        return preferences.getLong(reviewNotificationsLastActiveAtKey, 0L)
    }

    override fun saveLastActiveAtMillis(timestampMillis: Long) {
        preferences.edit(commit = true) {
            putLong(reviewNotificationsLastActiveAtKey, timestampMillis)
        }
    }

    override fun clearLastActiveAtMillis() {
        preferences.edit(commit = true) {
            remove(reviewNotificationsLastActiveAtKey)
        }
    }

    override fun loadScheduledPayloads(workspaceId: String): List<ScheduledReviewNotificationPayload> {
        val rawValue = preferences.getString(makeScheduledPayloadsKey(workspaceId = workspaceId), null)
            ?: return emptyList()

        return try {
            decodeScheduledPayloads(rawValue = rawValue)
        } catch (_: Exception) {
            preferences.edit(commit = true) {
                remove(makeScheduledPayloadsKey(workspaceId = workspaceId))
            }
            emptyList()
        }
    }

    override fun saveScheduledPayloads(workspaceId: String, payloads: List<ScheduledReviewNotificationPayload>) {
        preferences.edit(commit = true) {
            putString(
                makeScheduledPayloadsKey(workspaceId = workspaceId),
                encodeScheduledPayloads(payloads = payloads)
            )
        }
    }
}

fun makePersistedReviewFilter(reviewFilter: ReviewFilter): PersistedReviewFilter {
    return when (reviewFilter) {
        ReviewFilter.AllCards -> PersistedReviewFilter(
            kind = reviewFilterAllCardsKind,
            deckId = null,
            effortLevel = null,
            tag = null
        )

        is ReviewFilter.Deck -> PersistedReviewFilter(
            kind = reviewFilterDeckKind,
            deckId = reviewFilter.deckId,
            effortLevel = null,
            tag = null
        )

        is ReviewFilter.Effort -> PersistedReviewFilter(
            kind = reviewFilterEffortKind,
            deckId = null,
            effortLevel = reviewFilter.effortLevel.name,
            tag = null
        )

        is ReviewFilter.Tag -> PersistedReviewFilter(
            kind = reviewFilterTagKind,
            deckId = null,
            effortLevel = null,
            tag = reviewFilter.tag
        )
    }
}

fun decodePersistedReviewFilter(filter: PersistedReviewFilter): ReviewFilter {
    return when (filter.kind) {
        reviewFilterAllCardsKind -> ReviewFilter.AllCards
        reviewFilterDeckKind -> {
            val deckId = requireNotNull(filter.deckId) {
                "Persisted review filter is missing deckId."
            }
            ReviewFilter.Deck(deckId = deckId)
        }

        reviewFilterEffortKind -> {
            val effortLevel = requireNotNull(filter.effortLevel) {
                "Persisted review filter is missing effortLevel."
            }
            ReviewFilter.Effort(
                effortLevel = decodePersistedEffortLevel(rawValue = effortLevel)
            )
        }

        reviewFilterTagKind -> {
            val tag = requireNotNull(filter.tag) {
                "Persisted review filter is missing tag."
            }
            ReviewFilter.Tag(tag = tag)
        }

        else -> {
            throw IllegalArgumentException("Persisted review filter has an unsupported kind.")
        }
    }
}

fun buildDailyReminderPayloads(
    workspaceId: String,
    currentCard: CurrentReviewNotificationCard,
    nowMillis: Long,
    zoneId: ZoneId,
    settings: DailyReviewNotificationsSettings
): List<ScheduledReviewNotificationPayload> {
    val scheduledAtDateTimes = buildDailyReminderScheduledAtDateTimes(
        nowMillis = nowMillis,
        zoneId = zoneId,
        settings = settings
    )
    return buildScheduledReviewNotificationPayloads(
        workspaceId = workspaceId,
        reviewFilter = currentCard.reviewFilter,
        cardId = currentCard.cardId,
        frontText = currentCard.frontText,
        scheduledAtDateTimes = scheduledAtDateTimes,
        mode = ReviewNotificationMode.DAILY
    )
}

fun buildFallbackDailyReminderPayloads(
    workspaceId: String,
    reviewFilter: PersistedReviewFilter,
    fallbackFrontText: String,
    nowMillis: Long,
    zoneId: ZoneId,
    settings: DailyReviewNotificationsSettings
): List<ScheduledReviewNotificationPayload> {
    val scheduledAtDateTimes = buildDailyReminderScheduledAtDateTimes(
        nowMillis = nowMillis,
        zoneId = zoneId,
        settings = settings
    )
    return buildScheduledReviewNotificationPayloads(
        workspaceId = workspaceId,
        reviewFilter = reviewFilter,
        cardId = null,
        frontText = fallbackFrontText,
        scheduledAtDateTimes = scheduledAtDateTimes,
        mode = ReviewNotificationMode.DAILY
    )
}

fun computeInactivityReminderTimestampMillis(
    settings: InactivityReviewNotificationsSettings,
    lastActiveAtMillis: Long,
    zoneId: ZoneId
): Long? {
    if (settings.idleMinutes <= 0) {
        return null
    }

    val candidate = Instant.ofEpochMilli(lastActiveAtMillis)
        .atZone(zoneId)
        .plusMinutes(settings.idleMinutes.toLong())
    val day = candidate.toLocalDate()
    val windowStart = ZonedDateTime.of(
        day.year,
        day.monthValue,
        day.dayOfMonth,
        settings.windowStartHour,
        settings.windowStartMinute,
        0,
        0,
        zoneId
    )
    val windowEnd = ZonedDateTime.of(
        day.year,
        day.monthValue,
        day.dayOfMonth,
        settings.windowEndHour,
        settings.windowEndMinute,
        0,
        0,
        zoneId
    )

    require(windowStart < windowEnd) {
        "Inactivity reminder window must stay within the same day."
    }

    return when {
        candidate < windowStart -> windowStart.toInstant().toEpochMilli()
        candidate <= windowEnd -> candidate.toInstant().toEpochMilli()
        else -> windowStart.plusDays(1).toInstant().toEpochMilli()
    }
}

fun buildInactivityReminderPayloads(
    workspaceId: String,
    currentCard: CurrentReviewNotificationCard,
    nowMillis: Long,
    lastActiveAtMillis: Long,
    zoneId: ZoneId,
    settings: InactivityReviewNotificationsSettings
): List<ScheduledReviewNotificationPayload> {
    val scheduledAtMillisList = buildInactivityReminderTimestampMillisList(
        settings = settings,
        lastActiveAtMillis = lastActiveAtMillis,
        nowMillis = nowMillis,
        zoneId = zoneId
    )
    if (scheduledAtMillisList.isEmpty()) {
        return emptyList()
    }

    val scheduledAtDateTimes = scheduledAtMillisList.map { scheduledAtMillis ->
        Instant.ofEpochMilli(scheduledAtMillis).atZone(zoneId)
    }
    return buildScheduledReviewNotificationPayloads(
        workspaceId = workspaceId,
        reviewFilter = currentCard.reviewFilter,
        cardId = currentCard.cardId,
        frontText = currentCard.frontText,
        scheduledAtDateTimes = scheduledAtDateTimes,
        mode = ReviewNotificationMode.INACTIVITY
    )
}

fun buildFallbackInactivityReminderPayloads(
    workspaceId: String,
    reviewFilter: PersistedReviewFilter,
    fallbackFrontText: String,
    nowMillis: Long,
    lastActiveAtMillis: Long,
    zoneId: ZoneId,
    settings: InactivityReviewNotificationsSettings
): List<ScheduledReviewNotificationPayload> {
    val scheduledAtMillisList = buildInactivityReminderTimestampMillisList(
        settings = settings,
        lastActiveAtMillis = lastActiveAtMillis,
        nowMillis = nowMillis,
        zoneId = zoneId
    )
    if (scheduledAtMillisList.isEmpty()) {
        return emptyList()
    }

    val scheduledAtDateTimes = scheduledAtMillisList.map { scheduledAtMillis ->
        Instant.ofEpochMilli(scheduledAtMillis).atZone(zoneId)
    }
    return buildScheduledReviewNotificationPayloads(
        workspaceId = workspaceId,
        reviewFilter = reviewFilter,
        cardId = null,
        frontText = fallbackFrontText,
        scheduledAtDateTimes = scheduledAtDateTimes,
        mode = ReviewNotificationMode.INACTIVITY
    )
}

fun buildInactivityReminderTimestampMillisList(
    nowMillis: Long,
    lastActiveAtMillis: Long,
    zoneId: ZoneId,
    settings: InactivityReviewNotificationsSettings
): List<Long> {
    val firstScheduledAtMillis = computeInactivityReminderTimestampMillis(
        settings = settings,
        lastActiveAtMillis = lastActiveAtMillis,
        zoneId = zoneId
    ) ?: return emptyList()

    val firstScheduledAt = Instant.ofEpochMilli(firstScheduledAtMillis).atZone(zoneId)
    val firstScheduledAtDay = firstScheduledAt.toLocalDate()

    return (0 until dailyReminderSchedulingHorizonDays).mapNotNull { dayOffset ->
        val firstScheduledAtForDay = if (dayOffset == 0) {
            firstScheduledAt
        } else {
            val day = firstScheduledAtDay.plusDays(dayOffset.toLong())
            ZonedDateTime.of(
                day.year,
                day.monthValue,
                day.dayOfMonth,
                settings.windowStartHour,
                settings.windowStartMinute,
                0,
                0,
                zoneId
            )
        }

        buildRepeatedInactivityReminderTimestampMillisForDay(
            firstScheduledAt = firstScheduledAtForDay,
            nowMillis = nowMillis,
            settings = settings
        )
    }.flatten()
}

fun makeNotificationRequestId(
    workspaceId: String,
    mode: ReviewNotificationMode,
    suffix: String
): String {
    return "review-notification::$workspaceId::${mode.name.lowercase()}::$suffix"
}

fun makeNotificationRequestSuffix(scheduledAtDateTime: ZonedDateTime): String {
    return scheduledAtDateTime.format(notificationRequestIdDateTimeFormatter)
}

private fun buildRepeatedInactivityReminderTimestampMillisForDay(
    firstScheduledAt: ZonedDateTime,
    nowMillis: Long,
    settings: InactivityReviewNotificationsSettings
): List<Long> {
    if (settings.idleMinutes <= 0) {
        return emptyList()
    }

    val windowEnd = firstScheduledAt.withHour(settings.windowEndHour)
        .withMinute(settings.windowEndMinute)
        .withSecond(0)
        .withNano(0)
    if (firstScheduledAt > windowEnd) {
        return emptyList()
    }

    val scheduledAtMillisList = mutableListOf<Long>()
    var currentScheduledAt: ZonedDateTime? = firstScheduledAt

    while (currentScheduledAt != null && currentScheduledAt <= windowEnd) {
        val currentScheduledAtMillis = currentScheduledAt.toInstant().toEpochMilli()
        if (currentScheduledAtMillis > nowMillis) {
            scheduledAtMillisList += currentScheduledAtMillis
        }

        currentScheduledAt = currentScheduledAt.plusMinutes(settings.idleMinutes.toLong())
    }

    return scheduledAtMillisList
}

private fun buildDailyReminderScheduledAtDateTimes(
    nowMillis: Long,
    zoneId: ZoneId,
    settings: DailyReviewNotificationsSettings
): List<ZonedDateTime> {
    val now = Instant.ofEpochMilli(nowMillis).atZone(zoneId)

    return (0 until dailyReminderSchedulingHorizonDays).mapNotNull { dayOffset ->
        val candidateDateTime = now.toLocalDate()
            .plusDays(dayOffset.toLong())
            .atTime(settings.hour, settings.minute)
            .atZone(zoneId)
        if (candidateDateTime.toInstant().toEpochMilli() <= nowMillis) {
            return@mapNotNull null
        }

        candidateDateTime
    }
}

private fun buildScheduledReviewNotificationPayloads(
    workspaceId: String,
    reviewFilter: PersistedReviewFilter,
    cardId: String?,
    frontText: String,
    scheduledAtDateTimes: List<ZonedDateTime>,
    mode: ReviewNotificationMode
): List<ScheduledReviewNotificationPayload> {
    return scheduledAtDateTimes.map { scheduledAtDateTime ->
        ScheduledReviewNotificationPayload(
            workspaceId = workspaceId,
            reviewFilter = reviewFilter,
            cardId = cardId,
            frontText = frontText,
            scheduledAtMillis = scheduledAtDateTime.toInstant().toEpochMilli(),
            requestId = makeNotificationRequestId(
                workspaceId = workspaceId,
                mode = mode,
                suffix = makeNotificationRequestSuffix(scheduledAtDateTime = scheduledAtDateTime)
            )
        )
    }
}

private val notificationRequestIdDateTimeFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd-HH-mm")

private fun makeSettingsKey(workspaceId: String): String {
    return "$reviewNotificationsSettingsKeyPrefix$workspaceId"
}

private fun makeScheduledPayloadsKey(workspaceId: String): String {
    return "$reviewNotificationsScheduledPayloadsKeyPrefix$workspaceId"
}

private fun encodeSettings(settings: ReviewNotificationsSettings): String {
    return JSONObject().apply {
        put("isEnabled", settings.isEnabled)
        put(
            "selectedMode",
            when (settings.selectedMode) {
                ReviewNotificationMode.DAILY -> reviewNotificationsModeDaily
                ReviewNotificationMode.INACTIVITY -> reviewNotificationsModeInactivity
            }
        )
        put(
            "daily",
            JSONObject().apply {
                put("hour", settings.daily.hour)
                put("minute", settings.daily.minute)
            }
        )
        put(
            "inactivity",
            JSONObject().apply {
                put("windowStartHour", settings.inactivity.windowStartHour)
                put("windowStartMinute", settings.inactivity.windowStartMinute)
                put("windowEndHour", settings.inactivity.windowEndHour)
                put("windowEndMinute", settings.inactivity.windowEndMinute)
                put("idleMinutes", settings.inactivity.idleMinutes)
            }
        )
    }.toString()
}

private fun decodeSettings(rawValue: String): ReviewNotificationsSettings {
    val payload = JSONObject(rawValue)
    val dailyPayload = payload.getJSONObject("daily")
    val inactivityPayload = payload.getJSONObject("inactivity")

    return ReviewNotificationsSettings(
        isEnabled = payload.getBoolean("isEnabled"),
        selectedMode = when (payload.getString("selectedMode")) {
            reviewNotificationsModeDaily -> ReviewNotificationMode.DAILY
            reviewNotificationsModeInactivity -> ReviewNotificationMode.INACTIVITY
            else -> throw IllegalArgumentException("Unsupported review notification mode.")
        },
        daily = DailyReviewNotificationsSettings(
            hour = dailyPayload.getInt("hour"),
            minute = dailyPayload.getInt("minute")
        ),
        inactivity = InactivityReviewNotificationsSettings(
            windowStartHour = inactivityPayload.getInt("windowStartHour"),
            windowStartMinute = inactivityPayload.getInt("windowStartMinute"),
            windowEndHour = inactivityPayload.getInt("windowEndHour"),
            windowEndMinute = inactivityPayload.getInt("windowEndMinute"),
            idleMinutes = inactivityPayload.getInt("idleMinutes")
        )
    )
}

private fun encodePromptState(state: NotificationPermissionPromptState): String {
    return JSONObject().apply {
        put("hasShownPrePrompt", state.hasShownPrePrompt)
        put("hasRequestedSystemPermission", state.hasRequestedSystemPermission)
        put("hasDismissedPrePrompt", state.hasDismissedPrePrompt)
    }.toString()
}

private fun decodePromptState(rawValue: String): NotificationPermissionPromptState {
    val payload = JSONObject(rawValue)
    return NotificationPermissionPromptState(
        hasShownPrePrompt = payload.getBoolean("hasShownPrePrompt"),
        hasRequestedSystemPermission = payload.getBoolean("hasRequestedSystemPermission"),
        hasDismissedPrePrompt = payload.getBoolean("hasDismissedPrePrompt")
    )
}

private fun encodeScheduledPayloads(payloads: List<ScheduledReviewNotificationPayload>): String {
    return JSONArray().apply {
        payloads.forEach { payload ->
            put(
                JSONObject().apply {
                    put("workspaceId", payload.workspaceId)
                    put("reviewFilter", encodePersistedReviewFilter(filter = payload.reviewFilter))
                    if (payload.cardId != null) {
                        put("cardId", payload.cardId)
                    }
                    put("frontText", payload.frontText)
                    put("scheduledAtMillis", payload.scheduledAtMillis)
                    put("requestId", payload.requestId)
                }
            )
        }
    }.toString()
}

private fun decodeScheduledPayloads(rawValue: String): List<ScheduledReviewNotificationPayload> {
    val payloads = JSONArray(rawValue)
    return (0 until payloads.length()).map { index ->
        val payload = payloads.getJSONObject(index)
        ScheduledReviewNotificationPayload(
            workspaceId = payload.getString("workspaceId"),
            reviewFilter = decodePersistedReviewFilterPayload(payload = payload.getJSONObject("reviewFilter")),
            cardId = if (payload.isNull("cardId")) {
                null
            } else {
                payload.getString("cardId")
            },
            frontText = payload.getString("frontText"),
            scheduledAtMillis = payload.getLong("scheduledAtMillis"),
            requestId = payload.getString("requestId")
        )
    }
}

private fun encodePersistedReviewFilter(filter: PersistedReviewFilter): JSONObject {
    return JSONObject().apply {
        put(reviewFilterKindKey, filter.kind)
        if (filter.deckId != null) {
            put(reviewFilterDeckIdKey, filter.deckId)
        }
        if (filter.effortLevel != null) {
            put(reviewFilterEffortLevelKey, filter.effortLevel)
        }
        if (filter.tag != null) {
            put(reviewFilterTagKey, filter.tag)
        }
    }
}

private fun decodePersistedReviewFilterPayload(payload: JSONObject): PersistedReviewFilter {
    return PersistedReviewFilter(
        kind = payload.getString(reviewFilterKindKey),
        deckId = payload.optString(reviewFilterDeckIdKey).takeIf { it.isNotBlank() },
        effortLevel = payload.optString(reviewFilterEffortLevelKey).takeIf { it.isNotBlank() },
        tag = payload.optString(reviewFilterTagKey).takeIf { it.isNotBlank() }
    )
}

private fun decodePersistedEffortLevel(rawValue: String): EffortLevel {
    return try {
        enumValueOf<EffortLevel>(rawValue)
    } catch (_: IllegalArgumentException) {
        throw IllegalArgumentException("Persisted review filter has an unsupported effortLevel.")
    }
}
