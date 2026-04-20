package com.flashcardsopensourceapp.app.notifications

import com.flashcardsopensourceapp.data.local.database.ReviewLogDao
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.notifications.ScheduledStrictReminderPayload
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersSettings
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersStore
import com.flashcardsopensourceapp.data.local.notifications.defaultStrictRemindersSettings
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StrictRemindersManagerTest {
    private val zoneId: ZoneId = ZoneId.of("UTC")

    @Test
    fun recordSuccessfulReviewUsesRecordedReviewTimestampAcrossMidnight() = runBlocking {
        val store = FakeStrictRemindersStore()
        val scheduler = FakeStrictRemindersScheduler(hasNotificationPermission = true)
        val manager = StrictRemindersManager(
            strictRemindersStore = store,
            reviewLogDao = FakeReviewLogDao(hasReviewLogsBetween = false),
            scheduler = scheduler,
            zoneIdProvider = { zoneId }
        )

        try {
            val reviewedAtMillis = parseTimestampMillis(value = "2026-04-03T23:59:00Z")
            val nowMillis = parseTimestampMillis(value = "2026-04-04T00:01:00Z")

            manager.recordSuccessfulReview(
                reviewedAtMillis = reviewedAtMillis,
                nowMillis = nowMillis
            )

            awaitUntil {
                store.lastCompletedReviewAtMillis == reviewedAtMillis &&
                    scheduler.scheduledPayloads.any { payload ->
                        payload.requestId == "strict-reminder::2026-04-04::4h"
                    }
            }

            assertEquals(reviewedAtMillis, store.lastCompletedReviewAtMillis)
            assertTrue(
                scheduler.scheduledPayloads.any { payload ->
                    payload.requestId == "strict-reminder::2026-04-04::4h"
                }
            )
        } finally {
            manager.close()
        }
    }

    @Test
    fun queuedCommandsEndWithLatestStrictReminderSchedulingState() = runBlocking {
        val store = FakeStrictRemindersStore()
        val scheduler = FakeStrictRemindersScheduler(hasNotificationPermission = true)
        val manager = StrictRemindersManager(
            strictRemindersStore = store,
            reviewLogDao = FakeReviewLogDao(hasReviewLogsBetween = true),
            scheduler = scheduler,
            zoneIdProvider = { zoneId }
        )

        try {
            manager.recordSuccessfulReview(
                reviewedAtMillis = parseTimestampMillis(value = "2026-04-03T09:00:00Z"),
                nowMillis = parseTimestampMillis(value = "2026-04-03T09:01:00Z")
            )
            manager.recordImportedReviewHistory(
                importedReviewAtMillis = parseTimestampMillis(value = "2026-04-03T21:00:00Z"),
                nowMillis = parseTimestampMillis(value = "2026-04-03T21:05:00Z")
            )
            manager.reconcileStrictReminders(
                trigger = StrictRemindersReconcileTrigger.APP_BACKGROUND,
                nowMillis = parseTimestampMillis(value = "2026-04-03T21:05:00Z")
            )

            awaitUntil {
                store.lastCompletedReviewAtMillis == parseTimestampMillis(value = "2026-04-03T21:00:00Z") &&
                    scheduler.clearScheduledInvocationCount >= 3 &&
                    scheduler.scheduledPayloads.none { payload ->
                        payload.requestId.startsWith("strict-reminder::2026-04-03::")
                    }
            }

            assertEquals(
                parseTimestampMillis(value = "2026-04-03T21:00:00Z"),
                store.lastCompletedReviewAtMillis
            )
            assertFalse(
                scheduler.scheduledPayloads.any { payload ->
                    payload.requestId.startsWith("strict-reminder::2026-04-03::")
                }
            )
            assertTrue(scheduler.clearScheduledInvocationCount >= 3)
        } finally {
            manager.close()
        }
    }

    @Test
    fun reconcileClearsStaleCurrentDayCompletionMarkerAfterReviewHistoryDeletion() = runBlocking {
        val store = FakeStrictRemindersStore().apply {
            saveLastCompletedReviewAtMillis(
                timestampMillis = parseTimestampMillis(value = "2026-04-03T09:00:00Z")
            )
        }
        val scheduler = FakeStrictRemindersScheduler(hasNotificationPermission = true)
        val manager = StrictRemindersManager(
            strictRemindersStore = store,
            reviewLogDao = FakeReviewLogDao(hasReviewLogsBetween = false),
            scheduler = scheduler,
            zoneIdProvider = { zoneId }
        )

        try {
            manager.reconcileStrictReminders(
                trigger = StrictRemindersReconcileTrigger.APP_BACKGROUND,
                nowMillis = parseTimestampMillis(value = "2026-04-03T12:00:00Z")
            )

            awaitUntil {
                store.lastCompletedReviewAtMillis == null &&
                    scheduler.scheduledPayloads.any { payload ->
                        payload.requestId == "strict-reminder::2026-04-03::4h"
                    }
            }

            assertEquals(null, store.lastCompletedReviewAtMillis)
            assertTrue(
                scheduler.scheduledPayloads.any { payload ->
                    payload.requestId == "strict-reminder::2026-04-03::4h"
                }
            )
        } finally {
            manager.close()
        }
    }

    @Test
    fun clearForCloudIdentityResetPreservesSettingsAndClearsPersistedStateAndPendingWork() = runBlocking {
        val store = FakeStrictRemindersStore().apply {
            saveStrictRemindersSettings(settings = StrictRemindersSettings(isEnabled = false))
            saveLastCompletedReviewAtMillis(
                timestampMillis = parseTimestampMillis(value = "2026-04-03T21:00:00Z")
            )
            saveScheduledStrictReminderPayloads(
                payloads = listOf(
                    ScheduledStrictReminderPayload(
                        scheduledAtMillis = parseTimestampMillis(value = "2026-04-03T22:00:00Z"),
                        timeOffset = com.flashcardsopensourceapp.data.local.notifications.StrictReminderTimeOffset.TWO_HOURS,
                        requestId = "strict-reminder::2026-04-03::2h"
                    )
                )
            )
        }
        val scheduler = FakeStrictRemindersScheduler(hasNotificationPermission = true).apply {
            scheduledPayloads.addAll(store.scheduledPayloads)
        }
        val manager = StrictRemindersManager(
            strictRemindersStore = store,
            reviewLogDao = FakeReviewLogDao(hasReviewLogsBetween = false),
            scheduler = scheduler,
            zoneIdProvider = { zoneId }
        )

        try {
            manager.clearForCloudIdentityReset()

            assertEquals(StrictRemindersSettings(isEnabled = false), store.loadStrictRemindersSettings())
            assertEquals(null, store.loadLastCompletedReviewAtMillis())
            assertTrue(store.loadScheduledStrictReminderPayloads().isEmpty())
            assertTrue(scheduler.scheduledPayloads.isEmpty())
            assertEquals(1, scheduler.clearScheduledInvocationCount)
            assertEquals(1, scheduler.clearDeliveredInvocationCount)
        } finally {
            manager.close()
        }
    }

    @Test
    fun lifecycleCommandsAfterCloseAreIgnored() = runBlocking {
        val store = FakeStrictRemindersStore()
        val scheduler = FakeStrictRemindersScheduler(hasNotificationPermission = true)
        val manager = StrictRemindersManager(
            strictRemindersStore = store,
            reviewLogDao = FakeReviewLogDao(hasReviewLogsBetween = false),
            scheduler = scheduler,
            zoneIdProvider = { zoneId }
        )

        manager.close()

        manager.reconcileStrictReminders(
            trigger = StrictRemindersReconcileTrigger.APP_BACKGROUND,
            nowMillis = parseTimestampMillis(value = "2026-04-03T12:00:00Z")
        )
        manager.recordSuccessfulReview(
            reviewedAtMillis = parseTimestampMillis(value = "2026-04-03T09:00:00Z"),
            nowMillis = parseTimestampMillis(value = "2026-04-03T12:00:00Z")
        )
        manager.recordImportedReviewHistory(
            importedReviewAtMillis = parseTimestampMillis(value = "2026-04-03T10:00:00Z"),
            nowMillis = parseTimestampMillis(value = "2026-04-03T12:00:00Z")
        )

        delay(timeMillis = 50L)

        assertEquals(null, store.lastCompletedReviewAtMillis)
        assertTrue(scheduler.scheduledPayloads.isEmpty())
        assertEquals(0, scheduler.clearScheduledInvocationCount)
        assertEquals(0, scheduler.clearDeliveredInvocationCount)
    }
}

