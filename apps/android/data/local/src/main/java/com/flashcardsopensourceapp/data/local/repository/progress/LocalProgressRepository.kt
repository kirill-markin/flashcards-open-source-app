package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressStreakLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.shared.TimeProvider
import com.flashcardsopensourceapp.data.local.repository.progress.cache.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.progress.cache.ProgressLocalCacheReadinessCoordinator
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressObservedInputs
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.createProgressClockSnapshot
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.observeProgressInputs
import com.flashcardsopensourceapp.data.local.repository.progress.orchestration.ProgressLeaderboardOrchestration
import com.flashcardsopensourceapp.data.local.repository.progress.orchestration.ProgressReviewScheduleOrchestration
import com.flashcardsopensourceapp.data.local.repository.progress.orchestration.ProgressSeriesOrchestration
import com.flashcardsopensourceapp.data.local.repository.progress.orchestration.ProgressStreakLeaderboardOrchestration
import com.flashcardsopensourceapp.data.local.repository.progress.orchestration.ProgressSummaryOrchestration
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressBackgroundLauncher
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.createProgressObservationVersions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect

class LocalProgressRepository(
    appScope: CoroutineScope,
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    localProgressCacheStore: LocalProgressCacheStore,
    observability: AppObservability,
    appVersion: String,
    versionCode: Int,
    private val timeProvider: TimeProvider
) : ProgressRepository {
    private val observationVersions = createProgressObservationVersions(
        appVersion = appVersion,
        versionCode = versionCode
    )
    private val backgroundLauncher = ProgressBackgroundLauncher(
        appScope = appScope,
        observability = observability,
        observationVersions = observationVersions
    )
    private val cacheReadinessCoordinator = ProgressLocalCacheReadinessCoordinator(
        localProgressCacheStore = localProgressCacheStore,
        timeProvider = timeProvider
    )
    private val summaryOrchestration = ProgressSummaryOrchestration(
        database = database,
        cloudAccountRepository = cloudAccountRepository,
        syncRepository = syncRepository,
        timeProvider = timeProvider,
        cacheReadinessCoordinator = cacheReadinessCoordinator,
        backgroundLauncher = backgroundLauncher,
        observability = observability,
        observationVersions = observationVersions
    )
    private val seriesOrchestration = ProgressSeriesOrchestration(
        database = database,
        cloudAccountRepository = cloudAccountRepository,
        syncRepository = syncRepository,
        timeProvider = timeProvider,
        cacheReadinessCoordinator = cacheReadinessCoordinator,
        backgroundLauncher = backgroundLauncher,
        observability = observability,
        observationVersions = observationVersions
    )
    private val reviewScheduleOrchestration = ProgressReviewScheduleOrchestration(
        database = database,
        cloudAccountRepository = cloudAccountRepository,
        syncRepository = syncRepository,
        timeProvider = timeProvider,
        backgroundLauncher = backgroundLauncher,
        observability = observability,
        observationVersions = observationVersions
    )
    private val leaderboardOrchestration = ProgressLeaderboardOrchestration(
        database = database,
        cloudAccountRepository = cloudAccountRepository,
        timeProvider = timeProvider,
        observability = observability,
        observationVersions = observationVersions
    )
    private val streakLeaderboardOrchestration = ProgressStreakLeaderboardOrchestration(
        database = database,
        cloudAccountRepository = cloudAccountRepository,
        timeProvider = timeProvider,
        observability = observability,
        observationVersions = observationVersions
    )

    // Captured handle for the input-observation flow so the lifecycle of this
    // long-running collector is explicit rather than hidden inside an init block.
    // Cancellation flows through appJob today; the handle is here so the collector
    // is no longer anonymous and can be disposed independently in the future.
    private val observeInputsJob: Job = backgroundLauncher.launchAndLogFailure(
        event = "progress_inputs_collect_failed",
        fields = emptyList()
    ) {
        observeProgressInputs(
            database = database,
            preferencesStore = preferencesStore,
            syncRepository = syncRepository,
            timeProvider = timeProvider
        ).collect { inputs ->
            handleProgressInputs(inputs = inputs)
        }
    }

    override fun observeSummarySnapshot(): Flow<ProgressSummarySnapshot?> {
        return summaryOrchestration.observeSnapshot()
    }

    override fun observeSeriesSnapshot(): Flow<ProgressSeriesSnapshot?> {
        return seriesOrchestration.observeSnapshot()
    }

    override fun observeReviewScheduleSnapshot(): Flow<ProgressReviewScheduleSnapshot?> {
        return reviewScheduleOrchestration.observeSnapshot()
    }

    override fun observeLeaderboardSnapshot(): Flow<ProgressLeaderboardSnapshot?> {
        return leaderboardOrchestration.observeSnapshot()
    }

    override fun observeStreakLeaderboardSnapshot(): Flow<ProgressStreakLeaderboardSnapshot?> {
        return streakLeaderboardOrchestration.observeSnapshot()
    }

    override suspend fun refreshSummaryIfInvalidated() {
        summaryOrchestration.refreshIfInvalidated()
    }

    override suspend fun refreshSeriesIfInvalidated() {
        seriesOrchestration.refreshIfInvalidated()
    }

    override suspend fun refreshReviewScheduleIfInvalidated() {
        reviewScheduleOrchestration.refreshIfInvalidated()
    }

    override suspend fun refreshLeaderboardIfInvalidated() {
        leaderboardOrchestration.refreshIfInvalidated()
    }

    override suspend fun refreshStreakLeaderboardIfInvalidated() {
        streakLeaderboardOrchestration.refreshIfInvalidated()
    }

    override suspend fun refreshLeaderboardForReviewShortcut() {
        leaderboardOrchestration.refreshForReviewShortcut()
    }

    override suspend fun refreshSummaryManually() {
        summaryOrchestration.refreshManually()
    }

    override suspend fun refreshSeriesManually() {
        seriesOrchestration.refreshManually()
    }

    override suspend fun refreshReviewScheduleManually() {
        reviewScheduleOrchestration.refreshManually()
    }

    override suspend fun refreshLeaderboardManually() {
        leaderboardOrchestration.refreshManually()
    }

    override suspend fun refreshStreakLeaderboardManually() {
        streakLeaderboardOrchestration.refreshManually()
    }

    private fun handleProgressInputs(
        inputs: ProgressObservedInputs
    ) {
        val clockSnapshot = createProgressClockSnapshot(timeProvider = timeProvider)
        val summaryHandledInputs = summaryOrchestration.handleInputs(
            inputs = inputs,
            clockSnapshot = clockSnapshot
        )
        val seriesHandledInputs = seriesOrchestration.handleInputs(
            inputs = inputs,
            clockSnapshot = clockSnapshot
        )
        val reviewScheduleHandledInputs = reviewScheduleOrchestration.handleInputs(
            inputs = inputs,
            clockSnapshot = clockSnapshot
        )
        // The leaderboard republishes its snapshot here for the viewer projection;
        // remote refreshes stay gated on nextRefreshAfter, not on sync completion.
        leaderboardOrchestration.handleInputs(
            inputs = inputs,
            clockSnapshot = clockSnapshot
        )
        streakLeaderboardOrchestration.handleInputs(
            inputs = inputs,
            clockSnapshot = clockSnapshot,
            viewerCurrentStreakDays = summaryHandledInputs.currentStoreState.snapshot
                ?.renderedSummary
                ?.currentStreakDays
        )

        if (
            summaryHandledInputs.currentStoreState.isLocalCacheReady.not() ||
            seriesHandledInputs.currentStoreState.isLocalCacheReady.not()
        ) {
            backgroundLauncher.launchAndLogFailure(
                event = "progress_local_cache_ready_background_failed",
                fields = listOf("timeZone" to summaryHandledInputs.currentStoreState.scopeKey.timeZone)
            ) {
                cacheReadinessCoordinator.ensureLocalCacheReady(
                    timeZone = summaryHandledInputs.currentStoreState.scopeKey.timeZone
                )
            }
        }

        summaryOrchestration.launchSyncCompletedRefreshIfNeeded(
            handledInputs = summaryHandledInputs
        )
        seriesOrchestration.launchSyncCompletedRefreshIfNeeded(
            handledInputs = seriesHandledInputs
        )
        reviewScheduleOrchestration.launchSyncCompletedRefreshIfNeeded(
            handledInputs = reviewScheduleHandledInputs
        )
    }
}
