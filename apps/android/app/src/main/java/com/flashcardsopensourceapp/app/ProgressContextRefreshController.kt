package com.flashcardsopensourceapp.app

import android.util.Log
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

private const val progressContextRefreshControllerLogTag: String = "ProgressContextRefresh"

private fun logProgressContextRefreshFailure(
    message: String,
    error: Exception
) {
    runCatching {
        Log.e(
            progressContextRefreshControllerLogTag,
            message,
            error
        )
    }.onFailure {
        System.err.println(message)
        error.printStackTrace()
    }
}

class ProgressContextRefreshController(
    private val appScope: CoroutineScope,
    private val progressRepository: ProgressRepository
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
                    logProgressContextRefreshFailure(
                        message = "Failed to refresh invalidated progress summary.",
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
                    logProgressContextRefreshFailure(
                        message = "Failed to refresh invalidated progress series.",
                        error = error
                    )
                }

                try {
                    progressRepository.refreshReviewScheduleIfInvalidated()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    logProgressContextRefreshFailure(
                        message = "Failed to refresh invalidated progress review schedule.",
                        error = error
                    )
                }
            }
        }
    }

    fun refreshIfInvalidated(visibleScreen: VisibleAppScreen) {
        refreshRequests.trySend(element = visibleScreen)
    }
}