private class FakeStrictRemindersStore : StrictRemindersStore {
    private var settings: StrictRemindersSettings = defaultStrictRemindersSettings()
    @Volatile
    var lastCompletedReviewAtMillis: Long? = null
    @Volatile
    var scheduledPayloads: List<ScheduledStrictReminderPayload> = emptyList()

    override fun loadStrictRemindersSettings(): StrictRemindersSettings {
        return settings
    }

    override fun saveStrictRemindersSettings(settings: StrictRemindersSettings) {
        this.settings = settings
    }

    override fun loadLastCompletedReviewAtMillis(): Long? {
        return lastCompletedReviewAtMillis
    }

    override fun saveLastCompletedReviewAtMillis(timestampMillis: Long) {
        lastCompletedReviewAtMillis = timestampMillis
    }

    override fun clearLastCompletedReviewAtMillis() {
        lastCompletedReviewAtMillis = null
    }

    override fun loadScheduledStrictReminderPayloads(): List<ScheduledStrictReminderPayload> {
        return scheduledPayloads
    }

    override fun saveScheduledStrictReminderPayloads(payloads: List<ScheduledStrictReminderPayload>) {
        scheduledPayloads = payloads
    }

    override fun clearStrictRemindersIdentityState() {
        lastCompletedReviewAtMillis = null
        scheduledPayloads = emptyList()
    }
}

