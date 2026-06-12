package com.flashcardsopensourceapp.feature.progress

import androidx.lifecycle.Lifecycle
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardMetric
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardViewer
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardWindow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardParticipantRowKind
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardStatus
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.util.Locale

@OptIn(ExperimentalCoroutinesApi::class)
class ProgressViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Test
    fun resumedLifecycleTriggersInitialProgressLoad() {
        val shouldTrigger = shouldTriggerInitialProgressLoad(
            lifecycleState = Lifecycle.State.RESUMED
        )

        assertTrue(shouldTrigger)
    }

    @Test
    fun nonResumedLifecycleDoesNotTriggerInitialProgressLoad() {
        assertEquals(
            false,
            shouldTriggerInitialProgressLoad(lifecycleState = Lifecycle.State.CREATED)
        )
        assertEquals(
            false,
            shouldTriggerInitialProgressLoad(lifecycleState = Lifecycle.State.STARTED)
        )
    }

    @Test
    fun progressSectionScrollIndexesMatchLoadedRouteOrder() {
        assertEquals(0, progressStreakItemIndex())
        assertEquals(1, progressLeaderboardItemIndex())
    }

    @Test
    fun repositorySnapshotsMapToLoadedUiState() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )

            repository.emitSummarySnapshot(
                snapshot = createProgressSummarySnapshot()
            )
            repository.emitSeriesSnapshot(
                snapshot = createProgressSeriesSnapshot()
            )
            repository.emitReviewScheduleSnapshot(
                snapshot = createProgressReviewScheduleSnapshot()
            )
            advanceUntilIdle()

            val uiState = viewModel.uiState.value
            assertTrue(uiState is ProgressUiState.Loaded)
            val loadedState = uiState as ProgressUiState.Loaded
            assertTrue(loadedState.summary is ProgressSummaryUiState.Loaded)
            val summaryState = loadedState.summary as ProgressSummaryUiState.Loaded
            assertEquals(12, summaryState.summary.currentStreakDays)
            assertEquals(1, loadedState.reviewsSection.pages.size)
            assertEquals(4, loadedState.reviewsSection.pages.single().upperBound)
            val reviewScheduleSection = checkNotNull(loadedState.reviewScheduleSection)
            assertEquals(4, reviewScheduleSection.totalCards)
            assertEquals(
                ProgressReviewScheduleBucketKey.NEW,
                reviewScheduleSection.buckets.first().key
            )
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun reviewScheduleSnapshotDoesNotGateLoadedUiStateAndUpdatesLater() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )

            repository.emitSummarySnapshot(
                snapshot = createProgressSummarySnapshot()
            )
            repository.emitSeriesSnapshot(
                snapshot = createProgressSeriesSnapshot()
            )
            advanceUntilIdle()

            val uiState = viewModel.uiState.value
            assertTrue(uiState is ProgressUiState.Loaded)
            val loadedState = uiState as ProgressUiState.Loaded
            assertEquals(null, loadedState.reviewScheduleSection)

            repository.emitReviewScheduleSnapshot(
                snapshot = createProgressReviewScheduleSnapshot()
            )
            advanceUntilIdle()

            val updatedUiState = viewModel.uiState.value as ProgressUiState.Loaded
            val reviewScheduleSection = checkNotNull(updatedUiState.reviewScheduleSection)
            assertEquals(4, reviewScheduleSection.totalCards)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun refreshIfInvalidatedDelegatesToProgressRepositoryFlows() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )
            advanceUntilIdle()

            viewModel.refreshIfInvalidated()
            advanceUntilIdle()

            assertEquals(1, repository.refreshSummaryIfInvalidatedCallCount)
            assertEquals(1, repository.refreshSeriesIfInvalidatedCallCount)
            assertEquals(1, repository.refreshReviewScheduleIfInvalidatedCallCount)
            assertEquals(1, repository.refreshLeaderboardIfInvalidatedCallCount)
            assertEquals(0, repository.refreshSummaryManuallyCallCount)
            assertEquals(0, repository.refreshSeriesManuallyCallCount)
            assertEquals(0, repository.refreshReviewScheduleManuallyCallCount)
            assertEquals(0, repository.refreshLeaderboardManuallyCallCount)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun refreshManuallyDelegatesToProgressRepositoryFlows() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )
            advanceUntilIdle()

            viewModel.refreshManually()
            advanceUntilIdle()

            assertEquals(0, repository.refreshSummaryIfInvalidatedCallCount)
            assertEquals(0, repository.refreshSeriesIfInvalidatedCallCount)
            assertEquals(0, repository.refreshReviewScheduleIfInvalidatedCallCount)
            assertEquals(0, repository.refreshLeaderboardIfInvalidatedCallCount)
            assertEquals(1, repository.refreshSummaryManuallyCallCount)
            assertEquals(1, repository.refreshSeriesManuallyCallCount)
            assertEquals(1, repository.refreshReviewScheduleManuallyCallCount)
            assertEquals(1, repository.refreshLeaderboardManuallyCallCount)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun invalidSeriesSnapshotMapsToErrorUiStateInsteadOfThrowing() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )

            repository.emitReviewScheduleSnapshot(
                snapshot = createProgressReviewScheduleSnapshot()
            )
            val baseSeriesSnapshot = createProgressSeriesSnapshot()
            repository.emitSeriesSnapshot(
                snapshot = baseSeriesSnapshot.copy(
                    renderedSeries = baseSeriesSnapshot.renderedSeries.copy(
                        to = "invalid-date"
                    )
                )
            )
            advanceUntilIdle()

            val uiState = viewModel.uiState.value
            assertTrue(uiState is ProgressUiState.Error)
            assertEquals(null, (uiState as ProgressUiState.Error).message)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun loadedUiStateUsesMondayWeekStartForGermanLocaleAcrossStreakAndChart() = runTest(dispatcher) {
        assertLoadedUiStateUsesLocaleWeekStart(
            locale = Locale.GERMANY,
            expectedWeekStart = LocalDate.parse("2026-04-13")
        )
    }

    @Test
    fun loadedUiStateUsesSundayWeekStartForUsLocaleAcrossStreakAndChart() = runTest(dispatcher) {
        assertLoadedUiStateUsesLocaleWeekStart(
            locale = Locale.US,
            expectedWeekStart = LocalDate.parse("2026-04-12")
        )
    }

    @Test
    fun loadedUiStateUsesLocalUpperBoundPerReviewWeekPage() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )

            repository.emitSummarySnapshot(
                snapshot = createProgressSummarySnapshot()
            )
            repository.emitSeriesSnapshot(
                snapshot = createProgressSeriesSnapshot(
                    from = "2026-04-13",
                    to = "2026-04-21",
                    dailyReviews = listOf(
                        CloudDailyReviewPoint(date = "2026-04-13", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-14", reviewCount = 40),
                        CloudDailyReviewPoint(date = "2026-04-15", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-16", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-17", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-18", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-19", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-20", reviewCount = 0),
                        CloudDailyReviewPoint(date = "2026-04-21", reviewCount = 9)
                    )
                )
            )
            repository.emitReviewScheduleSnapshot(
                snapshot = createProgressReviewScheduleSnapshot()
            )
            advanceUntilIdle()

            val uiState = viewModel.uiState.value as ProgressUiState.Loaded
            assertEquals(2, uiState.reviewsSection.pages.size)
            assertEquals(44, uiState.reviewsSection.pages[0].upperBound)
            assertEquals(10, uiState.reviewsSection.pages[1].upperBound)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun leaderboardSnapshotMapsToReadyCompactRowsWithDefaultWindow() = runTest(dispatcher) {
        Dispatchers.setMain(dispatcher)
        try {
            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )

            repository.emitSummarySnapshot(snapshot = createProgressSummarySnapshot())
            repository.emitSeriesSnapshot(snapshot = createProgressSeriesSnapshot())
            repository.emitLeaderboardSnapshot(snapshot = createProgressLeaderboardSnapshot())
            advanceUntilIdle()

            val uiState = viewModel.uiState.value as ProgressUiState.Loaded
            val leaderboardSection = uiState.leaderboardSection as ProgressLeaderboardSectionUiState.Ready
            assertEquals(ProgressLeaderboardWindowKey.LAST_24_HOURS, leaderboardSection.selectedWindowKey)
            val selectedWindow = checkNotNull(leaderboardSection.selectedWindow)
            assertEquals(128, selectedWindow.participantCount)

            val rows = selectedWindow.rows
            assertEquals(9, rows.size)
            val firstRow = rows[0] as ProgressLeaderboardRowUiState.Participant
            assertEquals(1, firstRow.rank)
            assertEquals("Silver Bright Harbor", firstRow.displayName)
            assertEquals(51, firstRow.qualifiedReviewCount)
            assertEquals(false, firstRow.isViewer)
            val viewerRow = rows[5] as ProgressLeaderboardRowUiState.Participant
            assertEquals(42, viewerRow.rank)
            assertTrue(viewerRow.isViewer)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun leaderboardKeepsTopThreeRowsBeforeEllipsisGap() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(),
            selectedWindowKey = null
        ) as ProgressLeaderboardSectionUiState.Ready

        val rows = checkNotNull(sectionUiState.selectedWindow).rows
        val topRows = rows.take(3).map { row -> row as ProgressLeaderboardRowUiState.Participant }
        assertEquals(listOf(1, 2, 3), topRows.map(ProgressLeaderboardRowUiState.Participant::rank))
        assertEquals(ProgressLeaderboardRowUiState.Gap, rows[3])
        assertEquals(ProgressLeaderboardRowUiState.Gap, rows[7])
        val lastRow = rows[8] as ProgressLeaderboardRowUiState.Participant
        assertEquals(128, lastRow.rank)
        assertEquals(0, lastRow.qualifiedReviewCount)
    }

    @Test
    fun leaderboardAutoSelectsBestViewerRank() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(
                leaderboard = createCloudProgressLeaderboard(
                    windows = ProgressLeaderboardWindowKey.orderedEntries.map { windowKey ->
                        createCloudProgressLeaderboardWindow(
                            windowKey = windowKey,
                            viewerRank = when (windowKey) {
                                ProgressLeaderboardWindowKey.LAST_24_HOURS -> 9
                                ProgressLeaderboardWindowKey.LAST_3_DAYS -> 4
                                ProgressLeaderboardWindowKey.LAST_7_DAYS -> 2
                                ProgressLeaderboardWindowKey.LAST_30_DAYS -> 6
                                ProgressLeaderboardWindowKey.ALL_TIME -> 3
                            }
                        )
                    }
                )
            ),
            selectedWindowKey = null
        ) as ProgressLeaderboardSectionUiState.Ready

        assertEquals(ProgressLeaderboardWindowKey.LAST_7_DAYS, sectionUiState.selectedWindowKey)
    }

    @Test
    fun guestLeaderboardSnapshotMapsToSignInPlaceholder() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(
                cloudState = CloudAccountState.GUEST,
                leaderboard = null
            ),
            selectedWindowKey = null
        )

        assertEquals(ProgressLeaderboardSectionUiState.SignInRequired, sectionUiState)
    }

    @Test
    fun participationDisabledLeaderboardMapsToParticipationPlaceholder() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(
                leaderboard = createCloudProgressLeaderboard(
                    status = ProgressLeaderboardStatus.PARTICIPATION_DISABLED,
                    windows = emptyList()
                )
            ),
            selectedWindowKey = null
        )

        assertEquals(ProgressLeaderboardSectionUiState.ParticipationDisabled, sectionUiState)
    }

    @Test
    fun leaderboardInfoCopyExplainsAgainExclusion() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(),
            selectedWindowKey = null
        ) as ProgressLeaderboardSectionUiState.Ready

        val infoCopy = checkNotNull(sectionUiState.metricDescription)
        assertTrue(infoCopy.contains("Hard, Good, and Easy"))
        assertTrue(infoCopy.contains("Again does not"))
    }

    @Test
    fun leaderboardLiveOverlayChangesOnlyViewerCount() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(
                viewerLocalQualifiedCounts = mapOf(
                    ProgressLeaderboardWindowKey.LAST_24_HOURS to 9
                )
            ),
            selectedWindowKey = null
        ) as ProgressLeaderboardSectionUiState.Ready

        val rows = checkNotNull(sectionUiState.selectedWindow).rows
        val participants = rows.filterIsInstance<ProgressLeaderboardRowUiState.Participant>()
        val viewerRow = participants.single(ProgressLeaderboardRowUiState.Participant::isViewer)
        assertEquals(9, viewerRow.qualifiedReviewCount)
        assertEquals(42, viewerRow.rank)
        assertEquals(
            listOf(51, 33, 21, 8, 7, 0),
            participants.filterNot(ProgressLeaderboardRowUiState.Participant::isViewer)
                .map(ProgressLeaderboardRowUiState.Participant::qualifiedReviewCount)
        )
    }

    @Test
    fun leaderboardLiveOverlayNeverLowersServerViewerCount() {
        val sectionUiState = createProgressLeaderboardSectionUiState(
            snapshot = createProgressLeaderboardSnapshot(
                viewerLocalQualifiedCounts = mapOf(
                    ProgressLeaderboardWindowKey.LAST_24_HOURS to 2
                )
            ),
            selectedWindowKey = null
        ) as ProgressLeaderboardSectionUiState.Ready

        val rows = checkNotNull(sectionUiState.selectedWindow).rows
        val viewerRow = rows.filterIsInstance<ProgressLeaderboardRowUiState.Participant>()
            .single(ProgressLeaderboardRowUiState.Participant::isViewer)
        assertEquals(7, viewerRow.qualifiedReviewCount)
    }

    private suspend fun TestScope.assertLoadedUiStateUsesLocaleWeekStart(
        locale: Locale,
        expectedWeekStart: LocalDate
    ) {
        Dispatchers.setMain(dispatcher)
        val previousLocale = Locale.getDefault()

        try {
            Locale.setDefault(locale)

            val repository = FakeProgressRepository()
            val viewModel = ProgressViewModel(
                progressRepository = repository
            )

            repository.emitSummarySnapshot(
                snapshot = createProgressSummarySnapshot()
            )
            repository.emitSeriesSnapshot(
                snapshot = createProgressSeriesSnapshot(
                    from = "2026-04-11",
                    to = "2026-04-18",
                    dailyReviews = createDailyReviewPoints(
                        from = LocalDate.parse("2026-04-11"),
                        to = LocalDate.parse("2026-04-18")
                    )
                )
            )
            repository.emitReviewScheduleSnapshot(
                snapshot = createProgressReviewScheduleSnapshot()
            )
            advanceUntilIdle()

            val uiState = viewModel.uiState.value as ProgressUiState.Loaded
            val latestWeek = uiState.streakSection.weeks.last()
            val latestReviewPage = uiState.reviewsSection.pages.last()

            assertEquals(expectedWeekStart, latestWeek.days.first().date)
            assertEquals(expectedWeekStart, latestReviewPage.startDate)
        } finally {
            Locale.setDefault(previousLocale)
            Dispatchers.resetMain()
        }
    }
}

