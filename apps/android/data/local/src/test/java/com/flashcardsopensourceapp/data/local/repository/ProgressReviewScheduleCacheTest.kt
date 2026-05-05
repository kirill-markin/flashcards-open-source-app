package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class ProgressReviewScheduleCacheTest {
    @Test
    fun reviewScheduleScopeKeyIncludesStableSortedWorkspaceMembership() {
        val firstScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-2", "workspace-1")
        )
        val secondScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1", "workspace-2")
        )
        val reducedMembershipScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )

        assertEquals(firstScopeKey, secondScopeKey)
        assertEquals("workspace-1|workspace-2", firstScopeKey.workspaceMembershipKey)
        assertTrue(
            serializeProgressReviewScheduleScopeKey(scopeKey = firstScopeKey) !=
                serializeProgressReviewScheduleScopeKey(scopeKey = reducedMembershipScopeKey)
        )
    }

    @Test
    fun reviewScheduleServerCacheKeyIgnoresWorkspaceMembership() {
        val firstScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-2", "workspace-1")
        )
        val reducedMembershipScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )

        assertTrue(firstScopeKey != reducedMembershipScopeKey)
        assertTrue(
            serializeProgressReviewScheduleScopeKey(scopeKey = firstScopeKey) !=
                serializeProgressReviewScheduleScopeKey(scopeKey = reducedMembershipScopeKey)
        )
        assertEquals(
            serializeProgressReviewScheduleServerCacheKey(scopeKey = firstScopeKey),
            serializeProgressReviewScheduleServerCacheKey(scopeKey = reducedMembershipScopeKey)
        )
    }

    @Test
    fun reviewScheduleServerBaseCacheIsReusedAcrossWorkspaceMembershipChanges() {
        val cachedScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val currentScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1", "workspace-2")
        )
        val serverBase = createReviewSchedule(
            timeZone = cachedScopeKey.timeZone,
            newCount = 1,
            todayCount = 1
        )
        val cacheEntity = serverBase.toCacheEntity(
            scopeKey = cachedScopeKey,
            updatedAtMillis = 1L
        )

        assertEquals(
            serializeProgressReviewScheduleServerCacheKey(scopeKey = cachedScopeKey),
            cacheEntity.scopeKey
        )
        assertEquals(
            serverBase,
            findProgressReviewScheduleServerBase(
                reviewScheduleCaches = listOf(cacheEntity),
                scopeKey = currentScopeKey
            )
        )
    }

    @Test
    fun legacyReviewScheduleServerBaseCacheIsReusedAcrossWorkspaceMembershipChanges() {
        val cachedScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val currentScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1", "workspace-2")
        )
        val serverBase = createReviewSchedule(
            timeZone = cachedScopeKey.timeZone,
            newCount = 1,
            todayCount = 1
        )
        val legacyCacheEntity = serverBase.toCacheEntity(
            scopeKey = cachedScopeKey,
            updatedAtMillis = 1L
        ).copy(
            scopeKey = serializeProgressReviewScheduleScopeKey(scopeKey = cachedScopeKey)
        )

        assertEquals(
            serverBase,
            findProgressReviewScheduleServerBase(
                reviewScheduleCaches = listOf(legacyCacheEntity),
                scopeKey = currentScopeKey
            )
        )
    }

    @Test
    fun reviewScheduleOverlayCoverageUsesCurrentWorkspaceMembershipAfterServerCacheReuse() {
        val cachedScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val currentWorkspaceIds = listOf("workspace-1", "workspace-2")
        val currentScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = currentWorkspaceIds
        )
        val serverBase = createReviewSchedule(
            timeZone = cachedScopeKey.timeZone,
            newCount = 1,
            todayCount = 1
        )
        val resolvedServerBase = requireNotNull(
            findProgressReviewScheduleServerBase(
                reviewScheduleCaches = listOf(
                    serverBase.toCacheEntity(
                        scopeKey = cachedScopeKey,
                        updatedAtMillis = 1L
                    )
                ),
                scopeKey = currentScopeKey
            )
        )
        val pendingCardUpsertOutboxEntries = listOf(
            createPendingScheduleReviewCardUpsertOutboxEntry(
                workspaceId = "workspace-1",
                outboxEntryId = "outbox-card-review",
                cardId = "card-review"
            )
        )
        val isLocalReviewScheduleScopeHydrated = isProgressReviewScheduleLocalScopeHydrated(
            syncStates = listOf(
                createSyncState(
                    workspaceId = "workspace-1",
                    hasHydratedHotState = true
                )
            ),
            workspaceIds = currentWorkspaceIds
        )
        val snapshot = createProgressReviewScheduleSnapshot(
            scopeKey = currentScopeKey,
            localFallback = createReviewSchedule(
                timeZone = currentScopeKey.timeZone,
                newCount = 0,
                todayCount = 2
            ),
            serverBase = resolvedServerBase,
            hasPendingScheduleImpactingCardChanges = hasPendingProgressReviewScheduleCardChanges(
                pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
                workspaceIds = currentWorkspaceIds
            ),
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            isLocalReviewScheduleScopeHydrated = isLocalReviewScheduleScopeHydrated,
            workspaceIds = currentWorkspaceIds,
            cloudState = CloudAccountState.LINKED
        )

        assertFalse(isLocalReviewScheduleScopeHydrated)
        assertEquals(ProgressSnapshotSource.SERVER_BASE, snapshot.source)
        assertEquals(resolvedServerBase, snapshot.renderedSchedule)
    }

}
