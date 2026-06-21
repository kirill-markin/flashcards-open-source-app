package com.flashcardsopensourceapp.feature.progress

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardMetric
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfile
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfileBestRatingPlacement
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfileMetrics
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfileReviewActivity
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfileReviewActivityDay
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfileStats
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRowKind
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardViewer
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardWindow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDay
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakFreeze
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboardMetric
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboardRankingRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboardViewer
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardParticipantRowKind
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardProfileReviewActivityDateBasis
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardProfileStatus
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
import com.flashcardsopensourceapp.data.local.model.progress.ProgressStreakLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressStreakLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.progress.createRenderedProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.createRenderedProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import java.time.LocalDate

internal fun createProgressViewModelForTest(
    progressRepository: FakeProgressRepository
): ProgressViewModel {
    return ProgressViewModel(
        progressRepository = progressRepository
    )
}

internal class FakeProgressRepository : ProgressRepository {
    private val summarySnapshots = MutableStateFlow<ProgressSummarySnapshot?>(null)
    private val seriesSnapshots = MutableStateFlow<ProgressSeriesSnapshot?>(null)
    private val reviewScheduleSnapshots = MutableStateFlow<ProgressReviewScheduleSnapshot?>(null)
    private val leaderboardSnapshots = MutableStateFlow<ProgressLeaderboardSnapshot?>(null)
    private val streakLeaderboardSnapshots = MutableStateFlow<ProgressStreakLeaderboardSnapshot?>(null)
    var refreshSummaryIfInvalidatedCallCount: Int = 0
        private set
    var refreshSeriesIfInvalidatedCallCount: Int = 0
        private set
    var refreshReviewScheduleIfInvalidatedCallCount: Int = 0
        private set
    var refreshLeaderboardIfInvalidatedCallCount: Int = 0
        private set
    var refreshStreakLeaderboardIfInvalidatedCallCount: Int = 0
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
    var refreshStreakLeaderboardManuallyCallCount: Int = 0
        private set
    val loadedLeaderboardProfileIds = mutableListOf<String>()
    var leaderboardProfileResponse: CloudProgressLeaderboardProfile = createCloudProgressLeaderboardProfile()
    var leaderboardProfileError: Exception? = null

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

    fun emitStreakLeaderboardSnapshot(
        snapshot: ProgressStreakLeaderboardSnapshot
    ) {
        streakLeaderboardSnapshots.value = snapshot
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

    override fun observeStreakLeaderboardSnapshot(): Flow<ProgressStreakLeaderboardSnapshot?> {
        return streakLeaderboardSnapshots
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

    override suspend fun refreshStreakLeaderboardIfInvalidated() {
        refreshStreakLeaderboardIfInvalidatedCallCount += 1
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

    override suspend fun refreshStreakLeaderboardManually() {
        refreshStreakLeaderboardManuallyCallCount += 1
    }

    override suspend fun loadLeaderboardProfile(publicProfileId: String): CloudProgressLeaderboardProfile {
        loadedLeaderboardProfileIds += publicProfileId
        leaderboardProfileError?.let { error ->
            throw error
        }
        return leaderboardProfileResponse
    }
}

internal fun createProgressSummarySnapshot(): ProgressSummarySnapshot {
    return ProgressSummarySnapshot(
        scopeKey = ProgressSummaryScopeKey(
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            referenceLocalDate = "2026-04-18"
        ),
        renderedSummary = createProgressSummaryForTest(),
        localFallback = createProgressSummaryForTest(),
        serverBase = createProgressSummaryForTest(),
        source = ProgressSnapshotSource.SERVER_BASE,
        isApproximate = false
    )
}

internal fun createProgressSeriesSnapshot(): ProgressSeriesSnapshot {
    return createProgressSeriesSnapshot(
        from = "2026-04-18",
        to = "2026-04-18",
        dailyReviews = listOf(
            createDailyReviewPoint(
                date = "2026-04-18",
                reviewCount = 3
            )
        )
    )
}

internal fun createProgressSeriesSnapshot(
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
        streakDays = createProgressStreakDaysForTest(
            dailyReviews = dailyReviews,
            today = to
        ),
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
                createDailyReviewPoint(
                    date = point.date,
                    reviewCount = 0
                )
            },
            streakDays = createProgressStreakDaysForTest(
                dailyReviews = dailyReviews.map { point ->
                    createDailyReviewPoint(
                        date = point.date,
                        reviewCount = 0
                    )
                },
                today = to
            ),
            generatedAt = null,
            reviewHistoryWatermarks = emptyList(),
            summary = null
        ),
        source = ProgressSnapshotSource.LOCAL_ONLY,
        isApproximate = true
    )
}

