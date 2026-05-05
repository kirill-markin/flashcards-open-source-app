package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.TimeProvider
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
    private val timeProvider: TimeProvider
) : ProgressRepository {
    private val backgroundLauncher = ProgressBackgroundLauncher(appScope = appScope)
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
        backgroundLauncher = backgroundLauncher
    )
    private val seriesOrchestration = ProgressSeriesOrchestration(
        database = database,
        cloudAccountRepository = cloudAccountRepository,
        syncRepository = syncRepository,
        timeProvider = timeProvider,
        cacheReadinessCoordinator = cacheReadinessCoordinator,
        backgroundLauncher = backgroundLauncher
    )
    private val reviewScheduleOrchestration = ProgressReviewScheduleOrchestration(
        database = database,
        cloudAccountRepository = cloudAccountRepository,
        syncRepository = syncRepository,
        timeProvider = timeProvider,
        backgroundLauncher = backgroundLauncher
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
            syncRepository = syncRepository
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

    override suspend fun refreshSummaryIfInvalidated() {
        summaryOrchestration.refreshIfInvalidated()
    }

    override suspend fun refreshSeriesIfInvalidated() {
        seriesOrchestration.refreshIfInvalidated()
    }

    override suspend fun refreshReviewScheduleIfInvalidated() {
        reviewScheduleOrchestration.refreshIfInvalidated()
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