private class FakeProgressRepository : ProgressRepository {
    private val summarySnapshots = MutableStateFlow<ProgressSummarySnapshot?>(null)
    private val seriesSnapshots = MutableStateFlow<ProgressSeriesSnapshot?>(null)
    private val reviewScheduleSnapshots = MutableStateFlow<ProgressReviewScheduleSnapshot?>(null)
    private val leaderboardSnapshots = MutableStateFlow<ProgressLeaderboardSnapshot?>(null)
    var refreshSummaryIfInvalidatedCallCount: Int = 0
        private set
    var refreshSeriesIfInvalidatedCallCount: Int = 0
        private set
    var refreshReviewScheduleIfInvalidatedCallCount: Int = 0
        private set
    var refreshLeaderboardIfInvalidatedCallCount: Int = 0
        private set
    var refreshLeaderboardForReviewShortcutCallCount: Int = 0
        private set
    var refreshSummaryManuallyCallCount: Int = 0
        private set
    var refreshSeriesManuallyCallCount: Int = 0
        private set
    var refreshReviewScheduleManuallyCallCount: Int = 0
        private set
    var refreshLeaderboardManuallyCallCount: Int = 0
        private set

    fun emitSummarySnapshot(
        snapshot: ProgressSummarySnapshot
    ) {
        summarySnapshots.value = snapshot
    }