private class FakeStrictRemindersScheduler(
    private val hasNotificationPermission: Boolean
) : StrictRemindersScheduler {
    val scheduledPayloads: MutableList<ScheduledStrictReminderPayload> = CopyOnWriteArrayList()
    @Volatile
    var clearDeliveredInvocationCount: Int = 0
    @Volatile
    var clearScheduledInvocationCount: Int = 0

    override fun hasNotificationPermission(): Boolean {
        return hasNotificationPermission
    }

    override fun clearDeliveredNotifications() {
        clearDeliveredInvocationCount += 1
    }

    override fun clearScheduledReminders() {
        clearScheduledInvocationCount += 1
        scheduledPayloads.clear()
    }

    override fun scheduleReminder(payload: ScheduledStrictReminderPayload, nowMillis: Long) {
        scheduledPayloads.add(payload)
    }
}

private class FakeReviewLogDao(
    private val hasReviewLogsBetween: Boolean
) : ReviewLogDao {
    override suspend fun insertReviewLog(reviewLog: ReviewLogEntity) {
        throw UnsupportedOperationException("Unused in strict reminders manager tests.")
    }

    override fun observeReviewLogs(): Flow<List<ReviewLogEntity>> {
        return flowOf(emptyList())
    }

    override suspend fun countReviewLogs(): Int {
        throw UnsupportedOperationException("Unused in strict reminders manager tests.")
    }

    override suspend fun hasReviewLogsBetween(startMillis: Long, endMillis: Long): Boolean {
        return hasReviewLogsBetween
    }

    override suspend fun loadReviewLogs(): List<ReviewLogEntity> {
        throw UnsupportedOperationException("Unused in strict reminders manager tests.")
    }

    override suspend fun loadReviewLogs(reviewLogIds: List<String>): List<ReviewLogEntity> {
        throw UnsupportedOperationException("Unused in strict reminders manager tests.")
    }

    override suspend fun loadReviewLogs(workspaceId: String): List<ReviewLogEntity> {
        throw UnsupportedOperationException("Unused in strict reminders manager tests.")
    }

    override suspend fun insertReviewLogs(reviewLogs: List<ReviewLogEntity>) {
        throw UnsupportedOperationException("Unused in strict reminders manager tests.")
    }

    override suspend fun deleteAllReviewLogs() {
        throw UnsupportedOperationException("Unused in strict reminders manager tests.")
    }

    override suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String) {
        throw UnsupportedOperationException("Unused in strict reminders manager tests.")
    }
}

private suspend fun awaitUntil(predicate: () -> Boolean) {
    withTimeout(timeMillis = 1_000L) {
        while (predicate().not()) {
            delay(timeMillis = 10L)
        }
    }
}

private fun parseTimestampMillis(value: String): Long {
    return Instant.parse(value).toEpochMilli()
}