private fun createProgressSummaryForTest(): CloudProgressSummary {
    return CloudProgressSummary(
        currentStreakDays = 12,
        longestStreakDays = 12,
        hasReviewedToday = true,
        lastReviewedOn = "2026-04-18",
        activeReviewDays = 50,
        streakFreeze = createProgressStreakFreezeForTest(),
        reviewHistoryWatermarks = emptyList()
    )
}

private fun createProgressStreakFreezeForTest(): CloudProgressStreakFreeze {
    return CloudProgressStreakFreeze(
        availableCredits = 2,
        capacity = 2,
        balanceUnits = 20,
        unitsPerCredit = 10,
        earnedUnitsPerStreakDay = 1,
        nextCreditProgressUnits = 0,
        nextCreditRequiredUnits = 10
    )
}

private fun createProgressStreakDaysForTest(
    dailyReviews: List<CloudDailyReviewPoint>,
    today: String
): List<CloudProgressStreakDay> {
    return dailyReviews.map { point ->
        CloudProgressStreakDay(
            date = point.date,
            state = when {
                point.reviewCount > 0 -> CloudProgressStreakDayState.REVIEWED
                point.date == today -> CloudProgressStreakDayState.PENDING
                else -> CloudProgressStreakDayState.MISSED
            }
        )
    }
}