    fun emitSeriesSnapshot(
        snapshot: ProgressSeriesSnapshot
    ) {
        seriesSnapshots.value = snapshot
    }

    fun emitReviewScheduleSnapshot(
        snapshot: ProgressReviewScheduleSnapshot
    ) {
        reviewScheduleSnapshots.value = snapshot
    }

    fun emitLeaderboardSnapshot(
        snapshot: ProgressLeaderboardSnapshot
    ) {
        leaderboardSnapshots.value = snapshot
    }

    override fun observeSummarySnapshot(): Flow<ProgressSummarySnapshot?> {
        return summarySnapshots
    }

    override fun observeSeriesSnapshot(): Flow<ProgressSeriesSnapshot?> {
        return seriesSnapshots
    }

    override fun observeReviewScheduleSnapshot(): Flow<ProgressReviewScheduleSnapshot?> {
        return reviewScheduleSnapshots
    }

    override fun observeLeaderboardSnapshot(): Flow<ProgressLeaderboardSnapshot?> {
        return leaderboardSnapshots
    }

    override suspend fun refreshSummaryIfInvalidated() {
        refreshSummaryIfInvalidatedCallCount += 1
    }

    override suspend fun refreshSeriesIfInvalidated() {
        refreshSeriesIfInvalidatedCallCount += 1
    }

