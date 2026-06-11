package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

class ProgressContextRefreshController(
    private val appScope: CoroutineScope,
    private val progressRepository: ProgressRepository,
    private val observability: AppObservability,
    private val appVersion: String,
    private val versionCode: Int
) {
    private val refreshRequests = Channel<VisibleAppScreen>(capacity = Channel.CONFLATED)

    init {
        appScope.launch {
            for (visibleScreen in refreshRequests) {
                try {
                    progressRepository.refreshSummaryIfInvalidated()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    captureProgressRefreshFailure(
                        refreshAction = "refresh_summary_if_invalidated",
                        error = error
                    )
                }

                if (visibleScreen != VisibleAppScreen.PROGRESS) {
                    continue
                }

                try {
                    progressRepository.refreshSeriesIfInvalidated()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    captureProgressRefreshFailure(
                        refreshAction = "refresh_series_if_invalidated",
                        error = error
                    )
                }

                try {
                    progressRepository.refreshReviewScheduleIfInvalidated()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    captureProgressRefreshFailure(
                        refreshAction = "refresh_review_schedule_if_invalidated",
                        error = error
                    )
                }

                try {
                    progressRepository.refreshLeaderboardIfInvalidated()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    captureProgressRefreshFailure(
                        refreshAction = "refresh_leaderboard_if_invalidated",
                        error = error
                    )
                }
            }
        }
    }

    fun refreshIfInvalidated(visibleScreen: VisibleAppScreen) {
        refreshRequests.trySend(element = visibleScreen)
    }

    private fun captureProgressRefreshFailure(
        refreshAction: String,
        error: Throwable
    ) {
        observability.captureException(
            event = AndroidExceptionIssueEvent.ProgressRefreshException(
                throwable = error,
                workspaceId = null,
                refreshAction = refreshAction,
                scopeId = null,
                source = "progress_context_refresh_controller",
                appVersion = appVersion,
                clientVersion = appVersion,
                versionCode = versionCode
            )
        )
    }
}