internal fun createProgressReviewScheduleSnapshot(): ProgressReviewScheduleSnapshot {
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

internal fun createProgressLeaderboardSnapshot(): ProgressLeaderboardSnapshot {
    return createProgressLeaderboardSnapshot(
        cloudState = CloudAccountState.LINKED,
        leaderboard = createCloudProgressLeaderboard(),
        viewerLocalQualifiedCounts = emptyMap()
    )
}

internal fun createProgressLeaderboardSnapshot(
    cloudState: CloudAccountState,
    leaderboard: CloudProgressLeaderboard?
): ProgressLeaderboardSnapshot {
    return createProgressLeaderboardSnapshot(
        cloudState = cloudState,
        leaderboard = leaderboard,
        viewerLocalQualifiedCounts = emptyMap()
    )
}

internal fun createProgressLeaderboardSnapshot(
    leaderboard: CloudProgressLeaderboard
): ProgressLeaderboardSnapshot {
    return createProgressLeaderboardSnapshot(
        cloudState = CloudAccountState.LINKED,
        leaderboard = leaderboard,
        viewerLocalQualifiedCounts = emptyMap()
    )
}

internal fun createProgressLeaderboardSnapshot(
    viewerLocalQualifiedCounts: Map<ProgressLeaderboardWindowKey, Int>
): ProgressLeaderboardSnapshot {
    return createProgressLeaderboardSnapshot(
        cloudState = CloudAccountState.LINKED,
        leaderboard = createCloudProgressLeaderboard(),
        viewerLocalQualifiedCounts = viewerLocalQualifiedCounts
    )
}

private fun createProgressLeaderboardSnapshot(
    cloudState: CloudAccountState,
    leaderboard: CloudProgressLeaderboard?,
    viewerLocalQualifiedCounts: Map<ProgressLeaderboardWindowKey, Int>
): ProgressLeaderboardSnapshot {
    return ProgressLeaderboardSnapshot(
        scopeKey = ProgressLeaderboardScopeKey(scopeId = "linked:user-1"),
        cloudState = cloudState,
        leaderboard = leaderboard,
        renderedLeaderboard = createRenderedProgressLeaderboard(
            leaderboard = leaderboard,
            viewerLocalQualifiedCounts = viewerLocalQualifiedCounts
        ),
        payloadUpdatedAtMillis = if (leaderboard == null) null else 1_750_000_000_000L,
        viewerLocalQualifiedCounts = viewerLocalQualifiedCounts,
        isRefreshDue = false,
        didLastRemoteLoadFail = false
    )
}

internal fun createCloudProgressLeaderboard(): CloudProgressLeaderboard {
    return createCloudProgressLeaderboard(
        status = ProgressLeaderboardStatus.READY,
        windows = listOf(createCloudProgressLeaderboardWindow())
    )
}

internal fun createCloudProgressLeaderboard(
    windows: List<CloudProgressLeaderboardWindow>
): CloudProgressLeaderboard {
    return createCloudProgressLeaderboard(
        status = ProgressLeaderboardStatus.READY,
        windows = windows
    )
}

internal fun createCloudProgressLeaderboard(
    status: ProgressLeaderboardStatus,
    windows: List<CloudProgressLeaderboardWindow>
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

internal fun createCloudProgressLeaderboardProfile(): CloudProgressLeaderboardProfile.Ready {
    return CloudProgressLeaderboardProfile.Ready(
        status = ProgressLeaderboardProfileStatus.READY,
        publicProfileId = "participant-1",
        anonymousDisplayName = "Silver Bright Harbor",
        friendDisplayName = "Kai",
        isFriend = true,
        metrics = CloudProgressLeaderboardProfileMetrics(
            currentStreakDays = 5,
            bestRatingPlacement = CloudProgressLeaderboardProfileBestRatingPlacement(
                windowKey = ProgressLeaderboardWindowKey.LAST_24_HOURS,
                rank = 1
            )
        ),
        reviewActivity = CloudProgressLeaderboardProfileReviewActivity(
            dateBasis = ProgressLeaderboardProfileReviewActivityDateBasis.PROFILE_LOCAL_DAY_WITH_UTC_FALLBACK,
            days = createCloudProgressLeaderboardProfileReviewActivityDays()
        ),
        stats = CloudProgressLeaderboardProfileStats(
            joinedAt = "2026-05-01T10:00:00.000Z",
            totalCards = 72
        ),
        generatedAt = "2026-06-21T12:34:56.000Z"
    )
}

internal fun createCloudProgressLeaderboardProfileNonReady(
    status: ProgressLeaderboardProfileStatus
): CloudProgressLeaderboardProfile.NonReady {
    return CloudProgressLeaderboardProfile.NonReady(status = status)
}

private fun createCloudProgressLeaderboardProfileReviewActivityDays(): List<CloudProgressLeaderboardProfileReviewActivityDay> {
    val startDate = LocalDate.parse("2026-05-23")
    return (0 until 30).map { dayIndex ->
        CloudProgressLeaderboardProfileReviewActivityDay(
            date = startDate.plusDays(dayIndex.toLong()).toString(),
            reviewCount = when (dayIndex) {
                0 -> 2
                9 -> 5
                29 -> 1
                else -> 0
            }
        )
    }
}

internal fun createCloudProgressLeaderboardWindow(): CloudProgressLeaderboardWindow {
    return createCloudProgressLeaderboardWindow(
        windowKey = ProgressLeaderboardWindowKey.LAST_24_HOURS,
        viewerRank = 42
    )
}

internal fun createCloudProgressLeaderboardWindow(
    windowKey: ProgressLeaderboardWindowKey,
    viewerRank: Int
): CloudProgressLeaderboardWindow {
    val rankingRows = createLeaderboardRankingRows(
        viewerRank = viewerRank,
        viewerQualifiedReviewCount = 7,
        participantCount = 128
    )
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
        rows = createLeaderboardCompactRows(rankingRows = rankingRows),
        rankingRows = rankingRows
    )
}

internal fun createProgressStreakLeaderboardSnapshot(): ProgressStreakLeaderboardSnapshot {
    return createProgressStreakLeaderboardSnapshot(
        cloudState = CloudAccountState.LINKED,
        leaderboard = createCloudProgressStreakLeaderboard(),
        viewerCurrentStreakDays = null,
        didLastRemoteLoadFail = false
    )
}

internal fun createProgressStreakLeaderboardSnapshot(
    cloudState: CloudAccountState,
    leaderboard: CloudProgressStreakLeaderboard?,
    viewerCurrentStreakDays: Int?,
    didLastRemoteLoadFail: Boolean
): ProgressStreakLeaderboardSnapshot {
    return ProgressStreakLeaderboardSnapshot(
        scopeKey = ProgressStreakLeaderboardScopeKey(scopeId = "linked:user-1"),
        cloudState = cloudState,
        leaderboard = leaderboard,
        renderedLeaderboard = createRenderedProgressStreakLeaderboard(
            leaderboard = leaderboard,
            viewerCurrentStreakDays = viewerCurrentStreakDays,
            currentTimeMillis = 1_750_000_000_000L
        ),
        payloadUpdatedAtMillis = if (leaderboard == null) null else 1_750_000_000_000L,
        viewerCurrentStreakDays = viewerCurrentStreakDays,
        isRefreshDue = false,
        didLastRemoteLoadFail = didLastRemoteLoadFail
    )
}

internal fun createCloudProgressStreakLeaderboard(): CloudProgressStreakLeaderboard.Ready {
    val rankingRows = listOf(
        createCloudProgressStreakLeaderboardRankingRow(
            kind = CloudProgressLeaderboardRankingRowKind.PARTICIPANT,
            rank = 1,
            streakDays = 30
        ),
        createCloudProgressStreakLeaderboardRankingRow(
            kind = CloudProgressLeaderboardRankingRowKind.VIEWER,
            rank = 2,
            streakDays = 12
        ),
        createCloudProgressStreakLeaderboardRankingRow(
            kind = CloudProgressLeaderboardRankingRowKind.PARTICIPANT,
            rank = 3,
            streakDays = 8
        )
    )
    val viewerRow = rankingRows.single { row ->
        row.kind == CloudProgressLeaderboardRankingRowKind.VIEWER
    }

    return CloudProgressStreakLeaderboard.Ready(
        status = ProgressLeaderboardStatus.READY,
        metric = CloudProgressStreakLeaderboardMetric(
            metricVersion = "streak_days_v1",
            title = "Current streak days",
            description = "Ranks use current streak days from the public daily snapshot."
        ),
        snapshotId = "streak-snapshot-1",
        snapshotGeneratedAt = "2026-04-18T14:00:05.000Z",
        asOfUtcDate = "2026-04-18",
        nextRefreshAfter = "2026-04-19T00:00:00.000Z",
        participantCount = rankingRows.size,
        viewer = CloudProgressStreakLeaderboardViewer(
            publicProfileId = viewerRow.publicProfileId,
            displayName = "You",
            rank = viewerRow.rank,
            streakDays = viewerRow.streakDays
        ),
        rows = rankingRows.map { row ->
            createCloudProgressStreakLeaderboardParticipantRow(
                kind = when {
                    row.kind == CloudProgressLeaderboardRankingRowKind.VIEWER -> {
                        ProgressLeaderboardParticipantRowKind.VIEWER
                    }
                    row.rank <= 3 -> ProgressLeaderboardParticipantRowKind.TOP
                    else -> ProgressLeaderboardParticipantRowKind.NEIGHBOR
                },
                rankingRow = row
            )
        },
        rankingRows = rankingRows
    )
}

internal fun createCloudProgressStreakLeaderboardNonReady(
    status: ProgressLeaderboardStatus
): CloudProgressStreakLeaderboard.NonReady {
    return CloudProgressStreakLeaderboard.NonReady(
        status = status,
        metric = CloudProgressStreakLeaderboardMetric(
            metricVersion = "streak_days_v1",
            title = "Current streak days",
            description = "Ranks use current streak days from the public daily snapshot."
        )
    )
}

private fun createCloudProgressStreakLeaderboardRankingRow(
    kind: CloudProgressLeaderboardRankingRowKind,
    rank: Int,
    streakDays: Int
): CloudProgressStreakLeaderboardRankingRow {
    return CloudProgressStreakLeaderboardRankingRow(
        kind = kind,
        publicProfileId = if (kind == CloudProgressLeaderboardRankingRowKind.VIEWER) {
            "viewer-profile"
        } else {
            "streak-participant-$rank"
        },
        anonymousDisplayName = if (kind == CloudProgressLeaderboardRankingRowKind.VIEWER) {
            "Misty Quiet Grove"
        } else {
            "Streak Participant $rank"
        },
        friendDisplayName = null,
        streakDays = streakDays,
        rank = rank
    )
}

private fun createCloudProgressStreakLeaderboardParticipantRow(
    kind: ProgressLeaderboardParticipantRowKind,
    rankingRow: CloudProgressStreakLeaderboardRankingRow
): CloudProgressStreakLeaderboardRow.Participant {
    return CloudProgressStreakLeaderboardRow.Participant(
        kind = kind,
        publicProfileId = rankingRow.publicProfileId,
        anonymousDisplayName = rankingRow.anonymousDisplayName,
        friendDisplayName = rankingRow.friendDisplayName,
        streakDays = rankingRow.streakDays,
        rank = rankingRow.rank
    )
}

internal fun CloudProgressLeaderboardWindow.withFriendRows(
    friendRows: Map<Int, String>
): CloudProgressLeaderboardWindow {
    return copy(
        rankingRows = rankingRows.map { row ->
            row.copy(friendDisplayName = friendRows[row.rank])
        }
    )
}

private fun createLeaderboardRankingRows(
    viewerRank: Int,
    viewerQualifiedReviewCount: Int,
    participantCount: Int
): List<CloudProgressLeaderboardRankingRow> {
    return (1..participantCount).map { rank ->
        val isViewer = rank == viewerRank
        CloudProgressLeaderboardRankingRow(
            kind = if (isViewer) {
                CloudProgressLeaderboardRankingRowKind.VIEWER
            } else {
                CloudProgressLeaderboardRankingRowKind.PARTICIPANT
            },
            publicProfileId = if (isViewer) {
                "viewer-profile"
            } else {
                "participant-$rank"
            },
            anonymousDisplayName = if (isViewer) {
                "Misty Quiet Grove"
            } else {
                leaderboardDisplayNameForRank(rank = rank)
            },
            friendDisplayName = null,
            qualifiedReviewCount = if (isViewer) {
                viewerQualifiedReviewCount
            } else {
                leaderboardQualifiedReviewCountForRank(
                    rank = rank,
                    viewerRank = viewerRank,
                    viewerQualifiedReviewCount = viewerQualifiedReviewCount,
                    participantCount = participantCount
                )
            },
            rank = rank
        )
    }
}

private fun leaderboardDisplayNameForRank(rank: Int): String {
    return when (rank) {
        1 -> "Silver Bright Harbor"
        2 -> "Amber Calm Meadow"
        3 -> "Coral Keen Valley"
        40 -> "Teal Steady Summit"
        41 -> "Jade Swift River"
        42 -> "Misty Quiet Grove"
        43 -> "Sunny Brave Cliff"
        128 -> "Blue Final Harbor"
        else -> "Participant $rank"
    }
}

private fun leaderboardQualifiedReviewCountForRank(
    rank: Int,
    viewerRank: Int,
    viewerQualifiedReviewCount: Int,
    participantCount: Int
): Int {
    return when {
        rank == 1 -> 51
        rank == 2 -> 33
        rank == 3 -> 21
        rank == participantCount -> 0
        rank < viewerRank - 1 -> viewerQualifiedReviewCount + 2
        rank < viewerRank -> viewerQualifiedReviewCount + 1
        else -> maxOf(0, viewerQualifiedReviewCount - 1)
    }
}

private fun createLeaderboardCompactRows(
    rankingRows: List<CloudProgressLeaderboardRankingRow>
): List<CloudProgressLeaderboardRow> {
    val totalRowCount = rankingRows.size
    val topRowCount = minOf(3, totalRowCount)
    val viewerRank = checkNotNull(
        rankingRows.firstOrNull { row -> row.kind == CloudProgressLeaderboardRankingRowKind.VIEWER }?.rank
    )
    val shownRanks = mutableSetOf<Int>()
    (1..topRowCount).forEach { rank ->
        shownRanks.add(rank)
    }
    if (viewerRank > topRowCount) {
        listOf(viewerRank - 1, viewerRank, viewerRank + 1).forEach { rank ->
            if (rank >= 1 && rank <= totalRowCount) {
                shownRanks.add(rank)
            }
        }
    } else if (viewerRank == topRowCount && viewerRank < totalRowCount) {
        shownRanks.add(viewerRank + 1)
    }
    if (totalRowCount > topRowCount) {
        shownRanks.add(totalRowCount)
    }
    rankingRows.forEach { row ->
        if (row.friendDisplayName != null) {
            shownRanks.add(row.rank)
        }
    }

    val rowsByRank = rankingRows.associateBy { row -> row.rank }
    return buildList {
        var previousRank = 0
        shownRanks.sorted().forEach { rank ->
            if (previousRank != 0 && rank > previousRank + 1) {
                add(CloudProgressLeaderboardRow.Gap)
            }

            add(
                checkNotNull(rowsByRank[rank]).toLeaderboardParticipantRow(
                    topRowCount = topRowCount
                )
            )
            previousRank = rank
        }
    }
}

private fun CloudProgressLeaderboardRankingRow.toLeaderboardParticipantRow(
    topRowCount: Int
): CloudProgressLeaderboardRow.Participant {
    return createLeaderboardParticipantRow(
        kind = when {
            kind == CloudProgressLeaderboardRankingRowKind.VIEWER -> ProgressLeaderboardParticipantRowKind.VIEWER
            rank <= topRowCount -> ProgressLeaderboardParticipantRowKind.TOP
            else -> ProgressLeaderboardParticipantRowKind.NEIGHBOR
        },
        publicProfileId = publicProfileId,
        anonymousDisplayName = anonymousDisplayName,
        friendDisplayName = friendDisplayName,
        qualifiedReviewCount = qualifiedReviewCount,
        rank = rank
    )
}

private fun createLeaderboardParticipantRow(
    kind: ProgressLeaderboardParticipantRowKind,
    publicProfileId: String,
    anonymousDisplayName: String,
    friendDisplayName: String?,
    qualifiedReviewCount: Int,
    rank: Int
): CloudProgressLeaderboardRow.Participant {
    return CloudProgressLeaderboardRow.Participant(
        kind = kind,
        publicProfileId = publicProfileId,
        anonymousDisplayName = anonymousDisplayName,
        friendDisplayName = friendDisplayName,
        qualifiedReviewCount = qualifiedReviewCount,
        rank = rank
    )
}

internal fun createDailyReviewPoints(
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
        createDailyReviewPoint(
            date = date.toString(),
            reviewCount = 1
        )
    }.toList()
}

internal fun createDailyReviewPoint(
    date: String,
    reviewCount: Int
): CloudDailyReviewPoint {
    return CloudDailyReviewPoint(
        date = date,
        reviewCount = reviewCount,
        againCount = 0,
        hardCount = 0,
        goodCount = reviewCount,
        easyCount = 0
    )
}