    override suspend fun refreshReviewScheduleIfInvalidated() {
        refreshReviewScheduleIfInvalidatedCallCount += 1
    }

    override suspend fun refreshLeaderboardIfInvalidated() {
        refreshLeaderboardIfInvalidatedCallCount += 1
    }

    override suspend fun refreshLeaderboardForReviewShortcut() {
        refreshLeaderboardForReviewShortcutCallCount += 1
    }

    override suspend fun refreshSummaryManually() {
        refreshSummaryManuallyCallCount += 1
    }

    override suspend fun refreshSeriesManually() {
        refreshSeriesManuallyCallCount += 1
    }

    override suspend fun refreshReviewScheduleManually() {
        refreshReviewScheduleManuallyCallCount += 1
    }

    override suspend fun refreshLeaderboardManually() {
        refreshLeaderboardManuallyCallCount += 1
    }
}

private fun createProgressSummarySnapshot(): ProgressSummarySnapshot {
    return ProgressSummarySnapshot(
        scopeKey = ProgressSummaryScopeKey(
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            referenceLocalDate = "2026-04-18"
        ),
        renderedSummary = CloudProgressSummary(
            currentStreakDays = 12,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 50,
            reviewHistoryWatermarks = emptyList()
        ),
        localFallback = CloudProgressSummary(
            currentStreakDays = 12,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 50,
            reviewHistoryWatermarks = emptyList()
        ),
        serverBase = CloudProgressSummary(
            currentStreakDays = 12,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 50,
            reviewHistoryWatermarks = emptyList()
        ),
        source = ProgressSnapshotSource.SERVER_BASE,
        isApproximate = false
    )
}

