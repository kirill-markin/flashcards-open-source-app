package com.flashcardsopensourceapp.data.local.notifications

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Distinct from the `review-notification::` and `strict-reminder::` request id prefixes, because a
 * slot id is not a request id. */
private const val reviewReminderSlotIdPrefix: String = "review-notification-slot::"
private const val strictReminderSlotIdPrefix: String = "strict-reminder-slot::"

private val slotIdWallClockFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd-HH-mm")

/**
 * `notification_scheduled` counts scheduled notifications, and reconciliation re-schedules the same
 * slots on every trigger — a permission change, a settings edit, a sync, a foreground return, every
 * recorded review — so an emit driven by a reconciliation pass alone would measure how often the app
 * reconciles.
 *
 * What makes the difference measurable is the slot a reminder occupies, which survives re-scheduling.
 * Each kind keeps a ledger of the slot ids it has reported; an id already in the ledger is a slot
 * that was reported once and is being re-scheduled, and reports nothing. Entries are dropped once
 * they expire, which bounds the ledger: an expired slot can never be scheduled again.
 *
 * A slot id names the OS slot only one reminder can occupy, so it is built from the reminder kind and
 * the wall clock it fires at, never from the scheduling request id. Request ids carry the workspace,
 * and only one workspace's reminders can be pending at a time because every reconcile cancels them
 * all first, so a workspace-scoped slot id would re-report the whole future chain on a workspace
 * switch — which is itself a reconcile trigger. Daily and strict slots expire at their fire time;
 * inactivity reminders need their own slot id, see [inactivityScheduledNotificationIdentities].
 *
 * The ledger is not the persisted payload list the managers keep. That list is emptied whenever
 * reminders are off, permission is missing or no workspace is loaded, and the same slots are written
 * again once the condition clears, which would count every such round trip as new reminders.
 */
data class ScheduledNotificationIdentity(
    val slotId: String,
    val expiresAtMillis: Long
)

/** The ledger identities of one reconciled review reminder set. */
fun reviewReminderScheduledNotificationIdentities(
    mode: ReviewNotificationMode,
    payloads: List<ScheduledReviewNotificationPayload>,
    zoneId: ZoneId
): List<ScheduledNotificationIdentity> {
    return when (mode) {
        ReviewNotificationMode.DAILY -> payloads.map { payload ->
            val wallClock: String = slotIdWallClock(
                scheduledAtMillis = payload.scheduledAtMillis,
                zoneId = zoneId
            )
            ScheduledNotificationIdentity(
                slotId = "${reviewReminderSlotIdPrefix}daily::$wallClock",
                expiresAtMillis = payload.scheduledAtMillis
            )
        }

        ReviewNotificationMode.INACTIVITY -> inactivityScheduledNotificationIdentities(
            scheduledAtMillisList = payloads.map { payload ->
                payload.scheduledAtMillis
            },
            zoneId = zoneId
        )
    }
}

/** The ledger identities of one reconciled strict reminder set. */
fun strictReminderScheduledNotificationIdentities(
    payloads: List<ScheduledStrictReminderPayload>,
    zoneId: ZoneId
): List<ScheduledNotificationIdentity> {
    return payloads.map { payload ->
        val wallClock: String = slotIdWallClock(
            scheduledAtMillis = payload.scheduledAtMillis,
            zoneId = zoneId
        )
        ScheduledNotificationIdentity(
            slotId = "$strictReminderSlotIdPrefix${payload.timeOffset.rawValue}::$wallClock",
            expiresAtMillis = payload.scheduledAtMillis
        )
    }
}

/**
 * The inactivity chain is anchored on the last activity, and that anchor is rewritten by every
 * recorded review, so a fire time is not an identity: the whole chain shifts and gets fresh request
 * ids several times a minute while someone reviews, and at most one of those reminders can ever
 * fire. The identity is the local day and the position within it, expiring at the end of that day
 * rather than at a fire time the next re-anchor would move.
 *
 * A day already counted therefore reports nothing when its chain shifts, which under-counts a
 * reminder that fires and is replaced within the same day — the direction that keeps the denominator
 * honest, since an inflated one cannot be repaired.
 */
fun inactivityScheduledNotificationIdentities(
    scheduledAtMillisList: List<Long>,
    zoneId: ZoneId
): List<ScheduledNotificationIdentity> {
    val ordinalsByLocalDate: MutableMap<LocalDate, Int> = mutableMapOf()

    return scheduledAtMillisList.sorted().map { scheduledAtMillis ->
        val localDate: LocalDate = Instant.ofEpochMilli(scheduledAtMillis).atZone(zoneId).toLocalDate()
        val ordinal: Int = ordinalsByLocalDate[localDate] ?: 0
        ordinalsByLocalDate[localDate] = ordinal + 1

        ScheduledNotificationIdentity(
            slotId = "${reviewReminderSlotIdPrefix}inactivity::$localDate::$ordinal",
            expiresAtMillis = localDate.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()
        )
    }
}

/** The identities the ledger has not seen, in schedule order and each at most once. */
fun unreportedScheduledNotificationIdentities(
    identities: List<ScheduledNotificationIdentity>,
    reported: Map<String, Long>
): List<ScheduledNotificationIdentity> {
    return identities
        .distinctBy { identity ->
            identity.slotId
        }
        .filter { identity ->
            reported.containsKey(identity.slotId).not()
        }
}

/**
 * Adds every identity of this reconcile and drops the entries that have expired.
 *
 * Already-reported slots are merged again rather than skipped so their expiry is refreshed to the
 * fire time this reconcile computed: a slot id names a wall-clock position rather than an instant, so
 * a zone change or a DST shift moves when it fires without changing the id, and a stale expiry would
 * prune the entry while its reminder is still pending and report the slot a second time.
 */
fun mergeReportedScheduledNotifications(
    reported: Map<String, Long>,
    identities: List<ScheduledNotificationIdentity>,
    nowMillis: Long
): Map<String, Long> {
    val merged = reported.filterValues { expiresAtMillis ->
        expiresAtMillis > nowMillis
    }.toMutableMap()
    identities.forEach { identity ->
        merged[identity.slotId] = identity.expiresAtMillis
    }

    return merged
}

private fun slotIdWallClock(scheduledAtMillis: Long, zoneId: ZoneId): String {
    return Instant.ofEpochMilli(scheduledAtMillis).atZone(zoneId).format(slotIdWallClockFormatter)
}
