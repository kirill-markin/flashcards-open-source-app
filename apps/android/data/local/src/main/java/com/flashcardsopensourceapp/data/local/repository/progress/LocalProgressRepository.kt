package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfile
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
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressHeavyInputs
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressObservedInputs
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.createProgressClockSnapshot
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.observeProgressHeavyInputs
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.observeProgressInputs
import com.flashcardsopensourceapp.data.local.repository.progress.orchestration.ProgressLeaderboardOrchestration
import com.flashcardsopensourceapp.data.local.repository.progress.orchestration.ProgressReviewScheduleOrchestration
import com.flashcardsopensourceapp.data.local.repository.progress.orchestration.ProgressSeriesOrchestration
import com.flashcardsopensourceapp.data.local.repository.progress.orchestration.ProgressStreakLeaderboardOrchestration
import com.flashcardsopensourceapp.data.local.repository.progress.orchestration.ProgressSummaryOrchestration
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressBackgroundLauncher
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.createProgressObservationVersions
import java.util.concurrent.atomic.AtomicLong
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

private val progressDeferredRefreshDelay: Duration = 3.seconds

/**
 * Keeps whole-history Progress work off the rating path; see
 * docs/fsrs-scheduling-logic.md#non-blocking-review. A rating patches the badges in memory, and
 * the heavy inputs plus the charts built from them recompute only while Progress is visible, at
 * start, and [progressDeferredRefreshDelay] after the last rating.
 */
@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
class LocalProgressRepository(
    appScope: CoroutineScope,
    private val database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    private val cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    localProgressCacheStore: LocalProgressCacheStore,
    observability: AppObservability,
    appVersion: String,
    versionCode: Int,
    private val timeProvider: TimeProvider,
    isProgressScreenShown: Flow<Boolean>
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

    private val isProgressScreenVisible: StateFlow<Boolean> = isProgressScreenShown.stateIn(
        scope = appScope,
        started = SharingStarted.Eagerly,
        initialValue = false
    )
    // Bumped after every committed rating. The hidden branch reloads heavy inputs when it differs
    // from heavyInputsRatingVersion, so a rating committed before that branch subscribes still
    // triggers the deferred refresh.
    private val committedRatingVersion = MutableStateFlow(value = 0L)
    private val heavyInputsRatingVersion = AtomicLong(0L)
    // Read and written only by the input collector below.
    private var lastChartHeavyInputs: ProgressHeavyInputs? = null

    private val observeInputsJob: Job = backgroundLauncher.launchAndLogFailure(
        event = "progress_inputs_collect_failed",
        fields = emptyList()
    ) {
        val visibleOrDeferredHeavyInputs = isProgressScreenVisible.flatMapLatest { isVisible ->
            if (isVisible) {
                observeProgressHeavyInputs(
                    database = database,
                    timeProvider = timeProvider
                ).onStart {
                    heavyInputsRatingVersion.set(committedRatingVersion.value)
                }
            } else {
                committedRatingVersion.filter { version ->
                    version != heavyInputsRatingVersion.get()
                }.debounce(timeout = progressDeferredRefreshDelay).map { version ->
                    loadHeavyInputs(ratingVersion = version)
                }
            }
        }.onStart {
            emit(loadHeavyInputs(ratingVersion = committedRatingVersion.value))
        }
        observeProgressInputs(
            database = database,
            preferencesStore = preferencesStore,
            syncRepository = syncRepository,
            heavyInputs = visibleOrDeferredHeavyInputs
        ).collect { inputs ->
            handleProgressInputs(inputs = inputs)
        }
    }

    private val committedReviewsJob: Job = backgroundLauncher.launchAndLogFailure(
        event = "progress_committed_reviews_collect_failed",
        fields = emptyList()
    ) {
        localProgressCacheStore.observeCommittedReviews().collect { reviewLog ->
            scheduleDeferredProgressRefresh()
            // Its own launch, so one failed patch neither ends this collector nor skips later ratings.
            backgroundLauncher.launchAndLogFailure(
                event = "progress_rating_badge_apply_failed",
                fields = listOf("workspaceId" to reviewLog.workspaceId)
            ) {
                applyRatingToVisibleProgressBadges(reviewLog = reviewLog)
            }
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

    override suspend fun loadLeaderboardProfile(publicProfileId: String): CloudProgressLeaderboardProfile {
        return cloudAccountRepository.loadProgressLeaderboardProfile(publicProfileId = publicProfileId)
    }

    private fun applyRatingToVisibleProgressBadges(reviewLog: ReviewLogEntity) {
        summaryOrchestration.applyRating(
            reviewLog = reviewLog,
            clockSnapshot = createProgressClockSnapshot(timeProvider = timeProvider)
        )
    }

    private fun scheduleDeferredProgressRefresh() {
        committedRatingVersion.update { version -> version + 1L }
    }

    // ratingVersion is read before the query, so the loaded inputs include at least that rating.
    private suspend fun loadHeavyInputs(ratingVersion: Long): ProgressHeavyInputs {
        val heavyInputs = observeProgressHeavyInputs(
            database = database,
            timeProvider = timeProvider
        ).first()
        heavyInputsRatingVersion.set(ratingVersion)
        return heavyInputs
    }

    private fun handleProgressInputs(
        inputs: ProgressObservedInputs
    ) {
        val clockSnapshot = createProgressClockSnapshot(timeProvider = timeProvider)
        val summaryHandledInputs = summaryOrchestration.handleInputs(
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

        // Charts walk every card and the series range, so a change that brought no new heavy
        // inputs, such as the outbox write of a rating, does not rebuild them while Progress is hidden.
        val shouldRecomputeCharts = isProgressScreenVisible.value || inputs.heavyInputs !== lastChartHeavyInputs
        if (shouldRecomputeCharts.not()) {
            seriesOrchestration.rememberLatestInputs(inputs = inputs)
            reviewScheduleOrchestration.rememberLatestInputs(inputs = inputs)
            ensureLocalCacheReadyIfNeeded(
                isLocalCacheReady = summaryHandledInputs.currentStoreState.isLocalCacheReady,
                timeZone = summaryHandledInputs.currentStoreState.scopeKey.timeZone
            )
            summaryOrchestration.launchSyncCompletedRefreshIfNeeded(
                handledInputs = summaryHandledInputs
            )
            return
        }

        lastChartHeavyInputs = inputs.heavyInputs
        val seriesHandledInputs = seriesOrchestration.handleInputs(
            inputs = inputs,
            clockSnapshot = clockSnapshot
        )
        val reviewScheduleHandledInputs = reviewScheduleOrchestration.handleInputs(
            inputs = inputs,
            clockSnapshot = clockSnapshot
        )
        ensureLocalCacheReadyIfNeeded(
            isLocalCacheReady = summaryHandledInputs.currentStoreState.isLocalCacheReady &&
                seriesHandledInputs.currentStoreState.isLocalCacheReady,
            timeZone = summaryHandledInputs.currentStoreState.scopeKey.timeZone
        )
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

    private fun ensureLocalCacheReadyIfNeeded(
        isLocalCacheReady: Boolean,
        timeZone: String
    ) {
        if (isLocalCacheReady) {
            return
        }

        backgroundLauncher.launchAndLogFailure(
            event = "progress_local_cache_ready_background_failed",
            fields = listOf("timeZone" to timeZone)
        ) {
            cacheReadinessCoordinator.ensureLocalCacheReady(timeZone = timeZone)
        }
    }
}