private fun createProgressSeriesSnapshot(): ProgressSeriesSnapshot {
    return createProgressSeriesSnapshot(
        from = "2026-04-18",
        to = "2026-04-18",
        dailyReviews = listOf(
            CloudDailyReviewPoint(
                date = "2026-04-18",
                reviewCount = 3
            )
        )
    )
}

private fun createProgressSeriesSnapshot(
    from: String,
    to: String,
    dailyReviews: List<CloudDailyReviewPoint>
): ProgressSeriesSnapshot {
    val scopeKey = ProgressSeriesScopeKey(
        scopeId = "local:installation-1",
        timeZone = "Europe/Madrid",
        from = from,
        to = to
    )
    val renderedSeries = CloudProgressSeries(
        timeZone = scopeKey.timeZone,
        from = scopeKey.from,
        to = scopeKey.to,
        dailyReviews = dailyReviews,
        generatedAt = null,
        reviewHistoryWatermarks = emptyList(),
        summary = null
    )
    return ProgressSeriesSnapshot(
        scopeKey = scopeKey,
        renderedSeries = renderedSeries,
        localFallback = renderedSeries,
        serverBase = null,
        pendingLocalOverlay = CloudProgressSeries(
            timeZone = scopeKey.timeZone,
            from = scopeKey.from,
            to = scopeKey.to,
            dailyReviews = dailyReviews.map { point ->
                point.copy(reviewCount = 0)
            },
            generatedAt = null,
            reviewHistoryWatermarks = emptyList(),
            summary = null
        ),
        source = ProgressSnapshotSource.LOCAL_ONLY,
        isApproximate = true
    )
}

private fun createProgressReviewScheduleSnapshot(): ProgressReviewScheduleSnapshot {
    val scopeKey = ProgressReviewScheduleScopeKey(
        scopeId = "local:installation-1",
        timeZone = "Europe/Madrid",
        workspaceMembershipKey = "workspace-1",
        referenceLocalDate = "2026-04-18"
    )
    val schedule = CloudProgressReviewSchedule(
        timeZone = scopeKey.timeZone,
        generatedAt = null,
        reviewHistoryWatermarks = emptyList(),
        totalCards = 4,
        buckets = ProgressReviewScheduleBucketKey.orderedEntries.map { key ->
            CloudProgressReviewScheduleBucket(
                key = key,
                count = when (key) {
                    ProgressReviewScheduleBucketKey.NEW -> 2
                    ProgressReviewScheduleBucketKey.TODAY -> 1
                    ProgressReviewScheduleBucketKey.DAYS_1_TO_7 -> 1
                    ProgressReviewScheduleBucketKey.DAYS_8_TO_30,
                    ProgressReviewScheduleBucketKey.DAYS_31_TO_90,
                    ProgressReviewScheduleBucketKey.DAYS_91_TO_360,
                    ProgressReviewScheduleBucketKey.YEARS_1_TO_2,
                    ProgressReviewScheduleBucketKey.LATER -> 0
                }
            )
        }
    )

    return ProgressReviewScheduleSnapshot(
        scopeKey = scopeKey,
        renderedSchedule = schedule,
        localFallback = schedule,
        serverBase = null,
        source = ProgressSnapshotSource.LOCAL_ONLY,
        isApproximate = true
    )
}

private fun createProgressLeaderboardSnapshot(
    cloudState: CloudAccountState = CloudAccountState.LINKED,
    leaderboard: CloudProgressLeaderboard? = createCloudProgressLeaderboard(),
    viewerLocalQualifiedCounts: Map<ProgressLeaderboardWindowKey, Int> = emptyMap()
): ProgressLeaderboardSnapshot {
    return ProgressLeaderboardSnapshot(
        scopeKey = ProgressLeaderboardScopeKey(scopeId = "linked:user-1"),
        cloudState = cloudState,
        leaderboard = leaderboard,
        payloadUpdatedAtMillis = if (leaderboard == null) null else 1_750_000_000_000L,
        viewerLocalQualifiedCounts = viewerLocalQualifiedCounts,
        isRefreshDue = false,
        didLastRemoteLoadFail = false
    )
}

private fun createCloudProgressLeaderboard(
    status: ProgressLeaderboardStatus = ProgressLeaderboardStatus.READY,
    windows: List<CloudProgressLeaderboardWindow> = listOf(createCloudProgressLeaderboardWindow())
): CloudProgressLeaderboard {
    return CloudProgressLeaderboard(
        status = status,
        metric = CloudProgressLeaderboardMetric(
            metricVersion = "qualified_reviews_v1",
            title = "Qualified reviews",
            description = "Hard, Good, and Easy reviews count toward your rank. Again does not."
        ),
        defaultWindowKey = ProgressLeaderboardWindowKey.LAST_24_HOURS,
        windows = windows
    )
}

private fun createCloudProgressLeaderboardWindow(): CloudProgressLeaderboardWindow {
    return createCloudProgressLeaderboardWindow(
        windowKey = ProgressLeaderboardWindowKey.LAST_24_HOURS,
        viewerRank = 42
    )
}

private fun createCloudProgressLeaderboardWindow(
    windowKey: ProgressLeaderboardWindowKey,
    viewerRank: Int
): CloudProgressLeaderboardWindow {
    return CloudProgressLeaderboardWindow(
        windowKey = windowKey,
        snapshotId = "snapshot-1",
        snapshotGeneratedAt = "2026-04-18T14:00:05.000Z",
        asOfServerHour = "2026-04-18T14:00:00.000Z",
        nextRefreshAfter = "2026-04-18T15:00:00.000Z",
        participantCount = 128,
        viewer = CloudProgressLeaderboardViewer(
            publicProfileId = "viewer-profile",
            rank = viewerRank,
            qualifiedReviewCount = 7
        ),
        rows = listOf(
            createLeaderboardParticipantRow(
                kind = ProgressLeaderboardParticipantRowKind.TOP,
                publicProfileId = "top-1",
                anonymousDisplayName = "Silver Bright Harbor",
                qualifiedReviewCount = 51,
                rank = 1
            ),
            createLeaderboardParticipantRow(
                kind = ProgressLeaderboardParticipantRowKind.TOP,
                publicProfileId = "top-2",
                anonymousDisplayName = "Amber Calm Meadow",
                qualifiedReviewCount = 33,
                rank = 2
            ),
            createLeaderboardParticipantRow(
                kind = ProgressLeaderboardParticipantRowKind.TOP,
                publicProfileId = "top-3",
                anonymousDisplayName = "Coral Keen Valley",
                qualifiedReviewCount = 21,
                rank = 3
            ),
            CloudProgressLeaderboardRow.Gap,
            createLeaderboardParticipantRow(
                kind = ProgressLeaderboardParticipantRowKind.NEIGHBOR,
                publicProfileId = "neighbor-41",
                anonymousDisplayName = "Jade Swift River",
                qualifiedReviewCount = 8,
                rank = 41
            ),
            createLeaderboardParticipantRow(
                kind = ProgressLeaderboardParticipantRowKind.VIEWER,
                publicProfileId = "viewer-profile",
                anonymousDisplayName = "Misty Quiet Grove",
                qualifiedReviewCount = 7,
                rank = viewerRank
            ),
            createLeaderboardParticipantRow(
                kind = ProgressLeaderboardParticipantRowKind.NEIGHBOR,
                publicProfileId = "neighbor-43",
                anonymousDisplayName = "Sunny Brave Cliff",
                qualifiedReviewCount = 7,
                rank = 43
            ),
            CloudProgressLeaderboardRow.Gap,
            createLeaderboardParticipantRow(
                kind = ProgressLeaderboardParticipantRowKind.NEIGHBOR,
                publicProfileId = "last-128",
                anonymousDisplayName = "Blue Final Harbor",
                qualifiedReviewCount = 0,
                rank = 128
            )
        )
    )
}

private fun createLeaderboardParticipantRow(
    kind: ProgressLeaderboardParticipantRowKind,
    publicProfileId: String,
    anonymousDisplayName: String,
    qualifiedReviewCount: Int,
    rank: Int
): CloudProgressLeaderboardRow.Participant {
    return CloudProgressLeaderboardRow.Participant(
        kind = kind,
        publicProfileId = publicProfileId,
        anonymousDisplayName = anonymousDisplayName,
        qualifiedReviewCount = qualifiedReviewCount,
        rank = rank
    )
}

private fun createDailyReviewPoints(
    from: LocalDate,
    to: LocalDate
): List<CloudDailyReviewPoint> {
    return generateSequence(from) { date ->
        val nextDate = date.plusDays(1)
        if (nextDate.isAfter(to)) {
            null
        } else {
            nextDate
        }
    }.map { date ->
        CloudDailyReviewPoint(
            date = date.toString(),
            reviewCount = 1
        )
    }.toList()
}
